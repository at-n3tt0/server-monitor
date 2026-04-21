const { normalizeTarget } = require("../../../shared/schemas/target-schema");
const { AppError } = require("../../../shared/errors/app-error");
const {
  findMonitoringProfile,
  materializeMonitoringProfile
} = require("../../../shared/templates/monitoring-profiles");
const {
  createHostContextService,
  extractHostnameFromUrl,
  normalizeIdentifier
} = require("../discovery/host-context-service");

function normalizeTargetEndpoint(target) {
  if (target.url) {
    return target.url.trim().toLowerCase();
  }
  if (target.host) {
    const host = String(target.host).trim().toLowerCase();
    return target.port ? `${host}:${target.port}` : host;
  }
  return target.name.trim().toLowerCase();
}

function targetsMatch(left, right) {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "tcp") {
    return normalizeIdentifier(left.host) === normalizeIdentifier(right.host)
      && Number(left.port) === Number(right.port);
  }

  if (left.type === "http" || left.type === "agent") {
    return String(left.url || "").trim().toLowerCase() === String(right.url || "").trim().toLowerCase();
  }

  if (left.type === "dns") {
    return normalizeIdentifier(left.host) === normalizeIdentifier(right.host)
      && normalizeIdentifier(left.metadata?.lookupHostname) === normalizeIdentifier(right.metadata?.lookupHostname);
  }

  return normalizeIdentifier(left.host) === normalizeIdentifier(right.host)
    || normalizeTargetEndpoint(left) === normalizeTargetEndpoint(right);
}

function chooseRecommendedProfileId(diagnosis) {
  if (diagnosis.recommendedProfiles?.length) {
    return diagnosis.recommendedProfiles[0].id;
  }

  const gapSuggestion = diagnosis.monitoringGaps?.find((gap) => gap.suggestedProfileId)?.suggestedProfileId;
  return gapSuggestion || null;
}

const GENERIC_SERVER_PROFILE_IDS = new Set(["linux-server", "windows-server"]);

function chooseRecommendedProfileIds(diagnosis) {
  const candidateIds = [
    ...(diagnosis.recommendedProfiles || []).map((profile) => profile.id),
    ...(diagnosis.monitoringGaps || [])
      .map((gap) => gap.suggestedProfileId)
      .filter(Boolean)
  ].filter(Boolean);

  const deduplicated = candidateIds.filter((profileId, index, items) => items.indexOf(profileId) === index);
  const hasSpecificServerProfile = deduplicated.some((profileId) => !GENERIC_SERVER_PROFILE_IDS.has(profileId));

  return deduplicated.filter((profileId) => {
    if (!GENERIC_SERVER_PROFILE_IDS.has(profileId)) {
      return true;
    }
    return !hasSpecificServerProfile;
  });
}

function findRelatedTarget(context, predicate) {
  return context.relatedBundles.find((bundle) => predicate(bundle.target));
}

function buildProfileContext(context, diagnosis) {
  const identity = diagnosis.identity || {};
  const primaryTarget = context.primaryTarget;
  const primaryAgentTarget = context.primaryAgentBundle?.target || (primaryTarget.type === "agent" ? primaryTarget : null);
  const httpTarget = findRelatedTarget(context, (target) => target.type === "http")?.target || null;
  const dnsTarget = findRelatedTarget(context, (target) => target.type === "dns")?.target || null;
  const gatewayTarget = findRelatedTarget(context, (target) => target.type === "gateway")?.target || null;

  const host =
    primaryTarget.host
    || extractHostnameFromUrl(primaryTarget.url)
    || extractHostnameFromUrl(primaryAgentTarget?.url)
    || identity.fqdn
    || identity.actualHostname
    || identity.hostname
    || "";

  const existingTcpTarget = (port) => findRelatedTarget(context, (target) => target.type === "tcp" && Number(target.port) === Number(port))?.target || null;
  const listeningPorts = context.primaryAgentMetrics?.listeningPorts || [];
  const relevantProcesses = context.primaryAgentMetrics?.relevantProcesses || [];
  const printPort =
    listeningPorts.find((entry) => [515, 631].includes(Number(entry.port)))?.port
    || null;
  const backupPort =
    listeningPorts.find((entry) => [6160, 6162, 9392, 2500, 2501, 10001].includes(Number(entry.port)))?.port
    || relevantProcesses
      .map((processEntry) => {
        const match = String(processEntry.command || "").match(/(?:^|\s)-port\s+(\d{2,5})(?:\s|$)/i);
        return match ? Number(match[1]) : null;
      })
      .find((port) => Number.isInteger(port) && port > 0)
    || null;

  return {
    assetName: identity.hostname || primaryTarget.name,
    host,
    baseUrl: httpTarget?.url || "",
    agentUrl: primaryAgentTarget?.url || "",
    agentSecret: "",
    lookupHostname: dnsTarget?.metadata?.lookupHostname || "",
    databasePort: existingTcpTarget(5432)?.port || existingTcpTarget(3306)?.port || existingTcpTarget(1433)?.port || null,
    applicationPort: existingTcpTarget(8080)?.port || existingTcpTarget(8443)?.port || null,
    printPort,
    backupPort,
    gatewayHost: gatewayTarget?.host || host,
    externalHost: "",
    dnsServerHost: dnsTarget?.host || host
  };
}

function deduplicateDrafts(rawDrafts, relatedBundles, skippedExisting) {
  const uniqueDrafts = [];

  for (const draft of rawDrafts) {
    const duplicateExisting = relatedBundles.some((bundle) => targetsMatch(bundle.target, draft));
    if (duplicateExisting) {
      skippedExisting.push({
        type: draft.type,
        endpoint: normalizeTargetEndpoint(draft),
        reason: "Ja existe target relacionado cobrindo esse check.",
        profiles: draft.sourceProfiles || []
      });
      continue;
    }

    const duplicateDraft = uniqueDrafts.find((candidate) => targetsMatch(candidate, draft));
    if (duplicateDraft) {
      duplicateDraft.sourceProfiles = [...new Set([...(duplicateDraft.sourceProfiles || []), ...(draft.sourceProfiles || [])])];
      continue;
    }

    uniqueDrafts.push({
      ...draft,
      sourceProfiles: [...new Set(draft.sourceProfiles || [])]
    });
  }

  return uniqueDrafts;
}

function collectDraftRequirements(draft) {
  const requirements = [];
  if (draft.type === "http" && !draft.url) {
    requirements.push("Informar URL real do servico HTTP/HTTPS antes de aplicar.");
  }
  if (draft.type === "agent" && !draft.url) {
    requirements.push("Informar URL real do agente antes de aplicar.");
  }
  if (["ping", "tcp", "dns", "gateway"].includes(draft.type) && !draft.host) {
    requirements.push("Informar host ou IP real antes de aplicar.");
  }
  if (draft.type === "tcp" && !draft.port) {
    requirements.push("Informar porta TCP valida antes de aplicar.");
  }
  if (draft.type === "dns" && !draft.metadata?.lookupHostname) {
    requirements.push("Informar hostname de lookup DNS real antes de aplicar.");
  }
  return requirements;
}

function validateDraft(draft) {
  try {
    normalizeTarget({ ...draft, id: "preview-target-id" });
    return {
      valid: true,
      message: null
    };
  } catch (error) {
    return {
      valid: false,
      message: error.message
    };
  }
}

function createOnboardingService({
  repository,
  getTargets,
  getCurrentStateMap,
  diagnosticService,
  auditService,
  saveTargets
}) {
  const hostContextService = createHostContextService({ repository, getTargets, getCurrentStateMap });

  function buildRecommendation(targetId, options = {}) {
    const context = hostContextService.resolveRelatedBundles(targetId);
    if (!context) {
      throw new AppError(404, "not_found", "Host elegivel nao encontrado para onboarding");
    }

    const diagnosis = options.forceDiagnosis
      ? diagnosticService.runDiagnosis(targetId, options.request, options.auth)
      : (diagnosticService.getLatestDiagnosis(targetId) || diagnosticService.generateDiagnosis(targetId));

    const recommendedProfileIds = chooseRecommendedProfileIds(diagnosis);
    const recommendedProfiles = recommendedProfileIds
      .map((profileId) => findMonitoringProfile(profileId))
      .filter(Boolean);
    const recommendedProfile = recommendedProfiles[0] || null;
    const profileContext = buildProfileContext(context, diagnosis);
    const rawDrafts = recommendedProfiles.flatMap((profile) => materializeMonitoringProfile(profile, profileContext)
      .map((draft) => ({
        ...draft,
        sourceProfiles: [profile.id]
      })));
    const skippedExisting = [];

    const drafts = deduplicateDrafts(rawDrafts, context.relatedBundles, skippedExisting)
      .map((draft) => {
        const requirements = collectDraftRequirements(draft);
        const validation = validateDraft(draft);
        return {
          ...draft,
          requirements,
          validation
        };
      });

    const onboardingStatus = context.relatedBundles.length <= 1
      ? "new_host"
      : drafts.length && drafts.every((draft) => draft.validation.valid)
        ? "ready"
        : drafts.length
          ? "needs_review"
          : "covered";

    const onboardingSummary = {
      status: onboardingStatus,
      reason:
        onboardingStatus === "new_host"
          ? "Host com agente ativo e cobertura de monitoramento ainda inicial."
          : onboardingStatus === "ready"
            ? "Ha recomendacao pronta para aplicacao assistida."
            : onboardingStatus === "needs_review"
              ? "Ha recomendacao disponivel, mas exige revisao de campos antes da aplicacao."
              : "O host ja possui cobertura suficiente para os sinais detectados.",
      applyReady: drafts.length > 0 && drafts.every((draft) => draft.validation.valid),
      missingCoverage: diagnosis.monitoringGaps || []
    };

    return {
      targetId,
      hostId: diagnosis.hostId,
      identity: diagnosis.identity,
      relatedTargets: diagnosis.relatedTargets,
      diagnosis,
        recommendation: {
          profile: recommendedProfile
            ? {
            id: recommendedProfile.id,
            name: recommendedProfile.name,
            category: recommendedProfile.category,
              description: recommendedProfile.description
            }
            : null,
        profiles: recommendedProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          category: profile.category,
          description: profile.description
        })),
        profileContext,
        drafts,
        skippedExisting,
        applyReady: onboardingSummary.applyReady,
        requirements: drafts.flatMap((draft) => draft.requirements).filter((value, index, items) => items.indexOf(value) === index)
      },
      onboarding: onboardingSummary
    };
  }

  function listEligibleHosts() {
    const candidates = getTargets()
      .filter((target) => target.type === "agent" && target.enabled)
      .map((target) => {
        const latestMetrics = repository.getRecentAgentMetrics(target.id, 1)[0] || null;
        if (!latestMetrics) {
          return null;
        }

        const plan = buildRecommendation(target.id);
        if (plan.onboarding.status === "covered") {
          return null;
        }

        return {
          targetId: target.id,
          hostId: plan.hostId,
          identity: plan.identity,
          status: plan.onboarding.status,
          reason: plan.onboarding.reason,
          recommendedProfile: plan.recommendation.profile,
          confidence: plan.diagnosis.detectedRoles?.[0]?.confidence || null,
          probableRole: plan.diagnosis.detectedRoles?.[0]?.label || null,
          relatedTargets: plan.relatedTargets.length,
          createdAt: latestMetrics.collectedAt
        };
      })
      .filter(Boolean);

    const seenHosts = new Set();
    return candidates.filter((candidate) => {
      const key = normalizeIdentifier(candidate.hostId || candidate.identity?.hostname || candidate.targetId);
      if (!key || seenHosts.has(key)) {
        return false;
      }
      seenHosts.add(key);
      return true;
    });
  }

  function applyRecommendation(targetId, payload = {}, request, auth) {
    const plan = buildRecommendation(targetId);
    if (!plan.recommendation.profile) {
      throw new AppError(400, "validation_error", "Nao ha perfil recomendado suficiente para aplicar onboarding neste host");
    }

    const drafts = Array.isArray(payload.targets) && payload.targets.length
      ? payload.targets
      : plan.recommendation.drafts.map((draft) => ({
        name: draft.name,
        type: draft.type,
        host: draft.host,
        url: draft.url,
        port: draft.port,
        timeout: draft.timeout,
        intervalSeconds: draft.intervalSeconds,
        enabled: draft.enabled,
        secret: draft.secret,
        metadata: draft.metadata,
        thresholds: draft.thresholds
      }));

    if (!drafts.length) {
      throw new AppError(400, "validation_error", "Nao ha targets novos para aplicar neste onboarding");
    }

    const normalizedTargets = drafts.map((draft) => normalizeTarget(draft));
    const existingTargets = plan.relatedTargets
      .map((relatedTarget) => repository.findTargetById(relatedTarget.id))
      .filter(Boolean);

    const createdTargets = [];
    const skippedTargets = [];
    for (const target of normalizedTargets) {
      if (existingTargets.some((existing) => targetsMatch(existing, target))) {
        skippedTargets.push({
          name: target.name,
          type: target.type,
          endpoint: normalizeTargetEndpoint(target),
          reason: "Target equivalente ja existe."
        });
        continue;
      }
      createdTargets.push(target);
    }

    if (!createdTargets.length) {
      throw new AppError(400, "validation_error", "Nenhum target novo restou para criacao apos remover duplicidades");
    }

    saveTargets(createdTargets);

    auditService?.log({
      actionType: "onboarding.apply",
      targetType: "host",
      targetId,
      summary: `Onboarding aplicado para ${plan.identity.hostname || plan.hostId}`,
      details: {
        hostId: plan.hostId,
        profileId: payload.profileId || plan.recommendation.profile.id,
        profileIds: payload.profileIds || plan.recommendation.profiles.map((profile) => profile.id),
        createdTargets: createdTargets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type
        })),
        skippedTargets
      },
      context: auditService.createContext(request, auth)
    });

    return {
      profile: plan.recommendation.profile,
      hostId: plan.hostId,
      createdTargets,
      skippedTargets
    };
  }

  return {
    listEligibleHosts,
    buildRecommendation,
    applyRecommendation
  };
}

module.exports = {
  createOnboardingService
};

function extractHostnameFromUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function normalizeIdentifier(value) {
  if (!value) {
    return null;
  }
  return String(value).trim().toLowerCase() || null;
}

function getTargetIdentifiers(target, latestAgentMetrics = null) {
  return [
    normalizeIdentifier(target.host),
    normalizeIdentifier(extractHostnameFromUrl(target.url)),
    normalizeIdentifier(latestAgentMetrics?.hostname),
    normalizeIdentifier(latestAgentMetrics?.fqdn)
  ].filter(Boolean);
}

function hasIdentifierOverlap(leftIdentifiers, rightIdentifiers) {
  return leftIdentifiers.some((value) => rightIdentifiers.includes(value));
}

function createHostContextService({ repository, getTargets, getCurrentStateMap }) {
  function buildTargetBundle(target) {
    const checks = repository.getRecentChecks(target.id, 48);
    const agentMetrics = repository.getRecentAgentMetrics(target.id, 24);
    const networkMetrics = repository.getRecentNetworkMetrics(target.id, 48);
    return {
      target,
      current: getCurrentStateMap()[target.id] || null,
      history: {
        checks,
        agentMetrics,
        networkMetrics
      }
    };
  }

  function resolveRelatedBundles(targetId) {
    const targets = getTargets();
    const primaryTarget = targets.find((target) => target.id === targetId) || null;
    if (!primaryTarget) {
      return null;
    }

    const primaryBundle = buildTargetBundle(primaryTarget);
    const primaryLatestAgent = primaryBundle.history.agentMetrics[0]?.metrics || null;
    const primaryIdentifiers = getTargetIdentifiers(primaryTarget, primaryLatestAgent);

    const relatedBundles = targets
      .map((target) => buildTargetBundle(target))
      .filter((bundle) => {
        if (bundle.target.id === primaryTarget.id) {
          return true;
        }
        const latestAgent = bundle.history.agentMetrics[0]?.metrics || null;
        const identifiers = getTargetIdentifiers(bundle.target, latestAgent);
        return primaryIdentifiers.length > 0 && identifiers.length > 0 && hasIdentifierOverlap(primaryIdentifiers, identifiers);
      });

    const allIdentifiers = new Set(primaryIdentifiers);
    for (const bundle of relatedBundles) {
      const latestAgent = bundle.history.agentMetrics[0]?.metrics || null;
      for (const identifier of getTargetIdentifiers(bundle.target, latestAgent)) {
        allIdentifiers.add(identifier);
      }
    }

    const agentBundle = relatedBundles
      .filter((bundle) => bundle.target.type === "agent" && bundle.history.agentMetrics.length > 0)
      .sort((left, right) => new Date(right.history.agentMetrics[0].collectedAt) - new Date(left.history.agentMetrics[0].collectedAt))[0] || null;

    return {
      primaryTarget,
      primaryBundle,
      relatedBundles,
      identifiers: [...allIdentifiers],
      primaryAgentBundle: agentBundle,
      primaryAgentMetrics: agentBundle?.history.agentMetrics[0]?.metrics || primaryLatestAgent || null
    };
  }

  return {
    resolveRelatedBundles
  };
}

module.exports = {
  createHostContextService,
  extractHostnameFromUrl,
  normalizeIdentifier
};

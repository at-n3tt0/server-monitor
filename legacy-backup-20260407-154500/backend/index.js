const path = require("path");
const express = require("express");
const http = require("http");
const { URL } = require("url");
const { loadConfig, saveConfig } = require("./config/config-loader");
const { normalizeTarget } = require("../shared/schemas/target-schema");
const { createRepository } = require("./repositories/database");
const { createWebsocketHub } = require("./services/websocket/websocket-hub");
const { createAlertEngine } = require("./services/alerts/alert-engine");
const { createHistoryService } = require("./services/history/history-service");
const { createMonitorEngine } = require("./services/checks/monitor-engine");
const { createAuthService } = require("./services/auth/auth-service");
const { createAuthenticationMiddleware, parseCookies } = require("./middleware/authentication");
const { createRetentionService } = require("./services/maintenance/retention-service");
const { createAuditService } = require("./services/audit/audit-service");
const { createUserService } = require("./services/users/user-service");
const { createCsrfMiddleware } = require("./middleware/csrf");
const { errorHandler } = require("./middleware/error-handler");
const { sanitizeConfig, sanitizeSnapshot, sanitizeTarget } = require("./utils/http");
const { AppError } = require("../shared/errors/app-error");
const { listMonitoringProfiles } = require("../shared/templates/monitoring-profiles");
const { createDiagnosticService } = require("./services/diagnostics/diagnostic-service");
const { createOnboardingService } = require("./services/onboarding/onboarding-service");
const { createCorrelationEngine } = require("./services/correlation/correlation-engine");

async function startBackend() {
  const config = loadConfig();
  const repository = createRepository();
  repository.syncTargets(config.targets, new Date().toISOString());
  const app = express();
  const server = http.createServer(app);
  const websocketHub = createWebsocketHub(server);
  const auditService = createAuditService({ repository });
  const historyService = createHistoryService(repository, config.monitoring.uiHistoryLimit);
  const alertEngine = createAlertEngine(repository, websocketHub);
  const monitorEngine = createMonitorEngine({
    repository,
    websocketHub,
    alertEngine,
    historyService,
    pingSamples: config.monitoring.pingSamples,
    historyLimit: config.monitoring.uiHistoryLimit
  });
  const authService = createAuthService({ repository, authConfig: config.auth, auditService });
  const authMiddleware = createAuthenticationMiddleware({
    authService,
    cookieName: config.auth.sessionCookieName
  });
  const csrfProtection = createCsrfMiddleware();
  const userService = createUserService({ repository, auditService });
  const retentionService = createRetentionService({
    repository,
    websocketHub,
    retentionConfig: config.retention,
    maintenanceConfig: config.maintenance
  });
  const diagnosticService = createDiagnosticService({
    repository,
    getTargets: () => repository.listTargets(),
    getCurrentStateMap: () => monitorEngine.getCurrentStateMap(),
    auditService
  });
  const correlationEngine = createCorrelationEngine({
    repository,
    websocketHub,
    diagnosticService,
    getTargets: () => repository.listTargets(),
    getCurrentStateMap: () => monitorEngine.getCurrentStateMap()
  });
  monitorEngine.setCorrelationEngine(correlationEngine);

  await authService.ensureBootstrapAdmin();

  app.use(express.json({ limit: "1mb" }));
  app.use(authMiddleware.optional());

  monitorEngine.scheduleTargets(repository.listTargets());
  retentionService.start();

  function listTargets() {
    return repository.listTargets();
  }

  function buildAuthPayload(auth) {
    if (!auth) {
      return null;
    }
    return {
      username: auth.username,
      role: auth.role,
      expiresAt: auth.expiresAt,
      csrfToken: auth.csrfToken
    };
  }

  function buildBootstrap(auth = null) {
    const role = auth?.role || "viewer";
    return {
      auth: buildAuthPayload(auth),
      config: sanitizeConfig(config, role),
      snapshot: sanitizeSnapshot(
        historyService.getDashboardSnapshot(listTargets(), monitorEngine.getCurrentStateMap(), alertEngine, correlationEngine),
        role
      )
    };
  }

  function persistTargetConfig() {
    config.targets = listTargets();
    saveConfig(config);
    monitorEngine.scheduleTargets(config.targets);
  }

  function saveTargets(targets) {
    const timestamp = new Date().toISOString();
    for (const target of targets) {
      repository.saveTarget(target, timestamp);
    }
    persistTargetConfig();
    websocketHub.broadcast("config_updated", (client) => ({
      config: sanitizeConfig(config, client.auth?.role || "viewer")
    }));
  }

  function mergeTargetForUpdate(existing, input) {
    const merged = {
      ...existing,
      ...input,
      metadata: {
        ...(existing.metadata || {}),
        ...(input.metadata || {})
      }
    };

    if (input.secret == null || input.secret === "") {
      merged.secret = existing.secret;
    }

    return normalizeTarget(merged);
  }

  const onboardingService = createOnboardingService({
    repository,
    getTargets: () => repository.listTargets(),
    getCurrentStateMap: () => monitorEngine.getCurrentStateMap(),
    diagnosticService,
    auditService,
    saveTargets
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    websocketHub.handleUpgrade(request, socket, head, async (upgradeRequest) => {
      const cookies = parseCookies(upgradeRequest);
      const sessionToken = cookies[config.auth.sessionCookieName];
      if (!sessionToken) {
        throw new AppError(401, "authentication_required", "Autenticacao obrigatoria");
      }
      return authService.authenticateSession(sessionToken);
    });
  });

  websocketHub.onConnection((ws) => {
    websocketHub.send(ws, "bootstrap", buildBootstrap(ws.auth));
  });

  app.post("/api/auth/login", async (request, response, next) => {
    try {
      const username = String(request.body?.username || "").trim();
      const password = String(request.body?.password || "");
      if (!username || !password) {
        throw new AppError(400, "validation_error", "username e password sao obrigatorios");
      }
      const result = await authService.login(username, password, request);
      response.setHeader("Set-Cookie", authService.buildSessionCookie(result.token));
      response.json({
        user: result.user,
        expiresAt: result.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", authMiddleware.required(), csrfProtection, (request, response) => {
    authService.logout(request.auth.sessionToken, request, request.auth);
    response.setHeader("Set-Cookie", authService.buildLogoutCookie());
    response.status(204).end();
  });

  app.get("/api/auth/me", authMiddleware.required(), (request, response) => {
    response.json({
      user: buildAuthPayload(request.auth)
    });
  });

  app.post("/api/account/change-password", authMiddleware.required(), csrfProtection, async (request, response, next) => {
    try {
      await userService.changeOwnPassword(request.auth, request.body?.currentPassword, request.body?.newPassword, request);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/bootstrap", authMiddleware.required(), (request, response) => {
    response.json(buildBootstrap(request.auth));
  });

  app.get("/api/targets", authMiddleware.required(), (request, response) => {
    response.json({
      targets: listTargets().map((target) => sanitizeTarget(target, request.auth.role))
    });
  });

  app.get("/api/monitoring-profiles", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response) => {
    response.json({
      profiles: listMonitoringProfiles()
    });
  });

  app.get("/api/onboarding/eligible", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response, next) => {
    try {
      response.json({
        hosts: onboardingService.listEligibleHosts()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/onboarding/:targetId", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response, next) => {
    try {
      response.json({
        plan: onboardingService.buildRecommendation(request.params.targetId)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/onboarding/analyze/:targetId", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      response.json({
        plan: onboardingService.buildRecommendation(request.params.targetId, {
          forceDiagnosis: true,
          request,
          auth: request.auth
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/onboarding/apply/:targetId", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      const result = onboardingService.applyRecommendation(request.params.targetId, request.body, request, request.auth);
      response.status(201).json({
        profile: result.profile,
        hostId: result.hostId,
        createdTargets: result.createdTargets.map((target) => sanitizeTarget(target, "admin")),
        skippedTargets: result.skippedTargets
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/targets/:targetId/history", authMiddleware.required(), (request, response) => {
    response.json(historyService.getBootstrapForTarget(request.params.targetId));
  });

  app.get("/api/diagnostics/:targetId", authMiddleware.required(), (request, response, next) => {
    try {
      const diagnosis = diagnosticService.getLatestDiagnosis(request.params.targetId) || diagnosticService.generateDiagnosis(request.params.targetId);
      response.json({ diagnosis });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/diagnostics/run/:targetId", authMiddleware.required(), csrfProtection, (request, response, next) => {
    try {
      const diagnosis = diagnosticService.runDiagnosis(request.params.targetId, request, request.auth);
      response.json({ diagnosis });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/targets/:targetId/check", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, async (request, response, next) => {
    try {
      const target = monitorEngine.getTarget(request.params.targetId);
      if (!target) {
        throw new AppError(404, "not_found", "Target nao encontrado");
      }
      const result = await monitorEngine.executeCheck(target);
      auditService.log({
        actionType: "target.manual_check",
        targetType: "target",
        targetId: target.id,
        summary: `Check manual executado para ${target.name}`,
        details: { targetType: target.type },
        context: auditService.createContext(request, request.auth)
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/targets", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      const target = normalizeTarget(request.body);
      saveTargets([target]);
      auditService.log({
        actionType: "target.create",
        targetType: "target",
        targetId: target.id,
        summary: `Target ${target.name} criado`,
        details: { type: target.type, enabled: target.enabled },
        context: auditService.createContext(request, request.auth)
      });
      response.status(201).json({ target: sanitizeTarget(target, "admin") });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/targets/:targetId", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      const existing = repository.findTargetById(request.params.targetId);
      if (!existing) {
        throw new AppError(404, "not_found", "Target nao encontrado");
      }
      const target = mergeTargetForUpdate(existing, { ...request.body, id: request.params.targetId });
      saveTargets([target]);
      auditService.log({
        actionType: "target.update",
        targetType: "target",
        targetId: target.id,
        summary: `Target ${target.name} atualizado`,
        details: {
          previous: sanitizeTarget(existing, "admin"),
          current: sanitizeTarget(target, "admin")
        },
        context: auditService.createContext(request, request.auth)
      });
      response.json({ target: sanitizeTarget(target, "admin") });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/targets/:targetId", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      const existing = repository.findTargetById(request.params.targetId);
      if (!existing) {
        throw new AppError(404, "not_found", "Target nao encontrado");
      }
      repository.deleteTarget(request.params.targetId);
      persistTargetConfig();
      auditService.log({
        actionType: "target.delete",
        targetType: "target",
        targetId: existing.id,
        summary: `Target ${existing.name} removido`,
        details: sanitizeTarget(existing, "admin"),
        context: auditService.createContext(request, request.auth)
      });
      websocketHub.broadcast("config_updated", (client) => ({
        config: sanitizeConfig(config, client.auth?.role || "viewer")
      }));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response) => {
    response.json({ users: userService.listUsers() });
  });

  app.post("/api/admin/users", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, async (request, response, next) => {
    try {
      const user = await userService.createUser(request.body, request, request.auth);
      response.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/users/:username", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response, next) => {
    try {
      const user = userService.updateUser(request.params.username, request.body, request, request.auth);
      response.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/users/:username/reset-password", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, async (request, response, next) => {
    try {
      await userService.resetPassword(request.params.username, request.body?.newPassword, request, request.auth);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/audit", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response) => {
    response.json({
      events: auditService.list({
        actionType: request.query.actionType ? String(request.query.actionType) : undefined,
        actorUsername: request.query.actorUsername ? String(request.query.actorUsername) : undefined,
        targetId: request.query.targetId ? String(request.query.targetId) : undefined,
        from: request.query.from ? String(request.query.from) : undefined,
        to: request.query.to ? String(request.query.to) : undefined,
        limit: request.query.limit ? Number(request.query.limit) : 200
      })
    });
  });

  app.get("/api/admin/config", authMiddleware.required(), authMiddleware.authorize(["admin"]), (request, response) => {
    response.json({
      config: sanitizeConfig(config, "admin")
    });
  });

  app.get("/api/alerts", authMiddleware.required(), (request, response) => {
    response.json({
      alerts: repository.listAlerts(200),
      activeAlerts: alertEngine.listActiveAlerts()
    });
  });

  app.get("/api/correlations", authMiddleware.required(), (request, response) => {
    response.json({
      correlations: repository.listCorrelatedFindings(200),
      activeCorrelations: correlationEngine.listActiveFindings()
    });
  });

  app.post("/api/admin/maintenance/cleanup", authMiddleware.required(), authMiddleware.authorize(["admin"]), csrfProtection, (request, response) => {
    const summary = retentionService.runCleanup();
    auditService.log({
      actionType: "maintenance.cleanup",
      targetType: "system",
      targetId: "retention",
      summary: "Limpeza manual executada",
      details: summary,
      context: auditService.createContext(request, request.auth)
    });
    response.json({ summary });
  });

  app.get("/api/health", (request, response) => {
    response.json({
      ok: true,
      database: repository.adapterName,
      timestamp: new Date().toISOString(),
      targets: listTargets().length
    });
  });

  app.use("/api", (request, response) => {
    response.status(404).json({
      error: {
        code: "not_found",
        message: `Endpoint nao encontrado: ${request.method} ${request.originalUrl}`
      }
    });
  });

  app.use(express.static(path.join(__dirname, "..", "frontend"), {
    etag: false,
    lastModified: false,
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
      response.setHeader("Surrogate-Control", "no-store");
    }
  }));

  app.use(errorHandler);

  return new Promise((resolve) => {
    server.listen(config.backend.port, config.backend.host, () => {
      console.log("");
      console.log("Infra Monitor Platform iniciada");
      console.log(`Dashboard: http://localhost:${config.backend.port}`);
      console.log(`WebSocket: ws://localhost:${config.backend.port}/ws`);
      console.log("Banco: backend/data/monitor.db");
      console.log("");
      resolve({ app, server, repository });
    });
  });
}

module.exports = {
  startBackend
};

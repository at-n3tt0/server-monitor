function sanitizeTarget(target, role = "viewer") {
  return {
    id: target.id,
    name: target.name,
    type: target.type,
    host: target.host,
    url: target.url,
    port: target.port,
    timeout: target.timeout,
    intervalSeconds: target.intervalSeconds,
    enabled: target.enabled,
    thresholds: target.thresholds,
    metadata: target.metadata,
    secretConfigured: Boolean(target.secret),
    ...(role === "admin" ? { secret: null } : {})
  };
}

function sanitizeSnapshot(snapshot, role = "viewer") {
  const nextTargets = {};
  for (const [targetId, value] of Object.entries(snapshot.targets || {})) {
    nextTargets[targetId] = {
      ...value,
      target: sanitizeTarget(value.target, role)
    };
  }
  return {
    ...snapshot,
    targets: nextTargets
  };
}

function sanitizeConfig(config, role = "viewer") {
  if (role !== "admin") {
    return undefined;
  }
  return {
    backend: config.backend,
    monitoring: config.monitoring,
    retention: config.retention,
    maintenance: config.maintenance,
    auth: {
      sessionTtlHours: config.auth.sessionTtlHours,
      sessionCookieName: config.auth.sessionCookieName,
      secureCookies: config.auth.secureCookies,
      bootstrapAdmin: {
        username: config.auth.bootstrapAdmin.username,
        passwordHashConfigured: Boolean(config.auth.bootstrapAdmin.passwordHash),
        passwordConfigured: Boolean(config.auth.bootstrapAdmin.password)
      }
    }
  };
}

module.exports = {
  sanitizeConfig,
  sanitizeSnapshot,
  sanitizeTarget
};

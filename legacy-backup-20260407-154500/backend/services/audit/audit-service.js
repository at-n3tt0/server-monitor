function createAuditService({ repository }) {
  function createContext(request, auth = null) {
    return {
      actorUserId: auth?.userId || null,
      actorUsername: auth?.username || null,
      actorRole: auth?.role || null,
      ipAddress: request?.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request?.socket?.remoteAddress || null,
      userAgent: request?.headers["user-agent"] || null
    };
  }

  function log({ actionType, targetType = null, targetId = null, summary, details = {}, context = {} }) {
    const createdAt = new Date().toISOString();
    repository.saveAuditEvent({
      actionType,
      targetType,
      targetId,
      summary,
      details,
      actorUserId: context.actorUserId || null,
      actorUsername: context.actorUsername || null,
      actorRole: context.actorRole || null,
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
      createdAt
    });
  }

  function list(filters) {
    return repository.listAuditEvents(filters);
  }

  return {
    createContext,
    log,
    list
  };
}

module.exports = {
  createAuditService
};

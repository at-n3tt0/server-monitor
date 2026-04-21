const cookie = require("cookie");
const { AppError } = require("../../../shared/errors/app-error");
const { createSessionToken, hashPassword, verifyPassword } = require("../../utils/passwords");

function createAuthService({ repository, authConfig, auditService }) {
  async function ensureBootstrapAdmin() {
    const userCount = repository.countUsers();
    if (userCount > 0) {
      return;
    }

    const username = authConfig.bootstrapAdmin.username;
    const rawPassword = authConfig.bootstrapAdmin.password;
    const providedHash = authConfig.bootstrapAdmin.passwordHash;

    if (!username || (!rawPassword && !providedHash)) {
      console.warn("Nenhum usuario bootstrap foi configurado. Defina SERVER_MONITOR_BOOTSTRAP_ADMIN_USERNAME e SERVER_MONITOR_BOOTSTRAP_ADMIN_PASSWORD ou ajuste config/monitor.json.");
      return;
    }

    const passwordHash = providedHash || await hashPassword(rawPassword);
    const now = new Date().toISOString();
    repository.saveUser({
      id: username,
      username,
      role: "admin",
      passwordHash,
      createdAt: now,
      updatedAt: now,
      enabled: true
    });
    console.log(`Usuario bootstrap '${username}' criado.`);
  }

  async function login(username, password, request = null) {
    const context = request ? auditService?.createContext(request) : {};
    const user = repository.findUserByUsername(username);
    if (!user || !user.enabled) {
      auditService?.log({
        actionType: "auth.login_failed",
        targetType: "user",
        targetId: username,
        summary: `Falha de login para ${username}`,
        details: { reason: "invalid_credentials" },
        context
      });
      throw new AppError(401, "invalid_credentials", "Usuario ou senha invalidos");
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      auditService?.log({
        actionType: "auth.login_failed",
        targetType: "user",
        targetId: user.id,
        summary: `Falha de login para ${username}`,
        details: { reason: "invalid_credentials" },
        context
      });
      throw new AppError(401, "invalid_credentials", "Usuario ou senha invalidos");
    }

    const token = createSessionToken();
    const csrfToken = createSessionToken();
    const now = Date.now();
    const expiresAt = new Date(now + authConfig.sessionTtlHours * 60 * 60 * 1000).toISOString();
    repository.saveSession({
      token,
      csrfToken,
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      expiresAt
    });

    auditService?.log({
      actionType: "auth.login",
      targetType: "user",
      targetId: user.id,
      summary: `Login efetuado por ${user.username}`,
      details: {},
      context: {
        ...context,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role
      }
    });

    return {
      token,
      user: {
        username: user.username,
        role: user.role,
        csrfToken
      },
      expiresAt
    };
  }

  async function authenticateSession(token) {
    const session = repository.findSessionWithUser(token);
    if (!session) {
      throw new AppError(401, "invalid_session", "Sessao invalida");
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      repository.deleteSession(token);
      throw new AppError(401, "session_expired", "Sessao expirada");
    }
    return {
      userId: session.userId,
      username: session.username,
      role: session.role,
      csrfToken: session.csrfToken,
      sessionToken: token,
      expiresAt: session.expiresAt
    };
  }

  function logout(token, request = null, auth = null) {
    repository.deleteSession(token);
    if (auth) {
      auditService?.log({
        actionType: "auth.logout",
        targetType: "user",
        targetId: auth.userId,
        summary: `Logout efetuado por ${auth.username}`,
        details: {},
        context: request ? auditService.createContext(request, auth) : {}
      });
    }
  }

  function buildSessionCookie(token) {
    return cookie.serialize(authConfig.sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: authConfig.secureCookies,
      path: "/",
      maxAge: authConfig.sessionTtlHours * 60 * 60
    });
  }

  function buildLogoutCookie() {
    return cookie.serialize(authConfig.sessionCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: authConfig.secureCookies,
      path: "/",
      maxAge: 0
    });
  }

  return {
    ensureBootstrapAdmin,
    login,
    logout,
    authenticateSession,
    buildSessionCookie,
    buildLogoutCookie
  };
}

module.exports = {
  createAuthService
};

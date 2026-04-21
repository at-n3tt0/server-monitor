const cookie = require("cookie");
const { AppError } = require("../../shared/errors/app-error");

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return cookie.parse(header || "");
}

function createAuthenticationMiddleware({ authService, cookieName }) {
  return {
    optional() {
      return async (request, response, next) => {
        try {
          const cookies = parseCookies(request);
          const bearer = request.headers.authorization?.startsWith("Bearer ")
            ? request.headers.authorization.slice("Bearer ".length)
            : null;
          const sessionToken = cookies[cookieName] || bearer || null;
          if (sessionToken) {
            try {
              request.auth = await authService.authenticateSession(sessionToken);
            } catch (_) {
              request.auth = null;
            }
          } else {
            request.auth = null;
          }
          next();
        } catch (error) {
          next(error);
        }
      };
    },
    required() {
      return async (request, response, next) => {
        try {
          const cookies = parseCookies(request);
          const bearer = request.headers.authorization?.startsWith("Bearer ")
            ? request.headers.authorization.slice("Bearer ".length)
            : null;
          const sessionToken = cookies[cookieName] || bearer || null;
          if (!sessionToken) {
            throw new AppError(401, "authentication_required", "Autenticacao obrigatoria");
          }
          request.auth = await authService.authenticateSession(sessionToken);
          next();
        } catch (error) {
          next(error);
        }
      };
    },
    authorize(roles) {
      return (request, response, next) => {
        if (!request.auth) {
          next(new AppError(401, "authentication_required", "Autenticacao obrigatoria"));
          return;
        }
        if (!roles.includes(request.auth.role)) {
          next(new AppError(403, "forbidden", "Permissao insuficiente"));
          return;
        }
        next();
      };
    }
  };
}

module.exports = {
  createAuthenticationMiddleware,
  parseCookies
};

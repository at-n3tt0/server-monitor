const { AppError } = require("../../shared/errors/app-error");

function createCsrfMiddleware() {
  return function csrfProtection(request, response, next) {
    if (!request.auth) {
      next(new AppError(401, "authentication_required", "Autenticacao obrigatoria"));
      return;
    }

    const token = request.headers["x-csrf-token"];
    if (!token || token !== request.auth.csrfToken) {
      next(new AppError(403, "csrf_invalid", "Token CSRF invalido ou ausente"));
      return;
    }

    next();
  };
}

module.exports = {
  createCsrfMiddleware
};

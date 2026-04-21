const { isAppError } = require("../../shared/errors/app-error");

function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: {
      code: "internal_error",
      message: "Falha interna no servidor"
    }
  });
}

module.exports = {
  errorHandler
};

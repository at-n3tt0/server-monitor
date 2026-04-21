const { AppError } = require("../errors/app-error");
const { normalizeString } = require("./validation-utils");

const SUPPORTED_USER_ROLES = ["admin", "viewer"];

function validatePasswordStrength(password) {
  const value = normalizeString(password, "password", { required: true, maxLength: 256 });
  if (value.length < 10) {
    throw new AppError(400, "validation_error", "A senha deve ter pelo menos 10 caracteres");
  }
  if (!/[a-z]/.test(value)) {
    throw new AppError(400, "validation_error", "A senha deve conter ao menos uma letra minuscula");
  }
  if (!/[A-Z]/.test(value)) {
    throw new AppError(400, "validation_error", "A senha deve conter ao menos uma letra maiuscula");
  }
  if (!/[0-9]/.test(value)) {
    throw new AppError(400, "validation_error", "A senha deve conter ao menos um numero");
  }
  return value;
}

function normalizeRole(role) {
  const normalized = normalizeString(role, "role", { required: true, maxLength: 20 })?.toLowerCase();
  if (!SUPPORTED_USER_ROLES.includes(normalized)) {
    throw new AppError(400, "validation_error", `Perfil invalido: ${role}`);
  }
  return normalized;
}

function normalizeUsername(username) {
  const value = normalizeString(username, "username", { required: true, maxLength: 100 });
  if (!/^[a-zA-Z0-9._-]{3,100}$/.test(value)) {
    throw new AppError(400, "validation_error", "username deve ter 3-100 caracteres e usar apenas letras, numeros, ponto, underline ou hifen");
  }
  return value;
}

function normalizeUserInput(input = {}) {
  return {
    username: normalizeUsername(input.username),
    role: normalizeRole(input.role),
    enabled: input.enabled !== false
  };
}

module.exports = {
  SUPPORTED_USER_ROLES,
  normalizeRole,
  normalizeUserInput,
  normalizeUsername,
  validatePasswordStrength
};

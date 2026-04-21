const net = require("net");
const { AppError } = require("../errors/app-error");

function assert(condition, message, details = null) {
  if (!condition) {
    throw new AppError(400, "validation_error", message, details);
  }
}

function normalizeString(value, fieldName, { required = false, maxLength = 255 } = {}) {
  if (value == null || value === "") {
    if (required) {
      throw new AppError(400, "validation_error", `${fieldName} e obrigatorio`);
    }
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized && required) {
    throw new AppError(400, "validation_error", `${fieldName} e obrigatorio`);
  }
  if (normalized.length > maxLength) {
    throw new AppError(400, "validation_error", `${fieldName} excede o tamanho maximo permitido`);
  }
  return normalized || null;
}

function normalizeNumber(value, fieldName, { required = false, min = null, max = null, integer = false } = {}) {
  if (value == null || value === "") {
    if (required) {
      throw new AppError(400, "validation_error", `${fieldName} e obrigatorio`);
    }
    return null;
  }

  const normalized = Number(value);
  if (Number.isNaN(normalized)) {
    throw new AppError(400, "validation_error", `${fieldName} deve ser numerico`);
  }
  if (integer && !Number.isInteger(normalized)) {
    throw new AppError(400, "validation_error", `${fieldName} deve ser inteiro`);
  }
  if (min != null && normalized < min) {
    throw new AppError(400, "validation_error", `${fieldName} deve ser maior ou igual a ${min}`);
  }
  if (max != null && normalized > max) {
    throw new AppError(400, "validation_error", `${fieldName} deve ser menor ou igual a ${max}`);
  }
  return normalized;
}

function normalizeUrl(value, fieldName, { required = false } = {}) {
  const normalized = normalizeString(value, fieldName, { required, maxLength: 2048 });
  if (normalized == null) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw new AppError(400, "validation_error", `${fieldName} deve ser uma URL valida`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError(400, "validation_error", `${fieldName} deve usar http ou https`);
  }
  return normalized;
}

function isLikelyHostname(host) {
  return /^[a-zA-Z0-9.-]+$/.test(host) && !host.startsWith(".") && !host.endsWith(".");
}

function normalizeHost(value, fieldName, { required = false } = {}) {
  const normalized = normalizeString(value, fieldName, { required, maxLength: 253 });
  if (normalized == null) {
    return null;
  }
  if (net.isIP(normalized) || isLikelyHostname(normalized)) {
    return normalized;
  }
  throw new AppError(400, "validation_error", `${fieldName} deve ser um IP ou hostname valido`);
}

function normalizeSecret(value, fieldName, { required = false } = {}) {
  const normalized = normalizeString(value, fieldName, { required, maxLength: 512 });
  if (normalized == null) {
    return null;
  }
  if (normalized.length < 8) {
    throw new AppError(400, "validation_error", `${fieldName} deve ter ao menos 8 caracteres`);
  }
  return normalized;
}

module.exports = {
  assert,
  normalizeHost,
  normalizeNumber,
  normalizeSecret,
  normalizeString,
  normalizeUrl
};

const { AppError } = require("../../../shared/errors/app-error");
const { normalizeRole, normalizeUserInput, validatePasswordStrength } = require("../../../shared/schemas/user-schema");
const { hashPassword, verifyPassword } = require("../../utils/passwords");

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    enabled: user.enabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function createUserService({ repository, auditService }) {
  function ensureAdminFloor(excludedUserId = null) {
    const activeAdmins = repository.countActiveAdmins(excludedUserId);
    if (activeAdmins <= 0) {
      throw new AppError(400, "admin_floor", "Deve existir pelo menos um admin ativo");
    }
  }

  async function createUser(input, request, actor) {
    const userData = normalizeUserInput(input);
    const password = validatePasswordStrength(input.password);
    const existing = repository.findUserByUsername(userData.username);
    if (existing) {
      throw new AppError(409, "user_exists", "Ja existe um usuario com esse username");
    }

    const now = new Date().toISOString();
    repository.saveUser({
      id: userData.username,
      username: userData.username,
      role: userData.role,
      passwordHash: await hashPassword(password),
      enabled: userData.enabled,
      createdAt: now,
      updatedAt: now
    });

    const saved = repository.findUserByUsername(userData.username);
    auditService.log({
      actionType: "user.create",
      targetType: "user",
      targetId: saved.id,
      summary: `Usuario ${saved.username} criado com perfil ${saved.role}`,
      details: { enabled: saved.enabled, role: saved.role },
      context: auditService.createContext(request, actor)
    });
    return sanitizeUser(saved);
  }

  function listUsers() {
    return repository.listUsers().map(sanitizeUser);
  }

  function updateUser(username, input, request, actor) {
    const existing = repository.findUserByUsername(username);
    if (!existing) {
      throw new AppError(404, "not_found", "Usuario nao encontrado");
    }

    const nextRole = input.role != null ? normalizeRole(input.role) : existing.role;
    const nextEnabled = input.enabled != null ? Boolean(input.enabled) : existing.enabled;

    if (existing.role === "admin" && (!nextEnabled || nextRole !== "admin")) {
      ensureAdminFloor(existing.id);
    }

    const updated = {
      ...existing,
      role: nextRole,
      enabled: nextEnabled,
      updatedAt: new Date().toISOString()
    };
    repository.saveUser(updated);
    if (!updated.enabled) {
      repository.deleteSessionsByUserId(updated.id);
    }

    auditService.log({
      actionType: "user.update",
      targetType: "user",
      targetId: updated.id,
      summary: `Usuario ${updated.username} atualizado`,
      details: {
        previous: sanitizeUser(existing),
        current: sanitizeUser(updated)
      },
      context: auditService.createContext(request, actor)
    });

    return sanitizeUser(updated);
  }

  async function changeOwnPassword(auth, currentPassword, newPassword, request) {
    const user = repository.findUserByUsername(auth.username);
    if (!user || !user.enabled) {
      throw new AppError(404, "not_found", "Usuario nao encontrado");
    }

    const currentMatches = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new AppError(400, "invalid_password", "Senha atual invalida");
    }

    const validated = validatePasswordStrength(newPassword);
    user.passwordHash = await hashPassword(validated);
    user.updatedAt = new Date().toISOString();
    repository.saveUser(user);

    auditService.log({
      actionType: "user.change_password",
      targetType: "user",
      targetId: user.id,
      summary: `Usuario ${user.username} alterou a propria senha`,
      details: {},
      context: auditService.createContext(request, auth)
    });
  }

  async function resetPassword(username, newPassword, request, actor) {
    const user = repository.findUserByUsername(username);
    if (!user) {
      throw new AppError(404, "not_found", "Usuario nao encontrado");
    }

    const validated = validatePasswordStrength(newPassword);
    user.passwordHash = await hashPassword(validated);
    user.updatedAt = new Date().toISOString();
    repository.saveUser(user);
    repository.deleteSessionsByUserId(user.id);

    auditService.log({
      actionType: "user.reset_password",
      targetType: "user",
      targetId: user.id,
      summary: `Senha do usuario ${user.username} redefinida por administrador`,
      details: {},
      context: auditService.createContext(request, actor)
    });
  }

  return {
    changeOwnPassword,
    createUser,
    listUsers,
    resetPassword,
    sanitizeUser,
    updateUser
  };
}

module.exports = {
  createUserService
};

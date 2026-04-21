const { createRepository } = require("../backend/repositories/database");
const { hashPassword } = require("../backend/utils/passwords");

async function main() {
  const username = process.argv[2];
  const role = process.argv[3];
  const password = process.argv[4];

  if (!username || !role || !password) {
    console.error("Uso: node scripts/create-user.js <username> <admin|viewer> <senha>");
    process.exit(1);
  }

  if (!["admin", "viewer"].includes(role)) {
    console.error("O papel deve ser admin ou viewer");
    process.exit(1);
  }

  const repository = createRepository();
  const existing = repository.findUserByUsername(username);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  repository.saveUser({
    id: existing?.id || username,
    username,
    role,
    passwordHash,
    enabled: true,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  repository.close();
  console.log(`Usuario ${username} salvo com papel ${role}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

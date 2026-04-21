const { hashPassword } = require("../backend/utils/passwords");

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Uso: node scripts/hash-password.js <senha>");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log(hash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

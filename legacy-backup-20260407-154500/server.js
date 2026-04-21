const { startBackend } = require("./backend");

startBackend().catch((error) => {
  console.error("Falha ao iniciar backend:", error);
  process.exit(1);
});

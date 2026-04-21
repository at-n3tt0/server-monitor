const process = require("process");
const { startAgentServer } = require("./server");
const { loadAgentConfig } = require("./config");
const { createLogger } = require("./logger");

let server = null;
let logger = null;

function stopServer(reason) {
  if (!server) {
    process.exit(0);
    return;
  }
  logger.info("Parando InfraWatch Agent", { reason });
  server.close((error) => {
    if (error) {
      logger.error("Falha ao encerrar o servico do agente", { message: error.message });
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}

async function main() {
  const config = loadAgentConfig();
  logger = createLogger({
    logsRoot: config.logsRoot,
    level: config.logLevel
  });

  logger.info("Inicializando runtime do InfraWatch Agent", {
    configPath: config.configPath,
    port: config.port,
    bindHost: config.bindHost,
    hostAlias: config.hostAlias
  });

  process.on("uncaughtException", (error) => {
    logger.error("Excecao nao tratada no agente", { message: error.message, stack: error.stack });
  });

  process.on("unhandledRejection", (error) => {
    logger.error("Promessa rejeitada sem tratamento no agente", {
      message: error?.message || String(error),
      stack: error?.stack || null
    });
  });

  process.on("SIGINT", () => stopServer("SIGINT"));
  process.on("SIGTERM", () => stopServer("SIGTERM"));

  server = startAgentServer({
    port: config.port,
    secret: config.secret,
    hostAlias: config.hostAlias,
    bindHost: config.bindHost,
    logger
  });
}

main().catch((error) => {
  if (logger) {
    logger.error("Falha fatal ao iniciar o runtime do agente", { message: error.message, stack: error.stack });
  } else {
    process.stderr.write(`${error.stack || error.message}\n`);
  }
  process.exit(1);
});

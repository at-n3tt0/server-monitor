const fs = require("fs");
const path = require("path");

function normalizeArgv(argv = process.argv) {
  if (!Array.isArray(argv)) {
    return [];
  }
  return argv
    .filter((token) => token != null)
    .map((token) => String(token));
}

function parseArgs(argv = process.argv) {
  const args = {};
  const tokens = normalizeArgv(argv);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--config" || token === "/config") {
      const nextToken = tokens[index + 1];
      if (!nextToken || nextToken.startsWith("-") || nextToken.startsWith("/")) {
        throw new Error("Parametro --config informado sem caminho de arquivo");
      }

      const pathTokens = [];
      let cursor = index + 1;
      while (cursor < tokens.length) {
        const candidateToken = tokens[cursor];
        if (candidateToken.startsWith("-") || candidateToken.startsWith("/")) {
          break;
        }
        pathTokens.push(candidateToken);
        cursor += 1;
      }

      args.configPath = pathTokens.join(" ").trim();
      index = cursor - 1;
      continue;
    }

    if (token.startsWith("--config=") || token.startsWith("/config=")) {
      const [, configPath] = token.split(/=(.*)/s);
      if (!configPath) {
        throw new Error("Parametro --config informado sem caminho de arquivo");
      }
      args.configPath = configPath;
    }
  }

  return args;
}

function resolveConfigPath(explicitPath = null) {
  const cliArgs = parseArgs();
  const preferred = explicitPath || cliArgs.configPath || process.env.INFRAWATCH_AGENT_CONFIG;
  if (preferred) {
    return path.resolve(preferred);
  }
  return path.resolve(__dirname, "..", "config", "agent.config.json");
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Arquivo de configuracao invalido: esperado objeto JSON");
  }
  return value;
}

function validatePort(port) {
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new Error("port deve ser um inteiro entre 1 e 65535");
  }
  return numeric;
}

function validateSecret(secret) {
  if (secret == null || secret === "") {
    return "";
  }
  const normalized = String(secret).trim();
  if (normalized.length < 8) {
    throw new Error("secret deve ter ao menos 8 caracteres");
  }
  return normalized;
}

function validateOptionalString(value, fieldName, maxLength = 255) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} excede o tamanho maximo permitido`);
  }
  return normalized || null;
}

function loadAgentConfig(configPath = null) {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Arquivo de configuracao nao encontrado em ${resolvedPath}`);
  }

  const rawText = fs.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "");
  const raw = ensureObject(JSON.parse(rawText));
  const configDirectory = path.dirname(resolvedPath);
  const dataRoot = path.dirname(configDirectory);

  return {
    configPath: resolvedPath,
    dataRoot,
    logsRoot: path.join(dataRoot, "logs"),
    port: validatePort(raw.port ?? 9090),
    secret: validateSecret(raw.secret ?? ""),
    hostAlias: validateOptionalString(raw.hostAlias, "hostAlias", 255),
    bindHost: validateOptionalString(raw.bindHost, "bindHost", 255) || "0.0.0.0",
    logLevel: validateOptionalString(raw.logLevel, "logLevel", 32) || "info",
    serviceName: validateOptionalString(raw.serviceName, "serviceName", 120) || "InfraWatchAgent"
  };
}

module.exports = {
  loadAgentConfig,
  parseArgs,
  resolveConfigPath
};

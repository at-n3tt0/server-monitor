const fs = require("fs");
const path = require("path");

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function stringifyDetails(details) {
  if (!details) {
    return "";
  }
  try {
    return ` ${JSON.stringify(details)}`;
  } catch (_) {
    return " [unserializable-details]";
  }
}

function createLogger({ logsRoot, level = "info" }) {
  ensureDirectory(logsRoot);
  const logFile = path.join(logsRoot, "agent.log");
  const acceptedLevels = ["debug", "info", "warn", "error"];
  const currentLevelIndex = acceptedLevels.indexOf(String(level || "info").toLowerCase());
  const minimumIndex = currentLevelIndex >= 0 ? currentLevelIndex : 1;

  function shouldWrite(levelName) {
    const index = acceptedLevels.indexOf(levelName);
    return index >= minimumIndex;
  }

  function write(levelName, message, details = null) {
    if (!shouldWrite(levelName)) {
      return;
    }
    const line = `[${new Date().toISOString()}] [${levelName.toUpperCase()}] ${message}${stringifyDetails(details)}${process.platform === "win32" ? "\r\n" : "\n"}`;
    fs.appendFileSync(logFile, line, "utf8");
    if (levelName === "error") {
      process.stderr.write(line);
      return;
    }
    process.stdout.write(line);
  }

  return {
    filePath: logFile,
    debug(message, details) {
      write("debug", message, details);
    },
    info(message, details) {
      write("info", message, details);
    },
    warn(message, details) {
      write("warn", message, details);
    },
    error(message, details) {
      write("error", message, details);
    }
  };
}

module.exports = {
  createLogger
};

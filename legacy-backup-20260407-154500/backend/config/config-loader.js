const fs = require("fs");
const path = require("path");
const { validateMonitorConfig } = require("../../shared/schemas/target-schema");

const ROOT_DIR = path.resolve(__dirname, "../..");
const CONFIG_DIR = path.join(ROOT_DIR, "config");
const CONFIG_PATH = path.join(CONFIG_DIR, "monitor.json");
const LEGACY_CONFIG_PATH = path.join(ROOT_DIR, "config.json");

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function defaultConfig() {
  return validateMonitorConfig({
    monitoring: {
      defaultIntervalSeconds: 30,
      uiHistoryLimit: 120,
      pingSamples: 4
    },
    targets: []
  });
}

function loadConfig() {
  ensureConfigDir();

  if (fs.existsSync(CONFIG_PATH)) {
    return validateMonitorConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  }

  if (fs.existsSync(LEGACY_CONFIG_PATH)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, "utf8"));
    const migrated = validateMonitorConfig({
      monitoring: {
        defaultIntervalSeconds: legacy.checkInterval || 30,
        uiHistoryLimit: 120,
        pingSamples: 4
      },
      targets: legacy.targets || []
    });
    saveConfig(migrated);
    return migrated;
  }

  const created = defaultConfig();
  saveConfig(created);
  return created;
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

module.exports = {
  CONFIG_PATH,
  loadConfig,
  saveConfig
};

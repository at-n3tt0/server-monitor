const http = require("http");
const https = require("https");
const net = require("net");
const dns = require("dns").promises;
const { execFile } = require("child_process");
const { promisify } = require("util");
const { average, round, calculateJitter } = require("../network/network-utils");

const execFileAsync = promisify(execFile);

function computeStatusFromMetrics(target, summary, baseStatus = "up") {
  if (baseStatus === "down") {
    return "down";
  }
  if (summary.availability === 0) {
    return "down";
  }
  if (
    (summary.packetLoss != null && summary.packetLoss >= target.thresholds.warningPacketLoss) ||
    (summary.latencyMs != null && summary.latencyMs >= target.thresholds.warningLatencyMs) ||
    (summary.jitterMs != null && summary.jitterMs >= target.thresholds.jitterWarningMs)
  ) {
    return "degraded";
  }
  return "up";
}

async function runPingLikeCheck(target, sampleCount = 4) {
  const timeout = target.timeout || 5000;
  const count = Math.max(2, sampleCount);
  const isWin = process.platform === "win32";
  const args = isWin
    ? ["-n", String(count), "-w", String(timeout), target.host]
    : ["-c", String(count), "-W", String(Math.max(1, Math.ceil(timeout / 1000))), target.host];

  try {
    const { stdout } = await execFileAsync("ping", args, { timeout: timeout * count + 3000 });
    const rawTimes = [...stdout.matchAll(/time[=<]?\s*(\d+(?:[.,]\d+)?)\s*ms/gi)].map((match) => Number(match[1].replace(",", ".")));
    const receivedMatch = stdout.match(/Received = (\d+)/i) || stdout.match(/(\d+)\s+received/i);
    const sentMatch = stdout.match(/Sent = (\d+)/i) || stdout.match(/(\d+)\s+packets transmitted/i);
    const sent = sentMatch ? Number(sentMatch[1]) : count;
    const received = receivedMatch ? Number(receivedMatch[1]) : rawTimes.length;
    const lost = Math.max(0, sent - received);
    const packetLoss = sent > 0 ? round((lost / sent) * 100) : 100;
    const latencyMs = rawTimes.length ? round(average(rawTimes)) : null;
    const jitterMs = rawTimes.length ? calculateJitter(rawTimes) : null;
    const availability = sent > 0 ? round((received / sent) * 100) : 0;

    return {
      status: computeStatusFromMetrics(target, { availability, latencyMs, packetLoss, jitterMs }),
      availability,
      latencyMs,
      packetLoss,
      jitterMs,
      message: received > 0 ? `${received}/${sent} respostas ICMP` : "Sem resposta ICMP",
      details: {
        protocol: "icmp",
        samples: rawTimes,
        sent,
        received,
        host: target.host
      }
    };
  } catch (error) {
    return {
      status: "down",
      availability: 0,
      latencyMs: null,
      packetLoss: 100,
      jitterMs: null,
      message: error.killed ? "Ping expirou por timeout" : "Falha ao executar ping",
      details: {
        protocol: "icmp",
        error: error.message,
        host: target.host
      }
    };
  }
}

function runHttpCheck(target) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const transport = target.url.startsWith("https") ? https : http;
    const request = transport.get(target.url, {
      timeout: target.timeout,
      headers: { "User-Agent": "server-monitor/infra-platform" }
    }, (response) => {
      response.resume();
      const latencyMs = Date.now() - startedAt;
      const isDown = response.statusCode >= 400;
      resolve({
        status: computeStatusFromMetrics(target, { availability: isDown ? 0 : 100, latencyMs, packetLoss: 0, jitterMs: 0 }, isDown ? "down" : "up"),
        availability: isDown ? 0 : 100,
        latencyMs,
        packetLoss: 0,
        jitterMs: 0,
        httpStatus: response.statusCode,
        message: `HTTP ${response.statusCode}`,
        details: {
          url: target.url
        }
      });
    });

    request.on("error", (error) => resolve({
      status: "down",
      availability: 0,
      latencyMs: null,
      packetLoss: null,
      jitterMs: null,
      message: "Falha HTTP/HTTPS",
      details: {
        url: target.url,
        error: error.message
      }
    }));

    request.on("timeout", () => {
      request.destroy();
      resolve({
        status: "down",
        availability: 0,
        latencyMs: null,
        packetLoss: null,
        jitterMs: null,
        message: "Timeout HTTP/HTTPS",
        details: { url: target.url }
      });
    });
  });
}

function runTcpCheck(target) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(target.timeout);
    socket.once("connect", () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({
        status: computeStatusFromMetrics(target, { availability: 100, latencyMs, packetLoss: 0, jitterMs: 0 }),
        availability: 100,
        latencyMs,
        packetLoss: 0,
        jitterMs: 0,
        message: `TCP ${target.host}:${target.port} aceitou conexao`,
        details: { host: target.host, port: target.port }
      });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({
        status: "down",
        availability: 0,
        latencyMs: null,
        packetLoss: null,
        jitterMs: null,
        message: "Timeout TCP",
        details: { host: target.host, port: target.port }
      });
    });
    socket.once("error", (error) => {
      socket.destroy();
      resolve({
        status: "down",
        availability: 0,
        latencyMs: null,
        packetLoss: null,
        jitterMs: null,
        message: "Servico TCP indisponivel",
        details: { host: target.host, port: target.port, error: error.message }
      });
    });
    socket.connect(target.port, target.host);
  });
}

async function runDnsCheck(target) {
  const resolver = new dns.Resolver();
  const servers = Array.isArray(target.metadata.dnsServers) && target.metadata.dnsServers.length ? target.metadata.dnsServers : [target.host];
  resolver.setServers(servers);
  const lookupHostname = target.metadata.lookupHostname || null;
  if (!lookupHostname) {
    return {
      status: "down",
      availability: 0,
      latencyMs: null,
      packetLoss: null,
      jitterMs: null,
      message: "Check DNS sem hostname de lookup configurado",
      details: { dnsServer: servers, lookupHostname: null, error: "lookupHostname nao configurado para este target" }
    };
  }
  const startedAt = Date.now();

  try {
    const answers = await resolver.resolve4(lookupHostname);
    const latencyMs = Date.now() - startedAt;
    return {
      status: computeStatusFromMetrics(target, { availability: 100, latencyMs, packetLoss: 0, jitterMs: 0 }),
      availability: 100,
      latencyMs,
      packetLoss: 0,
      jitterMs: 0,
      message: `DNS respondeu ${answers.length} registro(s)`,
      details: {
        dnsServer: servers,
        lookupHostname,
        answers
      }
    };
  } catch (error) {
    return {
      status: "down",
      availability: 0,
      latencyMs: null,
      packetLoss: null,
      jitterMs: null,
      message: "Resolucao DNS falhou",
      details: {
        dnsServer: servers,
        lookupHostname,
        error: error.message
      }
    };
  }
}

function normalizeAgentMetrics(payload) {
  return {
    hostname: payload.hostname,
    fqdn: payload.fqdn || null,
    platform: payload.platform || null,
    os: payload.os || payload.platform || "unknown",
    osVersion: payload.osVersion || null,
    kernel: payload.kernel || null,
    arch: payload.arch || null,
    uptime: payload.uptime || 0,
    cpu: payload.cpu || { usage: 0, cores: 0 },
    memory: payload.memory || { total: 0, used: 0, usedPercent: 0 },
    disks: Array.isArray(payload.disks) ? payload.disks : [],
    network: Array.isArray(payload.network) ? payload.network : [],
    topProcesses: Array.isArray(payload.topProcesses) ? payload.topProcesses : [],
    relevantProcesses: Array.isArray(payload.relevantProcesses) ? payload.relevantProcesses : [],
    services: Array.isArray(payload.services) ? payload.services : [],
    listeningPorts: Array.isArray(payload.listeningPorts) ? payload.listeningPorts : [],
    shares: Array.isArray(payload.shares) ? payload.shares : null,
    rolesFeatures: Array.isArray(payload.rolesFeatures) ? payload.rolesFeatures : null,
    packages: Array.isArray(payload.packages) ? payload.packages : null,
    virtualization: payload.virtualization || null,
    connections: Array.isArray(payload.connections) ? payload.connections : [],
    collection: payload.collection || {},
    timestamp: payload.timestamp || new Date().toISOString()
  };
}

function runAgentCheck(target) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const baseUrl = target.url.replace(/\/$/, "");
    const url = `${baseUrl}/metrics`;
    const transport = url.startsWith("https") ? https : http;

    const request = transport.get(url, {
      timeout: target.timeout,
      headers: target.secret ? { Authorization: `Bearer ${target.secret}` } : {}
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode === 401) {
          return resolve({
            status: "down",
            availability: 0,
            latencyMs: null,
            packetLoss: null,
            jitterMs: null,
            message: "Agente recusou autenticacao",
            details: { url, httpStatus: 401 }
          });
        }

        try {
          const metrics = normalizeAgentMetrics(JSON.parse(body));
          resolve({
            status: "up",
            availability: 100,
            latencyMs: Date.now() - startedAt,
            packetLoss: 0,
            jitterMs: 0,
            message: "Agente respondeu com metricas",
            details: { url },
            metrics
          });
        } catch (error) {
          resolve({
            status: "down",
            availability: 0,
            latencyMs: null,
            packetLoss: null,
            jitterMs: null,
            message: "Agente retornou payload invalido",
            details: { url, error: error.message }
          });
        }
      });
    });

    request.on("error", (error) => resolve({
      status: "down",
      availability: 0,
      latencyMs: null,
      packetLoss: null,
      jitterMs: null,
      message: "Falha ao consultar agente",
      details: { url, error: error.message }
    }));

    request.on("timeout", () => {
      request.destroy();
      resolve({
        status: "down",
        availability: 0,
        latencyMs: null,
        packetLoss: null,
        jitterMs: null,
        message: "Timeout ao consultar agente",
        details: { url }
      });
    });
  });
}

async function runSnmpPlaceholder(target) {
  return {
    status: "unknown",
    availability: null,
    latencyMs: null,
    packetLoss: null,
    jitterMs: null,
    message: "Target SNMP ainda nao implementado; arquitetura preparada para a proxima fase",
    details: {
      target: target.host,
      snmp: target.metadata.snmp || {}
    }
  };
}

async function runCheck(target, options = {}) {
  switch (target.type) {
    case "ping":
    case "gateway":
      return runPingLikeCheck(target, options.pingSamples || 4);
    case "http":
      return runHttpCheck(target);
    case "tcp":
      return runTcpCheck(target);
    case "dns":
      return runDnsCheck(target);
    case "agent":
      return runAgentCheck(target);
    case "snmp":
      return runSnmpPlaceholder(target);
    default:
      throw new Error(`Target ${target.id} possui tipo nao suportado`);
  }
}

module.exports = {
  runCheck
};

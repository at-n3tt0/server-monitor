const path = require("path");
const Database = require("better-sqlite3");

function createRepository() {
  const dbPath = path.join(__dirname, "..", "data", "monitor.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT,
      url TEXT,
      port INTEGER,
      timeout INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL,
      secret TEXT,
      enabled INTEGER NOT NULL,
      thresholds_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS current_state (
      target_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      availability REAL,
      latency_ms REAL,
      packet_loss REAL,
      jitter_ms REAL,
      last_check_at TEXT,
      last_change_at TEXT,
      message TEXT,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS check_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      availability REAL,
      latency_ms REAL,
      packet_loss REAL,
      jitter_ms REAL,
      http_status INTEGER,
      message TEXT,
      checked_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      hostname TEXT,
      os TEXT,
      uptime_seconds INTEGER,
      cpu_usage REAL,
      cpu_cores INTEGER,
      memory_total INTEGER,
      memory_used INTEGER,
      memory_used_percent REAL,
      metrics_json TEXT NOT NULL,
      collected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS network_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      interface_name TEXT,
      rx_bytes INTEGER,
      tx_bytes INTEGER,
      rx_rate REAL,
      tx_rate REAL,
      operstate TEXT,
      latency_ms REAL,
      packet_loss REAL,
      jitter_ms REAL,
      gateway_status TEXT,
      dns_status TEXT,
      collected_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      alert_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      actor_username TEXT,
      actor_role TEXT,
      action_type TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagnostic_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      host_key TEXT NOT NULL,
      diagnosis_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS correlated_findings (
      id TEXT PRIMARY KEY,
      host_key TEXT NOT NULL,
      target_id TEXT,
      correlation_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      explanation TEXT NOT NULL,
      suggested_action TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      evidence_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_check_results_target_time ON check_results(target_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_target_time ON agent_metrics(target_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_network_metrics_target_time ON network_metrics(target_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_target_time ON events(target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_username, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_diagnostic_snapshots_target_time ON diagnostic_snapshots(target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_correlated_findings_host_time ON correlated_findings(host_key, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_correlated_findings_status ON correlated_findings(status, last_seen_at DESC);
  `);

  const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all().map((row) => row.name);
  if (!sessionColumns.includes("csrf_token")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN csrf_token TEXT`);
    db.exec(`UPDATE sessions SET csrf_token = token WHERE csrf_token IS NULL`);
  }

  const statements = {
    upsertTarget: db.prepare(`
      INSERT INTO targets (
        id, name, type, host, url, port, timeout, interval_seconds, secret, enabled, thresholds_json, metadata_json, created_at, updated_at
      ) VALUES (
        @id, @name, @type, @host, @url, @port, @timeout, @interval_seconds, @secret, @enabled, @thresholds_json, @metadata_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        host = excluded.host,
        url = excluded.url,
        port = excluded.port,
        timeout = excluded.timeout,
        interval_seconds = excluded.interval_seconds,
        secret = excluded.secret,
        enabled = excluded.enabled,
        thresholds_json = excluded.thresholds_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    deleteTarget: db.prepare(`DELETE FROM targets WHERE id = ?`),
    deleteCurrentStateForTarget: db.prepare(`DELETE FROM current_state WHERE target_id = ?`),
    deleteCheckResultsForTarget: db.prepare(`DELETE FROM check_results WHERE target_id = ?`),
    deleteAgentMetricsForTarget: db.prepare(`DELETE FROM agent_metrics WHERE target_id = ?`),
    deleteNetworkMetricsForTarget: db.prepare(`DELETE FROM network_metrics WHERE target_id = ?`),
    deleteAlertsForTarget: db.prepare(`DELETE FROM alerts WHERE target_id = ?`),
    deleteEventsForTarget: db.prepare(`DELETE FROM events WHERE target_id = ?`),
    deleteDiagnosticSnapshotsForTarget: db.prepare(`DELETE FROM diagnostic_snapshots WHERE target_id = ?`),
    deleteCorrelatedFindingsForTarget: db.prepare(`DELETE FROM correlated_findings WHERE target_id = ?`),
    listTargets: db.prepare(`SELECT * FROM targets ORDER BY name ASC`),
    findTargetById: db.prepare(`SELECT * FROM targets WHERE id = ?`),
    upsertCurrentState: db.prepare(`
      INSERT INTO current_state (
        target_id, status, availability, latency_ms, packet_loss, jitter_ms, last_check_at, last_change_at, message, details_json
      ) VALUES (
        @target_id, @status, @availability, @latency_ms, @packet_loss, @jitter_ms, @last_check_at, @last_change_at, @message, @details_json
      )
      ON CONFLICT(target_id) DO UPDATE SET
        status = excluded.status,
        availability = excluded.availability,
        latency_ms = excluded.latency_ms,
        packet_loss = excluded.packet_loss,
        jitter_ms = excluded.jitter_ms,
        last_check_at = excluded.last_check_at,
        last_change_at = excluded.last_change_at,
        message = excluded.message,
        details_json = excluded.details_json
    `),
    getCurrentStateRows: db.prepare(`
      SELECT current_state.*
      FROM current_state
      INNER JOIN targets ON targets.id = current_state.target_id
    `),
    insertCheckResult: db.prepare(`
      INSERT INTO check_results (
        target_id, status, availability, latency_ms, packet_loss, jitter_ms, http_status, message, checked_at, details_json
      ) VALUES (
        @target_id, @status, @availability, @latency_ms, @packet_loss, @jitter_ms, @http_status, @message, @checked_at, @details_json
      )
    `),
    getRecentChecks: db.prepare(`SELECT * FROM check_results WHERE target_id = ? ORDER BY checked_at DESC LIMIT ?`),
    insertAgentMetrics: db.prepare(`
      INSERT INTO agent_metrics (
        target_id, hostname, os, uptime_seconds, cpu_usage, cpu_cores, memory_total, memory_used, memory_used_percent, metrics_json, collected_at
      ) VALUES (
        @target_id, @hostname, @os, @uptime_seconds, @cpu_usage, @cpu_cores, @memory_total, @memory_used, @memory_used_percent, @metrics_json, @collected_at
      )
    `),
    getRecentAgentMetrics: db.prepare(`SELECT * FROM agent_metrics WHERE target_id = ? ORDER BY collected_at DESC LIMIT ?`),
    insertNetworkMetrics: db.prepare(`
      INSERT INTO network_metrics (
        target_id, interface_name, rx_bytes, tx_bytes, rx_rate, tx_rate, operstate, latency_ms, packet_loss, jitter_ms, gateway_status, dns_status, collected_at, details_json
      ) VALUES (
        @target_id, @interface_name, @rx_bytes, @tx_bytes, @rx_rate, @tx_rate, @operstate, @latency_ms, @packet_loss, @jitter_ms, @gateway_status, @dns_status, @collected_at, @details_json
      )
    `),
    getRecentNetworkMetrics: db.prepare(`SELECT * FROM network_metrics WHERE target_id = ? ORDER BY collected_at DESC LIMIT ?`),
    upsertAlert: db.prepare(`
      INSERT INTO alerts (
        id, target_id, alert_key, type, severity, message, status, first_seen_at, last_seen_at, resolved_at, payload_json
      ) VALUES (
        @id, @target_id, @alert_key, @type, @severity, @message, @status, @first_seen_at, @last_seen_at, @resolved_at, @payload_json
      )
      ON CONFLICT(alert_key) DO UPDATE SET
        severity = excluded.severity,
        message = excluded.message,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        resolved_at = excluded.resolved_at,
        payload_json = excluded.payload_json
    `),
    listAlerts: db.prepare(`SELECT * FROM alerts ORDER BY last_seen_at DESC LIMIT ?`),
    listActiveAlerts: db.prepare(`SELECT * FROM alerts WHERE status = 'active' ORDER BY last_seen_at DESC`),
    insertEvent: db.prepare(`
      INSERT INTO events (target_id, event_type, severity, message, payload_json, created_at)
      VALUES (@target_id, @event_type, @severity, @message, @payload_json, @created_at)
    `),
    countUsers: db.prepare(`SELECT COUNT(*) AS total FROM users`),
    countActiveAdmins: db.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND enabled = 1 AND (? IS NULL OR id <> ?)`),
    upsertUser: db.prepare(`
      INSERT INTO users (id, username, role, password_hash, enabled, created_at, updated_at)
      VALUES (@id, @username, @role, @password_hash, @enabled, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        role = excluded.role,
        password_hash = excluded.password_hash,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `),
    findUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
    listUsers: db.prepare(`SELECT * FROM users ORDER BY username ASC`),
    insertSession: db.prepare(`
      INSERT OR REPLACE INTO sessions (token, user_id, csrf_token, created_at, expires_at)
      VALUES (@token, @user_id, @csrf_token, @created_at, @expires_at)
    `),
    findSessionWithUser: db.prepare(`
      SELECT sessions.token, sessions.user_id, sessions.csrf_token, sessions.created_at, sessions.expires_at, users.username, users.role
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ? AND users.enabled = 1
    `),
    deleteSessionsByUserId: db.prepare(`DELETE FROM sessions WHERE user_id = ?`),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < ?`),
    pruneCheckResults: db.prepare(`DELETE FROM check_results WHERE checked_at < ?`),
    pruneAgentMetrics: db.prepare(`DELETE FROM agent_metrics WHERE collected_at < ?`),
    pruneNetworkMetrics: db.prepare(`DELETE FROM network_metrics WHERE collected_at < ?`),
    pruneEvents: db.prepare(`DELETE FROM events WHERE created_at < ?`),
    pruneResolvedAlerts: db.prepare(`DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < ?`),
    insertAuditEvent: db.prepare(`
      INSERT INTO audit_log (
        actor_user_id, actor_username, actor_role, action_type, target_type, target_id, summary, details_json, ip_address, user_agent, created_at
      ) VALUES (
        @actor_user_id, @actor_username, @actor_role, @action_type, @target_type, @target_id, @summary, @details_json, @ip_address, @user_agent, @created_at
      )
    `),
    insertDiagnosticSnapshot: db.prepare(`
      INSERT INTO diagnostic_snapshots (target_id, host_key, diagnosis_json, created_at)
      VALUES (@target_id, @host_key, @diagnosis_json, @created_at)
    `),
    upsertCorrelatedFinding: db.prepare(`
      INSERT INTO correlated_findings (
        id, host_key, target_id, correlation_key, type, severity, title, status, explanation, suggested_action, first_seen_at, last_seen_at, resolved_at, evidence_json, payload_json
      ) VALUES (
        @id, @host_key, @target_id, @correlation_key, @type, @severity, @title, @status, @explanation, @suggested_action, @first_seen_at, @last_seen_at, @resolved_at, @evidence_json, @payload_json
      )
      ON CONFLICT(correlation_key) DO UPDATE SET
        target_id = excluded.target_id,
        severity = excluded.severity,
        title = excluded.title,
        status = excluded.status,
        explanation = excluded.explanation,
        suggested_action = excluded.suggested_action,
        last_seen_at = excluded.last_seen_at,
        resolved_at = excluded.resolved_at,
        evidence_json = excluded.evidence_json,
        payload_json = excluded.payload_json
    `),
    listCorrelatedFindings: db.prepare(`SELECT * FROM correlated_findings ORDER BY last_seen_at DESC LIMIT ?`),
    listActiveCorrelatedFindings: db.prepare(`SELECT * FROM correlated_findings WHERE status = 'active' ORDER BY last_seen_at DESC`),
    getCorrelatedFindingsForHost: db.prepare(`SELECT * FROM correlated_findings WHERE host_key = ? ORDER BY last_seen_at DESC`),
    pruneResolvedCorrelatedFindings: db.prepare(`DELETE FROM correlated_findings WHERE resolved_at IS NOT NULL AND resolved_at < ?`),
    cleanupOrphanedCurrentState: db.prepare(`
      DELETE FROM current_state
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedCheckResults: db.prepare(`
      DELETE FROM check_results
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedAgentMetrics: db.prepare(`
      DELETE FROM agent_metrics
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedNetworkMetrics: db.prepare(`
      DELETE FROM network_metrics
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedAlerts: db.prepare(`
      DELETE FROM alerts
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedEvents: db.prepare(`
      DELETE FROM events
      WHERE target_id IS NOT NULL
        AND target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedDiagnosticSnapshots: db.prepare(`
      DELETE FROM diagnostic_snapshots
      WHERE target_id NOT IN (SELECT id FROM targets)
    `),
    cleanupOrphanedCorrelatedFindings: db.prepare(`
      DELETE FROM correlated_findings
      WHERE target_id IS NOT NULL
        AND target_id NOT IN (SELECT id FROM targets)
    `),
    getLatestDiagnosticSnapshot: db.prepare(`
      SELECT *
      FROM diagnostic_snapshots
      WHERE target_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `),
    getRecentDiagnosticSnapshots: db.prepare(`
      SELECT *
      FROM diagnostic_snapshots
      WHERE target_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    walCheckpoint: db.prepare(`PRAGMA wal_checkpoint(TRUNCATE)`),
    vacuum: db.prepare(`VACUUM`)
  };

  function mapTarget(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      host: row.host,
      url: row.url,
      port: row.port,
      timeout: row.timeout,
      intervalSeconds: row.interval_seconds,
      secret: row.secret,
      enabled: Boolean(row.enabled),
      thresholds: JSON.parse(row.thresholds_json),
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function mapUser(row) {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      passwordHash: row.password_hash,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function mapAuditRow(row) {
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      actorUsername: row.actor_username,
      actorRole: row.actor_role,
      actionType: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      details: JSON.parse(row.details_json),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at
    };
  }

  function mapDiagnosticRow(row) {
    return {
      id: row.id,
      targetId: row.target_id,
      hostKey: row.host_key,
      diagnosis: JSON.parse(row.diagnosis_json),
      createdAt: row.created_at
    };
  }

  function mapCorrelatedFinding(row) {
    return {
      id: row.id,
      hostKey: row.host_key,
      targetId: row.target_id,
      correlationKey: row.correlation_key,
      type: row.type,
      severity: row.severity,
      title: row.title,
      status: row.status,
      explanation: row.explanation,
      suggestedAction: row.suggested_action,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      resolvedAt: row.resolved_at,
      evidence: JSON.parse(row.evidence_json),
      payload: JSON.parse(row.payload_json)
    };
  }

  function listAuditEvents(filters = {}) {
    const clauses = [];
    const values = {};

    if (filters.actionType) {
      clauses.push("action_type = @action_type");
      values.action_type = filters.actionType;
    }
    if (filters.actorUsername) {
      clauses.push("actor_username = @actor_username");
      values.actor_username = filters.actorUsername;
    }
    if (filters.targetId) {
      clauses.push("target_id = @target_id");
      values.target_id = filters.targetId;
    }
    if (filters.from) {
      clauses.push("created_at >= @from");
      values.from = filters.from;
    }
    if (filters.to) {
      clauses.push("created_at <= @to");
      values.to = filters.to;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Number.isInteger(filters.limit) ? filters.limit : 200;
    const query = db.prepare(`
      SELECT *
      FROM audit_log
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit
    `);
    return query.all({ ...values, limit }).map(mapAuditRow);
  }

  function deleteTargetData(targetId) {
    statements.deleteCurrentStateForTarget.run(targetId);
    statements.deleteCheckResultsForTarget.run(targetId);
    statements.deleteAgentMetricsForTarget.run(targetId);
    statements.deleteNetworkMetricsForTarget.run(targetId);
    statements.deleteAlertsForTarget.run(targetId);
    statements.deleteEventsForTarget.run(targetId);
    statements.deleteDiagnosticSnapshotsForTarget.run(targetId);
    statements.deleteCorrelatedFindingsForTarget.run(targetId);
    statements.deleteTarget.run(targetId);
  }

  function cleanupOrphanedTargetData() {
    return {
      currentState: statements.cleanupOrphanedCurrentState.run().changes,
      checkResults: statements.cleanupOrphanedCheckResults.run().changes,
      agentMetrics: statements.cleanupOrphanedAgentMetrics.run().changes,
      networkMetrics: statements.cleanupOrphanedNetworkMetrics.run().changes,
      alerts: statements.cleanupOrphanedAlerts.run().changes,
      events: statements.cleanupOrphanedEvents.run().changes,
      diagnostics: statements.cleanupOrphanedDiagnosticSnapshots.run().changes,
      correlations: statements.cleanupOrphanedCorrelatedFindings.run().changes
    };
  }

  const repository = {
    adapterName: "sqlite",
    syncTargets(targets, timestamp) {
      const transaction = db.transaction((rows) => {
        const incomingIds = new Set(rows.map((target) => target.id));
        const existingIds = statements.listTargets.all().map((row) => row.id);

        for (const target of rows) {
          statements.upsertTarget.run({
            id: target.id,
            name: target.name,
            type: target.type,
            host: target.host,
            url: target.url,
            port: target.port,
            timeout: target.timeout,
            interval_seconds: target.intervalSeconds,
            secret: target.secret,
            enabled: target.enabled ? 1 : 0,
            thresholds_json: JSON.stringify(target.thresholds),
            metadata_json: JSON.stringify(target.metadata),
            created_at: timestamp,
            updated_at: timestamp
          });
        }

        for (const targetId of existingIds) {
          if (!incomingIds.has(targetId)) {
            deleteTargetData(targetId);
          }
        }

        cleanupOrphanedTargetData();
      });
      transaction(targets);
    },
    listTargets() {
      return statements.listTargets.all().map(mapTarget);
    },
    findTargetById(targetId) {
      const row = statements.findTargetById.get(targetId);
      return row ? mapTarget(row) : null;
    },
    saveTarget(target, timestamp) {
      statements.upsertTarget.run({
        id: target.id,
        name: target.name,
        type: target.type,
        host: target.host,
        url: target.url,
        port: target.port,
        timeout: target.timeout,
        interval_seconds: target.intervalSeconds,
        secret: target.secret,
        enabled: target.enabled ? 1 : 0,
        thresholds_json: JSON.stringify(target.thresholds),
        metadata_json: JSON.stringify(target.metadata),
        created_at: target.createdAt || timestamp,
        updated_at: timestamp
      });
    },
    deleteTarget(targetId) {
      const transaction = db.transaction((id) => {
        deleteTargetData(id);
        cleanupOrphanedTargetData();
      });
      transaction(targetId);
    },
    loadCurrentState() {
      const map = {};
      for (const row of statements.getCurrentStateRows.all()) {
        map[row.target_id] = {
          targetId: row.target_id,
          status: row.status,
          availability: row.availability,
          latencyMs: row.latency_ms,
          packetLoss: row.packet_loss,
          jitterMs: row.jitter_ms,
          lastCheckAt: row.last_check_at,
          lastChangeAt: row.last_change_at,
          message: row.message,
          details: JSON.parse(row.details_json)
        };
      }
      return map;
    },
    saveCurrentState(state) {
      statements.upsertCurrentState.run({
        target_id: state.targetId,
        status: state.status,
        availability: state.availability,
        latency_ms: state.latencyMs,
        packet_loss: state.packetLoss,
        jitter_ms: state.jitterMs,
        last_check_at: state.lastCheckAt,
        last_change_at: state.lastChangeAt,
        message: state.message,
        details_json: JSON.stringify(state.details || {})
      });
    },
    saveCheckResult(result) {
      statements.insertCheckResult.run({
        target_id: result.targetId,
        status: result.status,
        availability: result.availability,
        latency_ms: result.latencyMs,
        packet_loss: result.packetLoss,
        jitter_ms: result.jitterMs,
        http_status: result.httpStatus || null,
        message: result.message || null,
        checked_at: result.checkedAt,
        details_json: JSON.stringify(result.details || {})
      });
    },
    getRecentChecks(targetId, limit) {
      return statements.getRecentChecks.all(targetId, limit).map((row) => ({
        id: row.id,
        targetId: row.target_id,
        status: row.status,
        availability: row.availability,
        latencyMs: row.latency_ms,
        packetLoss: row.packet_loss,
        jitterMs: row.jitter_ms,
        httpStatus: row.http_status,
        message: row.message,
        checkedAt: row.checked_at,
        details: JSON.parse(row.details_json)
      }));
    },
    saveAgentMetrics(entry) {
      statements.insertAgentMetrics.run({
        target_id: entry.targetId,
        hostname: entry.hostname,
        os: entry.os,
        uptime_seconds: entry.uptimeSeconds,
        cpu_usage: entry.cpuUsage,
        cpu_cores: entry.cpuCores,
        memory_total: entry.memoryTotal,
        memory_used: entry.memoryUsed,
        memory_used_percent: entry.memoryUsedPercent,
        metrics_json: JSON.stringify(entry.metrics || {}),
        collected_at: entry.collectedAt
      });
    },
    getRecentAgentMetrics(targetId, limit) {
      return statements.getRecentAgentMetrics.all(targetId, limit).map((row) => ({
        id: row.id,
        targetId: row.target_id,
        hostname: row.hostname,
        os: row.os,
        uptimeSeconds: row.uptime_seconds,
        cpuUsage: row.cpu_usage,
        cpuCores: row.cpu_cores,
        memoryTotal: row.memory_total,
        memoryUsed: row.memory_used,
        memoryUsedPercent: row.memory_used_percent,
        metrics: JSON.parse(row.metrics_json),
        collectedAt: row.collected_at
      }));
    },
    saveNetworkMetrics(entries) {
      const transaction = db.transaction((rows) => {
        for (const entry of rows) {
          statements.insertNetworkMetrics.run({
            target_id: entry.targetId,
            interface_name: entry.interfaceName || null,
            rx_bytes: entry.rxBytes || null,
            tx_bytes: entry.txBytes || null,
            rx_rate: entry.rxRate || null,
            tx_rate: entry.txRate || null,
            operstate: entry.operstate || null,
            latency_ms: entry.latencyMs || null,
            packet_loss: entry.packetLoss || null,
            jitter_ms: entry.jitterMs || null,
            gateway_status: entry.gatewayStatus || null,
            dns_status: entry.dnsStatus || null,
            collected_at: entry.collectedAt,
            details_json: JSON.stringify(entry.details || {})
          });
        }
      });
      transaction(entries);
    },
    getRecentNetworkMetrics(targetId, limit) {
      return statements.getRecentNetworkMetrics.all(targetId, limit).map((row) => ({
        id: row.id,
        targetId: row.target_id,
        interfaceName: row.interface_name,
        rxBytes: row.rx_bytes,
        txBytes: row.tx_bytes,
        rxRate: row.rx_rate,
        txRate: row.tx_rate,
        operstate: row.operstate,
        latencyMs: row.latency_ms,
        packetLoss: row.packet_loss,
        jitterMs: row.jitter_ms,
        gatewayStatus: row.gateway_status,
        dnsStatus: row.dns_status,
        collectedAt: row.collected_at,
        details: JSON.parse(row.details_json)
      }));
    },
    saveAlert(alert) {
      statements.upsertAlert.run({
        id: alert.id,
        target_id: alert.targetId,
        alert_key: alert.alertKey,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        status: alert.status,
        first_seen_at: alert.firstSeenAt,
        last_seen_at: alert.lastSeenAt,
        resolved_at: alert.resolvedAt || null,
        payload_json: JSON.stringify(alert.payload || {})
      });
    },
    listAlerts(limit = 200) {
      return statements.listAlerts.all(limit).map((row) => ({
        id: row.id,
        targetId: row.target_id,
        alertKey: row.alert_key,
        type: row.type,
        severity: row.severity,
        message: row.message,
        status: row.status,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        resolvedAt: row.resolved_at,
        payload: JSON.parse(row.payload_json)
      }));
    },
    listActiveAlerts() {
      return statements.listActiveAlerts.all().map((row) => ({
        id: row.id,
        targetId: row.target_id,
        alertKey: row.alert_key,
        type: row.type,
        severity: row.severity,
        message: row.message,
        status: row.status,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        resolvedAt: row.resolved_at,
        payload: JSON.parse(row.payload_json)
      }));
    },
    saveEvent(event) {
      statements.insertEvent.run({
        target_id: event.targetId || null,
        event_type: event.eventType,
        severity: event.severity,
        message: event.message,
        payload_json: JSON.stringify(event.payload || {}),
        created_at: event.createdAt
      });
    },
    countUsers() {
      return statements.countUsers.get().total;
    },
    countActiveAdmins(excludedUserId = null) {
      return statements.countActiveAdmins.get(excludedUserId, excludedUserId).total;
    },
    saveUser(user) {
      statements.upsertUser.run({
        id: user.id,
        username: user.username,
        role: user.role,
        password_hash: user.passwordHash,
        enabled: user.enabled ? 1 : 0,
        created_at: user.createdAt,
        updated_at: user.updatedAt
      });
    },
    findUserByUsername(username) {
      const row = statements.findUserByUsername.get(username);
      return row ? mapUser(row) : null;
    },
    listUsers() {
      return statements.listUsers.all().map(mapUser);
    },
    saveSession(session) {
      statements.insertSession.run({
        token: session.token,
        user_id: session.userId,
        csrf_token: session.csrfToken,
        created_at: session.createdAt,
        expires_at: session.expiresAt
      });
    },
    findSessionWithUser(token) {
      const row = statements.findSessionWithUser.get(token);
      if (!row) {
        return null;
      }
      return {
        token: row.token,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        username: row.username,
        role: row.role
      };
    },
    deleteSessionsByUserId(userId) {
      statements.deleteSessionsByUserId.run(userId);
    },
    deleteSession(token) {
      statements.deleteSession.run(token);
    },
    deleteExpiredSessions(nowIso) {
      return statements.deleteExpiredSessions.run(nowIso).changes;
    },
    saveAuditEvent(event) {
      statements.insertAuditEvent.run({
        actor_user_id: event.actorUserId,
        actor_username: event.actorUsername,
        actor_role: event.actorRole,
        action_type: event.actionType,
        target_type: event.targetType,
        target_id: event.targetId,
        summary: event.summary,
        details_json: JSON.stringify(event.details || {}),
        ip_address: event.ipAddress,
        user_agent: event.userAgent,
        created_at: event.createdAt
      });
    },
    saveDiagnosticSnapshot(snapshot) {
      statements.insertDiagnosticSnapshot.run({
        target_id: snapshot.targetId,
        host_key: snapshot.hostKey,
        diagnosis_json: JSON.stringify(snapshot.diagnosis),
        created_at: snapshot.createdAt
      });
    },
    saveCorrelatedFinding(finding) {
      statements.upsertCorrelatedFinding.run({
        id: finding.id,
        host_key: finding.hostKey,
        target_id: finding.targetId || null,
        correlation_key: finding.correlationKey,
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        status: finding.status,
        explanation: finding.explanation,
        suggested_action: finding.suggestedAction || null,
        first_seen_at: finding.firstSeenAt,
        last_seen_at: finding.lastSeenAt,
        resolved_at: finding.resolvedAt || null,
        evidence_json: JSON.stringify(finding.evidence || []),
        payload_json: JSON.stringify(finding.payload || {})
      });
    },
    listCorrelatedFindings(limit = 200) {
      return statements.listCorrelatedFindings.all(limit).map(mapCorrelatedFinding);
    },
    listActiveCorrelatedFindings() {
      return statements.listActiveCorrelatedFindings.all().map(mapCorrelatedFinding);
    },
    getCorrelatedFindingsForHost(hostKey) {
      return statements.getCorrelatedFindingsForHost.all(hostKey).map(mapCorrelatedFinding);
    },
    getLatestDiagnosticSnapshot(targetId) {
      const row = statements.getLatestDiagnosticSnapshot.get(targetId);
      return row ? mapDiagnosticRow(row) : null;
    },
    getRecentDiagnosticSnapshots(targetId, limit = 10) {
      return statements.getRecentDiagnosticSnapshots.all(targetId, limit).map(mapDiagnosticRow);
    },
    listAuditEvents,
    pruneHistoricalData(cutoffs) {
      const transaction = db.transaction((values) => ({
        checkResults: statements.pruneCheckResults.run(values.checkResultsBefore).changes,
        agentMetrics: statements.pruneAgentMetrics.run(values.agentMetricsBefore).changes,
        networkMetrics: statements.pruneNetworkMetrics.run(values.networkMetricsBefore).changes,
        events: statements.pruneEvents.run(values.eventsBefore).changes,
        alerts: statements.pruneResolvedAlerts.run(values.alertsBefore).changes,
        correlatedFindings: statements.pruneResolvedCorrelatedFindings.run(values.alertsBefore).changes,
        expiredSessions: statements.deleteExpiredSessions.run(values.nowIso).changes
      }));
      return transaction(cutoffs);
    },
    runMaintenance() {
      cleanupOrphanedTargetData();
      statements.walCheckpoint.run();
      statements.vacuum.run();
    },
    close() {
      db.close();
    }
  };

  repository.targets = {
    findById: repository.findTargetById,
    list: repository.listTargets,
    remove: repository.deleteTarget,
    save: repository.saveTarget
  };
  repository.users = {
    count: repository.countUsers,
    countActiveAdmins: repository.countActiveAdmins,
    findByUsername: repository.findUserByUsername,
    list: repository.listUsers,
    save: repository.saveUser
  };
  repository.sessions = {
    delete: repository.deleteSession,
    deleteByUserId: repository.deleteSessionsByUserId,
    findWithUser: repository.findSessionWithUser,
    save: repository.saveSession
  };
  repository.audit = {
    list: repository.listAuditEvents,
    save: repository.saveAuditEvent
  };
  repository.diagnostics = {
    getLatest: repository.getLatestDiagnosticSnapshot,
    getRecent: repository.getRecentDiagnosticSnapshots,
    save: repository.saveDiagnosticSnapshot
  };
  repository.correlations = {
    list: repository.listCorrelatedFindings,
    listActive: repository.listActiveCorrelatedFindings,
    listForHost: repository.getCorrelatedFindingsForHost,
    save: repository.saveCorrelatedFinding
  };

  return repository;
}

module.exports = {
  createRepository
};

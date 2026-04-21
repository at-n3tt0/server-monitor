# Retenção

## Objetivo

Evitar crescimento indefinido do banco mantendo histórico suficiente para operação e análise.

## Políticas atuais

- `check_results`: 30 dias
- `agent_metrics`: 30 dias
- `network_metrics`: 30 dias
- `events`: 180 dias
- `alerts` resolvidos: 365 dias

Os valores são configuráveis em `config/monitor.json`.

## Rotina automática

O backend executa jobs internos:

1. limpeza periódica de dados vencidos
2. remoção de sessões expiradas
3. `wal_checkpoint`
4. `VACUUM` periódico

## Configuração

### retenção

- `retention.checkResultsDays`
- `retention.agentMetricsDays`
- `retention.networkMetricsDays`
- `retention.eventsDays`
- `retention.alertsDays`

### manutenção

- `maintenance.cleanupIntervalMinutes`
- `maintenance.vacuumIntervalHours`

## Preparação para o futuro

A base já está pronta para uma próxima etapa com:

- agregação temporal
- retenção por camadas quente/morna/fria
- migração de armazenamento para PostgreSQL

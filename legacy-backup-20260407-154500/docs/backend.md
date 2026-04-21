# Backend

## Responsabilidades

- carregar configuracao
- autenticar usuarios e sessoes
- validar CSRF
- executar checks ativos
- consultar agentes
- manter estado atual por target
- persistir historicos em SQLite
- avaliar alertas
- aplicar retencao
- registrar auditoria administrativa
- publicar atualizacoes em WebSocket
- gerar diagnostico inteligente explicavel

## Tipos de target suportados

- `ping`
- `http`
- `tcp`
- `dns`
- `gateway`
- `agent`
- `snmp` preparado

## API principal

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/account/change-password`
- `GET /api/bootstrap`
- `GET /api/targets`
- `GET /api/monitoring-profiles`
- `GET /api/onboarding/eligible`
- `GET /api/onboarding/:targetId`
- `GET /api/targets/:targetId/history`
- `GET /api/diagnostics/:targetId`
- `POST /api/diagnostics/run/:targetId`
- `POST /api/onboarding/analyze/:targetId`
- `POST /api/onboarding/apply/:targetId`
- `POST /api/targets/:targetId/check`
- `POST /api/targets`
- `PUT /api/targets/:targetId`
- `DELETE /api/targets/:targetId`
- `GET /api/alerts`
- `GET /api/admin/config`
- `POST /api/admin/maintenance/cleanup`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:username`
- `POST /api/admin/users/:username/reset-password`
- `GET /api/admin/audit`
- `GET /api/health`

## WebSocket

Endpoint:

- `/ws`

O WebSocket exige sessao autenticada.

Mensagens principais:

- `bootstrap`
- `target_update`
- `alert`
- `alert_resolved`
- `event`
- `config_updated`

## Persistencia

Banco:

- `backend/data/monitor.db`

O backend separa:

- estado atual
- historico de checks
- historico de agente
- historico de rede
- snapshots diagnosticos
- alertas
- eventos
- usuarios
- sessoes
- auditoria administrativa

## Diagnostico inteligente

Pastas principais:

- `backend/services/discovery/`
- `backend/services/fingerprints/`
- `backend/services/diagnostics/`

O motor diagnostico usa:

- dados recentes do agente
- checks ativos ja existentes
- historico persistido
- alertas ativos
- perfis de monitoramento pre-prontos

## Onboarding inteligente

O backend agora possui um orquestrador de onboarding em:

- `backend/services/onboarding/onboarding-service.js`

Esse modulo:

- lista hosts elegiveis a partir de targets `agent` com coleta recente
- reaproveita o diagnostico inteligente existente
- escolhe o perfil recomendado com base nas evidencias reais
- materializa drafts reais de targets usando os perfis existentes
- remove drafts ja cobertos por targets relacionados
- exige confirmacao explicita do admin para aplicar
- registra a aplicacao em auditoria

## Observacao

A camada de repositorio segue em SQLite, mas agora ja expoe uma organizacao mais proxima de um adapter por dominio.

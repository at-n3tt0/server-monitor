# Auditoria

## Objetivo

Registrar ações administrativas relevantes para governança, rastreabilidade e investigação.

## Persistência

Tabela:

- `audit_log`

## Campos registrados

- `createdAt`
- `actorUserId`
- `actorUsername`
- `actorRole`
- `actionType`
- `targetType`
- `targetId`
- `summary`
- `details`
- `ipAddress`
- `userAgent`

## Consulta

Endpoint:

- `GET /api/admin/audit`

Filtros suportados:

- `actionType`
- `actorUsername`
- `targetId`
- `from`
- `to`
- `limit`

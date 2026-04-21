# Segurança

## Autenticação

O backend usa sessão persistida no banco:

- login valida usuário e senha
- o backend cria token aleatório de sessão
- o token é salvo em `sessions`
- o navegador recebe cookie HTTP-only

## Autorização

Papéis suportados:

- `admin`
- `viewer`

Aplicação:

- API protegida por middleware
- WebSocket autenticado no upgrade
- frontend oculta ações administrativas para `viewer`

## CSRF

Rotas mutáveis autenticadas exigem `x-csrf-token` vinculado à sessão ativa.

## Rotas protegidas

### autenticadas

- `GET /api/bootstrap`
- `GET /api/targets`
- `GET /api/targets/:targetId/history`
- `GET /api/alerts`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/account/change-password`

### somente admin

- `POST /api/targets`
- `PUT /api/targets/:targetId`
- `DELETE /api/targets/:targetId`
- `POST /api/targets/:targetId/check`
- `GET /api/admin/config`
- `POST /api/admin/maintenance/cleanup`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:username`
- `POST /api/admin/users/:username/reset-password`
- `GET /api/admin/audit`

## WebSocket

O upgrade para `/ws` valida a mesma sessão usada pela API. Conexões sem cookie válido recebem `401` e não recebem nenhum dado.

## Segredos

- `secret` de targets não é enviado ao frontend
- configuração de autenticação expõe apenas metadados não sensíveis
- o agente continua autenticado por secret próprio

## Limitações

- não há MFA
- ainda não existe revogação avançada de sessões
- segredos de targets continuam criptograficamente não protegidos em repouso nesta fase

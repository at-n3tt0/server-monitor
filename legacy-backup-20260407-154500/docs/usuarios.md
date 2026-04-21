# Usuários

## Objetivo

Oferecer governança operacional mínima sem perder a simplicidade da stack atual.

## Funcionalidades

- listagem de usuários
- criação de usuário
- alteração de papel
- ativação/desativação
- troca de senha do próprio usuário
- reset de senha por admin

## Perfis

- `admin`
- `viewer`

## Regras importantes

- sempre deve existir ao menos um admin ativo
- inativar usuário encerra suas sessões
- username é tratado como identificador estável nesta fase

## Endpoints principais

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:username`
- `POST /api/admin/users/:username/reset-password`
- `POST /api/account/change-password`

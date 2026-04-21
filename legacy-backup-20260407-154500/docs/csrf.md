# CSRF

## Estratégia adotada

O sistema usa autenticação baseada em sessão. Para rotas mutáveis autenticadas, cada sessão possui um token CSRF persistido junto da própria sessão.

## Fluxo

1. o usuário faz login
2. o backend cria sessão e `csrfToken`
3. o frontend recebe o token em `/api/auth/me` ou `/api/bootstrap`
4. o frontend envia `x-csrf-token` nas rotas mutáveis
5. o backend valida o token via middleware

## Rotas protegidas

- logout
- troca de senha
- reset de senha
- criação/edição de usuário
- criação/edição/remoção de target
- execução manual de check
- limpeza administrativa

## Resposta de erro

Quando o token é inválido ou ausente:

- status `403`
- código `csrf_invalid`

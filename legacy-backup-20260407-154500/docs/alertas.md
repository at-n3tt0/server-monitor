# Alertas

## Estratégia

Os alertas são gerados no backend a partir do resultado de checks e das métricas do agente.

## Regras implementadas

- indisponibilidade de host/serviço
- alta latência
- alta perda de pacotes
- falha de DNS
- CPU alta
- RAM alta
- disco alto
- interface down
- link oscilando

## Ciclo de vida

1. o backend detecta a condição
2. o alerta é aberto ou atualizado
3. o alerta é salvo em SQLite
4. o alerta é emitido em WebSocket
5. quando a condição some, o alerta é resolvido

## Severidade

- `info`
- `warning`
- `critical`

## Persistência

Tabela:

- `alerts`

Eventos de apoio:

- `events`

Isso permite distinguir problemas ativos de mudanças de estado ao longo do tempo.

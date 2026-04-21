# Rede

## Papel do módulo de rede

Rede é tratada como domínio próprio, não como detalhe secundário.

## Métricas implementadas

- latência por múltiplas amostras ICMP
- packet loss
- jitter básico
- status de gateway
- check de DNS
- tráfego RX/TX por interface via agente
- status de interface via `operstate`
- histórico persistente em SQLite

## Como funciona

### Ping e gateway

O backend executa várias amostras de `ping` e calcula:

- latência média
- quantidade enviada
- quantidade recebida
- perda de pacotes
- jitter básico

### DNS

O backend usa `dns.Resolver` apontando para o servidor configurado no target.

### Interfaces

O agente coleta:

- bytes totais RX/TX
- taxa RX/TX
- `operstate`

## Preparação para SNMP

Fase futura prevista para:

- Mikrotik
- switches
- roteadores
- firewalls

A arquitetura já aceita:

- tipo `snmp`
- metadados SNMP no target
- persistência de métricas de rede compatível

# Agente

## Objetivo

O agente expoe metricas locais do servidor para o backend central via `GET /metrics`.

## Implementacao

Arquivos principais:

- `agent/src/server.js`: nucleo atual do agente
- `agent-runtime/`: runtime minimo dedicado para empacotamento
- `installers/windows/`: instalador, atualizador, desinstalador e script de bundle

Biblioteca usada:

- `systeminformation`

## Compatibilidade

- Windows
- Linux

## Seguranca

Autenticacao simples por `Bearer token` usando secret configuravel.

O secret nao fica hardcoded no codigo.

## Endpoints

- `GET /metrics`
- `GET /health`

## JSON retornado

Campos principais:

- `hostname`
- `actualHostname`
- `fqdn`
- `platform`
- `os`
- `osVersion`
- `kernel`
- `arch`
- `uptime`
- `cpu.usage`
- `cpu.cores`
- `memory.total`
- `memory.used`
- `memory.usedPercent`
- `disks[]`
- `network[]`
- `topProcesses[]`
- `relevantProcesses[]`
- `services[]`
- `listeningPorts[]`
- `shares[]` quando a coleta for suportada
- `rolesFeatures[]` quando a coleta for suportada
- `packages[]` quando a coleta for suportada
- `virtualization`
- `connections[]`
- `collection`
- `timestamp`

## Coleta profunda

O agente tenta coletar tambem sinais para diagnostico:

- servicos ativos
- portas em escuta
- processos relevantes
- compartilhamentos
- roles/features no Windows
- pacotes relevantes no Linux
- sinais de virtualizacao
- conexoes relevantes

Tudo isso e best-effort.
Se um item nao puder ser coletado, ele volta como ausente ou `null`.

## Tratamento de erro

- timeout interno de coleta
- resposta `401` quando o secret nao confere
- resposta `500` quando a coleta falha
- log de inicializacao, falhas de bind e erros de coleta no runtime instalavel

## Agente instalavel para Windows

Nesta fase, o InfraWatch Agent pode ser distribuido como componente proprio para Windows sem copiar o projeto inteiro.

Artefatos principais:

- `dist/agent/windows/InfraWatchAgent.exe`
- `dist/agent/windows/InfraWatchAgentSetup.exe`

Arquivos auxiliares:

- `install-agent.ps1`
- `update-agent.ps1`
- `uninstall-agent.ps1`

Modelo operacional recomendado:

- entregar `InfraWatchAgentSetup.exe`
- instalar com duplo clique ou em modo silencioso
- registrar o servico Windows com NSSM
- manter PowerShell apenas como apoio interno do setup ou para suporte tecnico

## Observacao

O agente nao grava historico localmente. Toda persistencia permanece centralizada no backend.

# Arquitetura

## Visao geral

O InfraWatch evolui por modulos, sem concentrar logica critica em arquivos monoliticos.

## Estrutura principal

- `backend/index.js`: inicializacao do backend
- `backend/config/config-loader.js`: leitura e persistencia da configuracao
- `backend/repositories/database.js`: camada SQLite
- `backend/middleware/`: autenticacao, autorizacao, CSRF e tratamento de erros
- `backend/services/checks/`: checks ativos e orquestracao
- `backend/services/auth/`: login, sessao e bootstrap de usuarios
- `backend/services/users/`: regras de gestao de usuarios
- `backend/services/audit/`: trilha de auditoria administrativa
- `backend/services/alerts/`: regras e ciclo de vida dos alertas
- `backend/services/history/`: montagem de historico para API e dashboard
- `backend/services/maintenance/`: retencao e manutencao do banco
- `backend/services/network/`: utilitarios de metricas de rede
- `backend/services/websocket/`: publicacao em tempo real
- `backend/services/discovery/`: montagem de contexto para diagnostico
- `backend/services/fingerprints/`: correlacao por regras e pesos
- `backend/services/diagnostics/`: diagnostico estruturado
- `backend/services/onboarding/`: fluxo assistido de entrada de hosts
- `agent/src/server.js`: agente HTTP com metricas locais e descoberta profunda
- `frontend/`: dashboard, area administrativa e visualizacao de diagnostico
- `shared/schemas/target-schema.js`: validacao e normalizacao dos targets
- `shared/templates/monitoring-profiles.js`: perfis de monitoramento pre-prontos

## Principios usados

- backend central e agente desacoplados
- persistencia separada da regra de negocio
- historico persistente e estado atual distintos
- checks ativos isolados por tipo
- autenticacao e autorizacao no backend central
- governanca administrativa com usuarios, auditoria e CSRF
- retencao e manutencao desacopladas da coleta
- diagnostico baseado em evidencia real e explicavel
- arquitetura aberta para novos coletores

## Diagnostico inteligente

Fluxo interno:

1. o agente coleta sinais tecnicos reais
2. o backend identifica targets relacionados ao mesmo host
3. o motor de fingerprint correlaciona processos, servicos, portas, checks e historico
4. o modulo de diagnostico monta um objeto estruturado
5. o frontend apresenta o resultado e sugere perfis/checks

## Onboarding inteligente

O onboarding reaproveita os modulos ja existentes:

1. target `agent` coleta metricas reais
2. o diagnostico inteligente correlaciona sinais
3. o modulo de onboarding escolhe o perfil mais aderente
4. os drafts reais de target sao materializados a partir dos perfis
5. o admin revisa e confirma
6. os targets sao criados usando a mesma validacao e persistencia do sistema

## Preparacao para SNMP

O tipo `snmp` ja existe no contrato de target e na engine de checks.
Hoje ele retorna estado `unknown`, mas ja ha:

- suporte de configuracao no schema compartilhado
- espaco em `metadata.snmp`
- roteamento pronto no backend
- perfis de rede preparados para crescer com SNMP
- diagnostico com limitacoes explicitas para papeis de rede mais profundos

Isso reduz o acoplamento quando a fase de coleta SNMP for implementada.

# Diagnostico Inteligente

## Objetivo

O modulo de Diagnostico Inteligente do InfraWatch cruza evidencias reais para produzir uma classificacao explicavel e acionavel por host.

Ele nao depende de IA generativa para funcionar.

A base atual usa:

- dados reais do agente
- checks ativos ja existentes
- historico persistido no banco
- regras ponderadas de fingerprint

## Fluxo

1. o agente coleta sinais tecnicos do host
2. o backend monta um contexto com targets relacionados, estado atual e historico
3. o motor de fingerprint aplica regras e pesos
4. o modulo gera um objeto estruturado de diagnostico
5. o frontend apresenta papeis, evidencias, riscos, lacunas e recomendacoes

## Evidencias analisadas

Quando disponiveis, entram na correlacao:

- sistema operacional
- hostname e FQDN
- uptime
- processos relevantes
- servicos ativos
- portas em escuta
- compartilhamentos detectados
- roles/features do Windows
- pacotes relevantes no Linux
- sinais de virtualizacao
- checks ja cadastrados
- estado atual e historico recente
- alertas ativos

Se algum sinal nao existir, o sistema registra a limitacao e nao inventa conclusao.

## Papéis detectaveis nesta fase

Servidores:

- servidor de arquivos
- servidor DNS
- controlador de dominio / AD
- servidor web
- servidor de aplicacao
- servidor de banco de dados
- host Linux generico
- host Windows generico
- host de virtualizacao
- servidor proxy
- servidor de impressao
- servidor de backup

Rede:

- gateway
- firewall
- roteador
- Mikrotik
- switch
- access point

## Como a confianca e calculada

Cada papel possui um conjunto de evidencias com peso.

Exemplos:

- porta 53 em escuta
- processo `named`
- servico DNS ativo
- role DNS instalada
- check DNS ja configurado

Quanto mais evidencias coerentes forem encontradas, maior o score.

O diagnostico so publica um papel quando o score minimo daquele papel e atingido.

## Objeto gerado

O diagnostico retorna pelo menos:

- `hostId`
- `targetId`
- `generatedAt`
- `identity`
- `relatedTargets`
- `detectedRoles[]`
- `healthSummary`
- `risks[]`
- `monitoringGaps[]`
- `recommendedProfiles[]`
- `recommendedChecks[]`
- `suggestedActions[]`
- `notes[]`
- `limitations[]`
- `explainability`

## Endpoints

- `GET /api/diagnostics/:targetId`
  - retorna o ultimo snapshot persistido
  - se nao existir snapshot, gera um diagnostico em memoria

- `POST /api/diagnostics/run/:targetId`
  - executa um novo diagnostico
  - persiste snapshot em `diagnostic_snapshots`
  - registra auditoria administrativa quando houver contexto de requisicao

## Persistencia

Snapshots diagnosticos ficam na tabela:

- `diagnostic_snapshots`

Campos principais:

- `target_id`
- `host_key`
- `diagnosis_json`
- `created_at`

## Integracao com perfis de monitoramento

O motor relaciona papeis detectados com a biblioteca de perfis ja existente.

Exemplos:

- `dns_server` -> `dns-server`
- `file_server` -> `file-server`
- `web_server` -> `web-server`
- `database_server` -> `database-server`
- `gateway` -> `gateway`

O frontend nao aplica nada automaticamente.
Ele apenas sugere o perfil e, para admin, permite abrir o fluxo de criacao com confirmacao humana.

## Limitacoes atuais

- a correlacao entre varios targets do mesmo host depende de hostnames, IPs e URL host coerentes
- ainda nao existe resolucao cruzada IP <-> hostname para agrupar ativos automaticamente
- papeis de rede avancados ainda ficam limitados sem SNMP
- o diagnostico usa regras explicaveis; a camada interpretativa por IA fica apenas preparada para fase futura

## Evolucao futura

Esta base ja deixa preparado:

- enriquecimento por SNMP para Mikrotik, switches, roteadores e firewalls
- comparacao historica de snapshots diagnosticos
- interpretacao textual assistida por IA sobre um conjunto tecnico ja estruturado e rastreavel

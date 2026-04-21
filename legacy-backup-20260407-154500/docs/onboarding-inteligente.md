# Onboarding Inteligente

## Objetivo

Ajudar o admin a transformar um host com agente ativo em um host monitorado de forma mais completa, sem aplicar nada automaticamente.

## Fluxo

1. o host precisa ter target `agent`
2. o agente precisa ter coleta recente real
3. o host aparece como elegivel
4. o admin abre a tela de onboarding
5. o sistema roda ou reaproveita o diagnostico
6. o sistema sugere um perfil de monitoramento
7. o sistema mostra os targets reais que serao criados
8. o admin revisa os drafts
9. o admin confirma a aplicacao
10. a acao vai para auditoria

## Como a elegibilidade e decidida

O host e considerado elegivel quando:

- existe target `agent` ativo
- ha coleta recente persistida para esse target
- o host ainda esta novo ou com lacunas objetivas de monitoramento

O sistema nao inventa host elegivel. Se nao houver coleta recente real, ele nao aparece na lista.

## Como o perfil recomendado e definido

O onboarding nao usa IA solta.

Ele reaproveita o diagnostico inteligente existente:

- papeis detectados
- confianca
- evidencias
- lacunas de monitoramento

O perfil sugerido vem do papel mais forte ou da lacuna mais aderente, sempre limitado aos perfis que o InfraWatch realmente suporta hoje.

## Como os drafts sao gerados

Os drafts sao materializados a partir da biblioteca de perfis de monitoramento.

O sistema:

- preenche contexto basico do host
- gera os targets reais do perfil
- remove o que ja estiver coberto por targets relacionados
- valida o que ainda precisa de revisao manual

Se faltar dado obrigatorio, como URL real para um check HTTP, o draft continua visivel mas marcado para revisao.

## Aplicacao

Nada e aplicado automaticamente.

Na aplicacao:

- o admin confirma
- o backend valida cada target com a mesma regra usada no CRUD normal
- os targets sao persistidos
- a configuracao e reagendada
- a acao e gravada na auditoria

## Limitacoes atuais

- o host precisa ja existir como target `agent`
- nao existe descoberta autonoma de agente fora da base atual de targets
- sem coleta real de agente, nao ha onboarding
- papeis de rede mais profundos continuam limitados sem SNMP

## Evolucao futura

Proximas fases naturais:

- descoberta assistida de agentes novos
- comparacao entre snapshots de onboarding
- enriquecimento com SNMP para ativos de rede

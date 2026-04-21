# Frontend

## Objetivo

O frontend entrega uma visao operacional em tempo real sem depender de build steps extras.
Ele e servido diretamente pelo backend.

## Arquivos principais

- `frontend/index.html`
- `frontend/styles.css`
- `frontend/app.js`

## Funcionalidades

- tela de login
- restauracao de sessao autenticada
- ocultacao de acoes administrativas por perfil
- dashboard NOC em tempo real
- estados visuais reais de loading, sem dados e erro
- gestao completa de targets para admin
- gestao de usuarios para admin
- consulta de auditoria para admin
- troca de senha do usuario autenticado
- tratamento de CSRF no cliente
- perfis de monitoramento no fluxo de criacao
- tela de diagnostico inteligente
- tela de onboarding inteligente
- visualizacao especializada por tipo de monitoramento

## Fonte de dados

- autenticacao por `/api/auth/*`
- carga inicial por `GET /api/bootstrap`
- atualizacoes incrementais via WebSocket `/ws`
- modulos administrativos por `/api/admin/*`
- perfis por `GET /api/monitoring-profiles`
- diagnostico por `GET /api/diagnostics/:targetId` e `POST /api/diagnostics/run/:targetId`

## Diagnostico inteligente

A tela de diagnostico mostra:

- identidade do host
- papeis detectados e confianca
- evidencias tecnicas
- saude atual
- riscos e sintomas
- lacunas de monitoramento
- perfis recomendados
- checks recomendados
- acoes sugeridas
- notas e limitacoes

Admin pode abrir o fluxo de criacao com o perfil recomendado, mas nada e aplicado automaticamente.

## Onboarding

A area administrativa de `Onboarding` mostra:

- hosts elegiveis com agente
- status do onboarding
- papel provavel
- confianca
- evidencias
- lacunas
- perfil sugerido
- drafts editaveis dos targets que serao criados

Somente `admin` pode aplicar a recomendacao.

## Visualizacao especializada por tipo

No dashboard principal, o target selecionado nao usa mais um conjunto generico unico de paineis.

Agora o frontend troca os paineis conforme o tipo real:

- `ping`: latencia, perda, jitter, disponibilidade e timeline de quedas
- `agent`: CPU, memoria, disco por particao, trafego, interfaces, processos e saude do host
- `http`: resposta, disponibilidade, status code, degradacao e falhas
- `tcp`: disponibilidade da porta, resposta TCP, falhas e timeline
- `dns`: resolucao, disponibilidade, falhas e resumo operacional
- `gateway`: latencia, perda, jitter, disponibilidade e oscilacao

Quando nao houver serie real suficiente, o painel mostra estado de `sem dados` em vez de inventar informacao.

## Observacao

O frontend foi mantido em JavaScript puro para simplificar operacao e reduzir complexidade de build no projeto atual.

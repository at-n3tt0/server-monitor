# InfraWatch

InfraWatch e uma plataforma modular de monitoramento de infraestrutura com backend central, dashboard web em tempo real, agente para coleta local, auditoria administrativa, autenticacao por sessao e persistencia em SQLite.

Esta base ja esta preparada para uso real no dia a dia, sem necessidade de reescrever o sistema ou alterar a arquitetura atual.

## O que voce precisa instalar

- Node.js 20 ou superior
- npm
- sistema operacional Windows ou Linux
- utilitario `ping` disponivel no sistema

Dependencias do projeto:

- `express`
- `ws`
- `better-sqlite3`
- `systeminformation`
- `cookie`

Elas sao instaladas com:

```powershell
npm install
```

## Estrutura principal

- `server.js`: entrypoint do backend
- `agent.js`: entrypoint do agente
- `config/monitor.json`: configuracao principal
- `backend/`: API, checks, historico, alertas, autenticacao e auditoria
- `frontend/`: dashboard e area administrativa
- `agent/src/server.js`: servidor HTTP do agente
- `backend/data/monitor.db`: banco SQLite

## Configuracao principal

Arquivo:

- [config/monitor.json](c:/Users/antonio.neto/server-monitor/config/monitor.json)

Pontos mais importantes:

- `backend.port`: porta do sistema web
- `backend.host`: bind do backend
- `monitoring.defaultIntervalSeconds`: intervalo padrao
- `auth.sessionTtlHours`: duracao da sessao
- `auth.secureCookies`: use `true` em ambiente HTTPS
- `retention.*`: retencao de historico
- `maintenance.*`: limpeza e manutencao automatica
- `targets`: targets iniciais

## Como criar o primeiro usuario admin

O jeito mais simples e seguro de criar um admin e usando o script oficial:

```powershell
npm run create-user -- admin admin MinhaSenhaForte123
```

Regras minimas da senha:

- pelo menos 10 caracteres
- pelo menos uma letra minuscula
- pelo menos uma letra maiuscula
- pelo menos um numero

Se quiser apenas gerar hash:

```powershell
npm run hash-password -- MinhaSenhaForte123
```

## Como subir o backend

Na raiz do projeto:

```powershell
npm install
npm run backend
```

Por padrao o backend sobe em:

- `http://localhost:3000`

## Como subir o agente

O agente pode rodar em Windows e Linux.

Sem autenticacao:

```powershell
npm run agent
```

Com autenticacao simples por secret:

```powershell
$env:SECRET="MeuSecretDoAgente"
npm run agent
```

Ou definindo porta e secret diretamente:

```powershell
node agent.js 9090 MeuSecretDoAgente
```

Por padrao o agente sobe em:

- `http://localhost:9090`
- endpoint principal: `http://localhost:9090/metrics`

## Instalador do agente para Windows

O projeto agora possui distribuicao profissional do InfraWatch Agent para Windows, sem necessidade de copiar o projeto completo para o servidor monitorado.

Estrutura principal:

- `agent-runtime/`
- `installers/windows/`
- `packaging/windows/`
- `dist/agent/windows/`

Para gerar o executavel standalone:

```powershell
npm run build-agent-exe
```

Resultado:

- `dist/agent/windows/InfraWatchAgent.exe`

Para gerar o setup grafico `.exe`:

```powershell
npm run build-agent-setup
```

O resultado fica em:

- `dist/agent/windows/`

Conteudo principal:

- `InfraWatchAgent.exe`
- `InfraWatchAgentSetup.exe`
- `runtime\`
- `install-agent.ps1`
- `update-agent.ps1`
- `uninstall-agent.ps1`

Experiencia principal:

- executar `InfraWatchAgentSetup.exe`
- seguir o wizard grafico
- definir porta, secret e alias
- concluir com o servico instalado e iniciado

Modo silencioso para rollout corporativo:

```powershell
.\dist\agent\windows\InfraWatchAgentSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /PORT=9090 /SECRET="MeuSecretDoAgente123" /HOSTALIAS="SRV-WIN-01" /OPENFIREWALL=true
```

Observacoes:

- o setup continua sendo a experiencia principal
- o servico Windows agora e registrado via NSSM
- o PowerShell fica apenas como apoio interno do instalador e para suporte tecnico
- a configuracao em `ProgramData` e preservada por padrao em reinstalacoes e upgrades

Dependencia atual na maquina alvo:

- nao e necessario instalar `Node.js` quando voce usa `InfraWatchAgent.exe` ou `InfraWatchAgentSetup.exe`

Instalacao grafica:

```powershell
.\dist\agent\windows\InfraWatchAgentSetup.exe
```

Fluxo alternativo por script, mantido como apoio interno:

```powershell
cd .\dist\agent\windows
.\install-agent.ps1 -Port 9090 -Secret "MeuSecretDoAgente123" -HostAlias "SRV-WIN-01" -OpenFirewall
```

Arquivos no servidor Windows:

- runtime: `C:\Program Files\InfraWatch Agent`
- configuracao: `C:\ProgramData\InfraWatch Agent\config\agent.config.json`
- logs: `C:\ProgramData\InfraWatch Agent\logs\agent.log`

Administracao do servico:

```powershell
Get-Service InfraWatchAgent
Start-Service InfraWatchAgent
Stop-Service InfraWatchAgent
Restart-Service InfraWatchAgent
```

Atualizacao:

```powershell
npm run build-agent-setup
```

Depois distribua o novo `InfraWatchAgentSetup.exe` e execute por cima da instalacao anterior.
A configuracao em `ProgramData` e preservada por padrao.

Atualizacao silenciosa:

```powershell
.\dist\agent\windows\InfraWatchAgentSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Desinstalacao principal:

- pelo desinstalador padrao do Windows criado pelo setup

Suporte por script, se necessario:

```powershell
cd .\dist\agent\windows
.\uninstall-agent.ps1
```

Ou removendo tambem configuracao e logs:

```powershell
.\uninstall-agent.ps1 -RemoveData
```

## Como acessar o sistema

Com o backend rodando, abra no navegador:

- `http://localhost:3000`

Fluxo inicial:

1. crie um usuario `admin`
2. abra o login
3. entre com usuario e senha
4. verifique o dashboard
5. abra a area administrativa se estiver com perfil `admin`

## Como cadastrar um target de agente

Na area administrativa:

1. abra `Targets`
2. clique em `Novo target`
3. escolha o tipo `agent`
4. informe a URL base do agente, por exemplo `http://192.168.1.50:9090`
5. se houver secret, preencha o campo `Secret do agente`
6. ajuste timeout e intervalo
7. salve

Recomendacao operacional para targets `agent`:

- use timeout maior que checks simples
- comece com `10000` a `15000` ms

Isso ajuda porque a coleta do agente usa `systeminformation` e pode levar varios segundos dependendo da maquina.

## Como validar se tudo esta funcionando

### Backend

Abra:

- `http://localhost:3000/api/health`

Esperado:

- resposta JSON com `ok: true`

### Login

Entre com o usuario criado pelo script.

Esperado:

- acesso ao dashboard
- `viewer` nao ve telas administrativas
- `admin` ve `Targets`, `Usuarios` e `Auditoria`

### Dashboard

Esperado:

- cards de resumo
- lista de targets
- detalhe do target selecionado
- alertas e eventos
- atualizacao em tempo real por WebSocket

### Agente

Teste direto no navegador ou terminal:

Sem secret:

- `http://localhost:9090/metrics`

Com secret:

```powershell
curl.exe -H "Authorization: Bearer MeuSecretDoAgente" http://localhost:9090/metrics
```

Esperado:

- `hostname`
- `os`
- `uptime`
- `cpu`
- `memory`
- `disks`
- `network`

## Uso no dia a dia

Rotina recomendada:

1. acessar o dashboard para ver o status geral
2. abrir os detalhes do target quando houver degradacao ou indisponibilidade
3. usar a tela de alertas para identificar severidade e alvo afetado
4. usar `Targets` para ajustar ou cadastrar novos alvos
5. usar `Usuarios` para administrar acesso
6. usar `Auditoria` para revisar mudancas administrativas
7. usar `Minha Conta` para trocar a propria senha

## O que ja foi validado nesta base

- backend sobe corretamente
- frontend e servido pelo backend
- login autenticado funciona
- protecao de API e WebSocket esta ativa
- CSRF esta ativo para rotas mutaveis autenticadas
- criacao de usuario admin pelo script funciona
- CRUD administrativo de targets e usuarios responde
- agente responde em `/metrics`
- o modulo de check do agente responde corretamente com autenticacao Bearer

## Perfis de Monitoramento

O InfraWatch agora possui uma biblioteca de perfis pre-prontos e editaveis no fluxo de criacao de targets.

Categorias disponiveis:

- servidor
- rede

Os perfis apenas pre-configuram checks reais que o sistema ja suporta hoje, como:

- `ping`
- `http`
- `tcp`
- `dns`
- `gateway`
- `agent`

Eles nao criam monitoramento ficticio, nao simulam SNMP e nao inventam dados.

Ao aplicar um perfil:

1. o usuario escolhe categoria e perfil
2. informa dados base como host, URL, agente e portas configuraveis
3. o frontend gera uma lista editavel de targets reais
4. o usuario pode revisar e editar antes de salvar
5. depois de salvos, os targets continuam editaveis normalmente

Limitacao atual dos perfis:

- equipamentos como Mikrotik, switch, firewall e access point ficam preparados para a fase SNMP, mas nesta fase usam apenas checks ja suportados pelo backend atual

## Diagnostico Inteligente

O InfraWatch agora possui um modulo real de Diagnostico Inteligente de Infraestrutura.

Essa camada nao usa mock, nao inventa papel do host e nao depende de IA generativa para funcionar.

Ela cruza:

- dados reais do agente
- checks ativos ja existentes
- historico persistido
- alertas ativos
- perfis de monitoramento ja cadastrados

O resultado por host inclui:

- papel provavel do host
- confianca da deteccao
- evidencias tecnicas observadas
- resumo de saude
- riscos identificados
- lacunas de monitoramento
- perfis recomendados
- checks recomendados
- acoes sugeridas

Uso pratico:

1. selecione um target
2. abra a aba `Diagnostico`
3. clique em `Atualizar diagnostico` para persistir um novo snapshot
4. revise papeis detectados, riscos, gaps e recomendacoes
5. se voce for admin, use `Abrir perfil recomendado` para abrir a criacao assistida com confirmacao humana

Limitacoes atuais:

- a correlacao entre varios targets do mesmo host depende de host/IP/URL coerentes
- papeis de rede avancados ainda ficam limitados sem SNMP
- a camada interpretativa por IA fica apenas preparada para fase futura

## Onboarding Inteligente

O InfraWatch agora possui um fluxo de onboarding assistido para hosts com agente.

Fluxo:

1. o host precisa ter um target `agent` funcional e coleta recente real
2. o host aparece como elegivel na area `Onboarding`
3. o admin roda a analise
4. o sistema reutiliza o diagnostico inteligente e os perfis de monitoramento
5. o sistema mostra exatamente quais targets reais serao criados
6. o admin revisa os drafts
7. o admin confirma a aplicacao
8. os targets sao criados e a acao vai para a auditoria

Regras importantes:

- nada e aplicado automaticamente
- nenhum dado ficticio e usado
- nenhum check nao suportado e inventado
- se faltar dado real, o sistema mostra a limitacao

Elegibilidade atual:

- o host precisa ter target `agent`
- o agente precisa ter coleta recente persistida
- o host precisa estar novo ou com lacunas objetivas de monitoramento

Limitacao atual:

- o onboarding ainda depende de o agente ja existir como target conhecido pelo backend
- nao ha descoberta autonoma fora do modelo atual de targets

## Variaveis e cuidados operacionais

Variaveis uteis:

- `PORT`: porta do backend
- `HOST`: bind do backend
- `NODE_ENV=production`: ativa comportamento de producao
- `SECRET`: secret do agente
- `SERVER_MONITOR_BOOTSTRAP_ADMIN_USERNAME`
- `SERVER_MONITOR_BOOTSTRAP_ADMIN_PASSWORD`
- `SERVER_MONITOR_BOOTSTRAP_ADMIN_PASSWORD_HASH`

Cuidados:

- em HTTPS, configure `auth.secureCookies = true`
- nao exponha o agente sem necessidade na internet publica
- use senha forte para administradores
- faca backup do arquivo SQLite em `backend/data/monitor.db`

## Limites atuais

- SNMP ainda nao foi implementado
- PostgreSQL ainda nao foi implementado
- o banco atual continua sendo SQLite
- o agente pode precisar de timeout maior em maquinas mais lentas

## Guia rapido

```powershell
npm install
npm run create-user -- admin admin MinhaSenhaForte123
npm run backend
```

Em outro terminal:

```powershell
$env:SECRET="MeuSecretDoAgente"
npm run agent
```

Depois:

1. abra `http://localhost:3000`
2. faca login com o admin criado
3. cadastre targets
4. acompanhe dashboard, alertas e auditoria

## Documentacao complementar

- [docs/agente.md](c:/Users/antonio.neto/server-monitor/docs/agente.md)
- [docs/agente-instalacao-windows.md](c:/Users/antonio.neto/server-monitor/docs/agente-instalacao-windows.md)
- [docs/arquitetura.md](c:/Users/antonio.neto/server-monitor/docs/arquitetura.md)
- [docs/backend.md](c:/Users/antonio.neto/server-monitor/docs/backend.md)
- [docs/frontend.md](c:/Users/antonio.neto/server-monitor/docs/frontend.md)
- [docs/seguranca.md](c:/Users/antonio.neto/server-monitor/docs/seguranca.md)
- [docs/retencao.md](c:/Users/antonio.neto/server-monitor/docs/retencao.md)
- [docs/usuarios.md](c:/Users/antonio.neto/server-monitor/docs/usuarios.md)
- [docs/auditoria.md](c:/Users/antonio.neto/server-monitor/docs/auditoria.md)
- [docs/csrf.md](c:/Users/antonio.neto/server-monitor/docs/csrf.md)
- [docs/diagnostico-inteligente.md](c:/Users/antonio.neto/server-monitor/docs/diagnostico-inteligente.md)
- [docs/onboarding-inteligente.md](c:/Users/antonio.neto/server-monitor/docs/onboarding-inteligente.md)

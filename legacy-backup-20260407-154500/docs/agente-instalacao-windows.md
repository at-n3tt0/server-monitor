# Instalacao do Agente no Windows

## Objetivo

Instalar o InfraWatch Agent em Windows como software de uso real:

- executavel standalone
- setup grafico `.exe`
- servico Windows
- configuracao externa
- logs

## Artefatos gerados

Executavel do agente:

- `dist/agent/windows/InfraWatchAgent.exe`

Setup grafico:

- `dist/agent/windows/InfraWatchAgentSetup.exe`

## Como gerar

Executavel standalone:

```powershell
npm run build-agent-exe
```

Setup `.exe`:

```powershell
npm run build-agent-setup
```

## Estrategia usada

### 1. Runtime standalone

O runtime do agente e empacotado com `pkg`, gerando um binario Windows:

- `InfraWatchAgent.exe`

Esse binario ja embute o runtime Node necessario para executar o agente.

### 2. Setup grafico

O setup e compilado com Inno Setup:

- wizard grafico
- instalacao em `Program Files`
- configuracao em `ProgramData`
- registro do servico Windows via NSSM
- inicio automatico
- opcao de regra de firewall

## Instalacao pelo usuario final

1. distribua `InfraWatchAgentSetup.exe`
2. execute com duplo clique
3. siga o wizard
4. informe:
   - porta
   - secret
   - alias do host
5. conclua

Ao final, o setup:

- copia `InfraWatchAgent.exe`
- copia `nssm.exe` como wrapper de servico
- cria configuracao externa
- registra o servico Windows
- inicia o servico

## Instalacao silenciosa

O setup suporta rollout corporativo sem interface.

Exemplo:

```powershell
.\InfraWatchAgentSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /PORT=9090 /SECRET="MeuSecretDoAgente123" /HOSTALIAS="SRV-WIN-01" /OPENFIREWALL=true
```

Parametros suportados pelo setup:

- `/PORT=9090`
- `/SECRET=...`
- `/HOSTALIAS=...`
- `/OPENFIREWALL=true|false`

Parametros padrao do Inno Setup recomendados para automacao:

- `/SILENT`
- `/VERYSILENT`
- `/SUPPRESSMSGBOXES`
- `/NORESTART`
- `/DIR="C:\Program Files\InfraWatch Agent"` quando precisar sobrescrever o destino

Observacoes operacionais:

- a instalacao silenciosa continua registrando o servico `InfraWatchAgent`
- a configuracao e criada em `ProgramData`
- se ja existir configuracao, ela e preservada por padrao
- os mesmos parametros podem ser usados em GPO, RMM, PsExec ou ferramenta corporativa equivalente

## Locais usados no Windows

Binario:

- `C:\Program Files\InfraWatch Agent\InfraWatchAgent.exe`

Configuracao:

- `C:\ProgramData\InfraWatch Agent\config\agent.config.json`

Logs:

- `C:\ProgramData\InfraWatch Agent\logs\agent.log`

## Configuracao externa

Arquivo:

- `C:\ProgramData\InfraWatch Agent\config\agent.config.json`

Campos:

- `port`
- `secret`
- `hostAlias`
- `bindHost`
- `logLevel`
- `serviceName`

Depois de editar, reinicie o servico.

## Administracao do servico

O servico `InfraWatchAgent` e registrado com NSSM, apontando para:

- `Application`: `C:\Program Files\InfraWatch Agent\InfraWatchAgent.exe`
- `AppParameters`: `--config "C:\ProgramData\InfraWatch Agent\config\agent.config.json"`
- `AppDirectory`: `C:\Program Files\InfraWatch Agent`

```powershell
Get-Service InfraWatchAgent
Start-Service InfraWatchAgent
Stop-Service InfraWatchAgent
Restart-Service InfraWatchAgent
```

## Teste do agente

Health:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:9090/health -Headers @{ Authorization = "Bearer MeuSecretDoAgente123" }
```

Metrics:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:9090/metrics -Headers @{ Authorization = "Bearer MeuSecretDoAgente123" }
```

## Atualizacao

Fluxo atual:

1. gere um novo `InfraWatchAgentSetup.exe`
2. execute o setup novamente na maquina alvo

Comportamento esperado:

- binarios sao atualizados
- configuracao em `ProgramData` e preservada por padrao
- logs sao preservados
- servico continua no mesmo modelo

Exemplo de atualizacao silenciosa:

```powershell
.\InfraWatchAgentSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

## Desinstalacao

Principal:

- usar o desinstalador padrao do Windows criado pelo setup

Durante a desinstalacao, o instalador pergunta se deve remover tambem:

- configuracao
- logs

Tambem existe suporte por script:

- `dist/agent/windows/uninstall-agent.ps1`

## Logs

Arquivo principal:

- `C:\ProgramData\InfraWatch Agent\logs\agent.log`

Eventos registrados:

- inicializacao
- parada
- falha de bind
- falha fatal de inicializacao
- erros de coleta
- excecoes nao tratadas

## Seguranca

- o secret nao fica hardcoded no codigo
- o secret nao e escrito em logs pelo runtime
- a configuracao fica externa e editavel

## Limitacoes atuais

- o setup depende de build em maquina Windows para compilar com Inno Setup
- a configuracao do setup e preservada por padrao em upgrades; alteracoes pelo wizard nao sobrescrevem config existente sem ajuste manual
- ainda nao ha MSI
- ainda nao ha assinatura de codigo
- o setup usa PowerShell apenas como apoio interno para orquestrar o NSSM, mas a experiencia principal continua sendo `Setup.exe`

## Proximos passos recomendados

- assinar `InfraWatchAgent.exe` e `InfraWatchAgentSetup.exe`
- permitir alteracao guiada da configuracao em upgrades
- gerar MSI se fizer sentido para distribuicao corporativa

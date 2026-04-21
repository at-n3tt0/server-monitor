# Server Monitor

Plataforma de monitoramento de infraestrutura com:

- backend FastAPI + SQLAlchemy + Alembic
- PostgreSQL
- frontend React + TypeScript + Vite
- WebSocket nativo para atualizacao em tempo real
- dashboard com estados honestos
- collectors reais por perfil
- seed estrutural apenas com hosts auditados

## Estrutura

```text
backend/
  app/
    api/
    collectors/
    core/
    db/
    models/
    repositories/
    schemas/
    services/
    utils/
    websocket/
    main.py
  alembic/
frontend/
  src/
    app/
    components/
    hooks/
    modules/
    pages/
    services/
    store/
    types/
    utils/
agent/
scripts/
```

## Execucao

1. Copie `.env.example` para `.env`.
2. Preencha as credenciais reais que forem necessarias para coleta profunda.
3. Rode `npm run setup`.
4. Rode `npm run dev`.

Servicos padrao nesta base:

- API: `http://localhost:8010`
- Frontend Vite: `http://localhost:5173`
- PostgreSQL: `localhost:55432`

## Scripts

- `npm run setup`: sobe PostgreSQL, instala dependencias e aplica migrations
- `npm run dev`: sobe backend e frontend em paralelo
- `npm run build`: build de producao do frontend
- `npm run backend:migrate`: aplica migrations manualmente
- `scripts/install-agent-windows.ps1`
- `scripts/uninstall-agent-windows.ps1`
- `scripts/install-agent-linux.sh`
- `scripts/uninstall-agent-linux.sh`

## O que foi implementado nesta fase

- modelagem operacional para:
  - `monitoring_profiles`
  - `host_credential_bindings`
  - `host_capabilities`
  - `collector_bindings`
  - `service_checks`
  - `service_check_results`
  - `alert_rules`
  - `host_collection_states`
- perfis:
  - `proxmox`
  - `windows_dc`
  - `windows_file_server`
  - `windows_legacy_app`
  - `linux_app`
  - `mikrotik_router`
- cadastro estrutural dos 6 hosts auditados, sem metricas fake
- cadastro estrutural do gateway MikroTik CCR, sem metricas fake
- limpeza automatica de hosts legados/importados fora do inventario auditado
- collectors reais:
  - `proxmox_api`
  - `ssh_linux`
  - `winrm_windows`
  - `agent`
  - `ping`
  - `tcp`
  - `http`
- dashboard adaptado para:
  - perfil do host
  - servicos criticos
  - VMs do Proxmox
  - contexto operacional
  - estados honestos de integracao
- alertas operacionais para host, servico, VM e falha de coleta
- agente proprio leve em `agent/`
- scripts de instalacao e remocao com suporte a restricao por IP do servidor central

## Inventario auditado

| Host | IP | Perfil | Papel | Criticidade | Coleta prevista |
| --- | --- | --- | --- | --- | --- |
| `pve` | `192.168.2.208` | `proxmox` | Proxmox VE 9.1 | alta | API Proxmox, SSH fallback, TCP passivo |
| `srv-00` | `192.168.2.204` | `windows_dc` | BDC + DNS secundario + backup futuro | critica | WinRM seguro, TCP passivo |
| `srv-01` | `192.168.2.205` | `windows_dc` | PDC + DNS primario + impressao + DFSR | critica | agente existente se compativel, WinRM fallback, TCP passivo |
| `srv-03` | `192.168.2.207` | `windows_file_server` | file server | alta | WinRM seguro, TCP passivo |
| `srv-04` | `192.168.2.209` | `windows_legacy_app` | Folha / Oracle XE / Firebird / Veeam / Hyper-V | alta | WinRM seguro, TCP passivo |
| `cicel` | `192.168.2.189` | `linux_app` | app server SICEL | alta | SSH seguro, healthcheck HTTP, TCP passivo |
| `ccr` | `192.168.2.1` | `mikrotik_router` | gateway MikroTik CCR | critica | ICMP, TCP 53, TCP 2000, TCP 2020, gerencia profunda pendente |

## Matriz operacional

| Host | Modo atual | Modo alvo | Metricas/checagens ja ativas | Alertas previstos | Portas necessarias | Dependencia atual |
| --- | --- | --- | --- | --- | --- | --- |
| `pve` | sem agente | API/SSH | TCP 22, 3128, 8006 | host offline, latencia, CPU, RAM, storage, VM down | 8006, 22 | token da API Proxmox ou senha SSH |
| `srv-00` | sem agente | WinRM seguro | TCP 53, 88, 389, 445, 5432 | host offline, AD/DNS/Netlogon/KDC/DFSR, PostgreSQL, disco | 5985, 53, 88, 389, 445, 5432 | conta WinRM dedicada |
| `srv-01` | agente compativel pendente | agente ou WinRM | TCP 9090, 53, 88, 389, 445 | host offline, AD/DNS/Netlogon/KDC/DFSR, spooler, falha do agente | 9090, 5985, 53, 88, 389, 445 | token do InfraWatchAgent ou credencial WinRM |
| `srv-03` | sem agente | WinRM ou agente leve | TCP 445, 3389 | host offline, SMB, volume critico, espaco baixo | 5985, 445, 3389 | conta WinRM dedicada |
| `srv-04` | sem agente | WinRM ou agente leve | TCP 1521, 3050, 2179, 6160, 7070 | Oracle down, Firebird down, Veeam/Hyper-V/AnyDesk, disco | 5985, 1521, 3050, 2179, 6160, 7070 | conta WinRM local restrita |
| `cicel` | sem agente | SSH ou agente Linux | SSH 22, HTTP `/login` | nginx/php-fpm/mysql/ufw/fail2ban, backup, healthcheck | 22, 80/443 | senha SSH ou chave dedicada |
| `ccr` | sem agente | gerencia RouterOS ou SNMP | ICMP, TCP 53, TCP 2000, TCP 2020 | host offline, latencia, DNS exposto, bandwidth-test exposto, gerencia administrativa exposta | 22/8291/8728 ou 2020 liberados apenas por IP de monitoramento | protocolo da 2020 ainda nao identificado deste host |

## Estado atual do dashboard

O dashboard ja exibe:

- os 6 hosts reais cadastrados
- perfil, papel, criticidade e tags
- collector atual
- status do host
- estado de integracao
- servicos criticos por host
- graficos reais, mas vazios quando nao existe historico real suficiente
- estados honestos como:
  - `aguardando coleta`
  - `sem historico disponivel`
  - `integracao pendente`
  - `host offline`
  - `erro de coleta`

Neste momento, como as credenciais profundas ainda nao foram configuradas, a visao esta operando majoritariamente em modo passivo:

- varios hosts aparecem como `degraded`
- isso significa que o ICMP nao respondeu, mas servicos reais continuam acessiveis por TCP/HTTP
- nenhum grafico esta sendo preenchido com dados inventados

## Validacao tecnica executada

Validado nesta data, `2026-04-07`:

- migration `20260407_0002` aplicada em PostgreSQL
- API FastAPI subindo em `8010`
- login JWT funcional
- bootstrap do dashboard retornando exatamente 6 hosts auditados
- WebSocket `/ws/dashboard` publicando `dashboard.bootstrap`
- frontend compilando com sucesso via `npm run build`
- checks passivos reais observados:
  - `pve`: TCP 22, 3128, 8006
  - `srv-00`: TCP 53, 88, 389, 445
  - `srv-01`: TCP 9090, 53, 88, 389, 445
  - `srv-03`: TCP 445, 3389
  - `srv-04`: TCP 1521, 3050, 2179, 6160, 7070
  - `cicel`: TCP 22 e HTTP `http://192.168.2.189/login`
- compatibilidade parcial do agente legado em `srv-01` confirmada:
  - a porta `9090` responde
  - o endpoint exige autenticacao
  - falta o token real para validar coleta no formato final

## Credenciais e variaveis necessarias

Preencher no `.env` conforme o inventario:

- `SERVER_MONITOR_PVE_API_TOKEN_ID`
- `SERVER_MONITOR_PVE_API_TOKEN_SECRET`
- `SERVER_MONITOR_PVE_SSH_PASSWORD`
- `SERVER_MONITOR_SRV00_PASSWORD`
- `SERVER_MONITOR_SRV01_PASSWORD`
- `SERVER_MONITOR_SRV01_AGENT_TOKEN`
- `SERVER_MONITOR_SRV03_PASSWORD`
- `SERVER_MONITOR_SRV04_PASSWORD`
- `SERVER_MONITOR_CICEL_SSH_PASSWORD`
- `SERVER_MONITOR_CICEL_SSH_KEY_PATH`
- `SERVER_MONITOR_MIKROTIK_PASSWORD`
- `SERVER_MONITOR_ALLOWED_MONITOR_IP`

## Firewall minimo recomendado

- permitir trafego apenas do servidor central de monitoramento para os hosts
- evitar expor agente para toda a rede
- preferir:
  - `WinRM 5985` restrito por IP
  - `SSH 22` restrito por IP
  - `9090` restrito por IP quando agente proprio ou legado for usado
  - `8006` somente para o monitoramento do Proxmox
- em DCs, usar conta dedicada e privilegio minimo

## Instalar agente proprio

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-agent-windows.ps1 -AllowedMonitorIp 192.168.2.10 -Token "<token>"
```

Linux:

```bash
SERVER_MONITOR_ALLOWED_MONITOR_IP=192.168.2.10 \
SERVER_MONITOR_AGENT_TOKEN="<token>" \
bash scripts/install-agent-linux.sh
```

## Checklist por host

### pve

- [x] cadastrado
- [x] perfil `proxmox`
- [x] checks TCP ativos
- [ ] token da API informado
- [ ] fallback SSH validado
- [ ] coleta de CPU/RAM/storage/VMs ativa

### srv-00

- [x] cadastrado
- [x] perfil `windows_dc`
- [x] checks TCP ativos
- [ ] credencial WinRM validada
- [ ] coleta de CPU/RAM/disco/eventos/servicos ativa

### srv-01

- [x] cadastrado
- [x] perfil `windows_dc`
- [x] endpoint do agente legado detectado
- [x] checks TCP ativos
- [ ] token do agente validado
- [ ] compatibilidade final do InfraWatchAgent confirmada
- [ ] fallback WinRM validado

### srv-03

- [x] cadastrado
- [x] perfil `windows_file_server`
- [x] checks TCP ativos
- [ ] credencial WinRM validada
- [ ] coleta de disco/SMB/uptime ativa

### srv-04

- [x] cadastrado
- [x] perfil `windows_legacy_app`
- [x] checks TCP ativos
- [ ] credencial WinRM validada
- [ ] coleta de servicos legados ativa

### cicel

- [x] cadastrado
- [x] perfil `linux_app`
- [x] SSH e HTTP healthcheck ativos
- [ ] credencial SSH ou chave validada
- [ ] coleta de nginx/php-fpm/mysql/fail2ban/backup ativa

### ccr

- [x] cadastrado
- [x] perfil `mikrotik_router`
- [x] ICMP validado
- [x] TCP 53 validado
- [x] TCP 2000 validado
- [ ] SSH/API/WinBox liberados para o host de monitoramento
- [ ] auditoria profunda de RouterOS, firewall, NAT, usuarios e servicos
- [ ] coleta profunda de inventario RouterOS ativa

## Riscos remanescentes

- sem credenciais reais, a coleta profunda fica em `integration_pending`
- ICMP pode ser bloqueado em parte da rede; o estado `degraded` foi mantido para nao mascarar isso
- `srv-01` tem forte indicio de agente reutilizavel, mas a compatibilidade final depende do token
- `srv-04` exige cautela extra por conter servicos legados sensiveis
- `pve` ainda depende de acesso autenticado para CPU/RAM/storage/VM state
- `ccr` respondeu ao ping e manteve `53/TCP` e `2000/TCP` abertos, mas bloqueou `22`, `80`, `443`, `8291`, `8728` e `8729` a partir deste host; a auditoria profunda depende de uma excecao de gerencia por IP
- o bundle do frontend ainda passa de 500 kB apos minificacao; nao quebra a entrega, mas merece code splitting depois

## Auditoria passiva do MikroTik CCR

Achados confirmados a partir do host de monitoramento:

- `192.168.2.1` responde a `ICMP` com latencia `<1 ms`
- MAC observado em ARP: `d4-01-c3-91-89-a0`
- `53/TCP` aberto
- `2000/TCP` aberto
- `2020/TCP` aberto
- `22`, `80`, `443`, `8291`, `8728` e `8729` fechados ou filtrados a partir deste host

Leitura tecnica atual:

- o roteador esta vivo e operando como gateway
- a gerencia remota esta endurecida para este segmento, o que e positivo
- a exposicao de `2000/TCP` parece compativel com o servico de `bandwidth-test` do RouterOS e merece revisao imediata se nao houver uso operacional real
- a exposicao de `2020/TCP` foi confirmada e indicada pelo usuario como porta de acesso administrativo; daqui ela nao respondeu como SSH, API RouterOS ou TLS, entao o protocolo exato ainda precisa ser validado
- a exposicao de `53/TCP` indica servico de DNS acessivel neste segmento; validar se isso e intencional e restringir ao que for necessario

Limite honesto desta auditoria:

- sem um canal de gerencia RouterOS compativel acessivel deste host, nao foi possivel confirmar:
  - modelo exato do CCR
  - versao do RouterOS
  - pacotes instalados
  - usuarios e grupos
  - servicos habilitados
  - firewall filter/raw/nat/mangle
  - regras de input
  - scheduler, scripts, SNMP, VPNs e queues

Para completar o pente-fino com a mesma profundidade pedida, preciso de uma destas opcoes:

- `SSH 22/TCP`
- `WinBox 8291/TCP`
- `API 8728/TCP` ou `API-SSL 8729/TCP`
- ou confirmar qual protocolo/cliente a porta `2020/TCP` espera

## Backup do legado

Backup local preservado em:

- `legacy-backup-20260407-154500`

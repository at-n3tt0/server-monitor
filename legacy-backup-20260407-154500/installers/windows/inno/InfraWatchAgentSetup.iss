#define MyAppName "InfraWatch Agent"
#ifndef MyAppVersion
  #define MyAppVersion "2.0.0"
#endif
#define MyAppPublisher "InfraWatch"
#define MyAppExeName "InfraWatchAgent.exe"

[Setup]
AppId={{E08A8DA5-70E9-4D66-9C0D-8BA73DFCF0D5}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\InfraWatch Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\..\dist\agent\windows
OutputBaseFilename=InfraWatchAgentSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "..\..\..\dist\agent\windows\InfraWatchAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\packaging\windows\vendor\nssm.exe"; DestDir: "{app}\support"; DestName: "nssm.exe"; Flags: ignoreversion
Source: "..\..\..\packaging\windows\vendor\nssm-license.txt"; DestDir: "{app}\support"; DestName: "nssm-license.txt"; Flags: ignoreversion
Source: "..\..\..\packaging\windows\helpers\install-agent-service.ps1"; DestDir: "{app}\support"; Flags: ignoreversion
Source: "..\..\..\packaging\windows\helpers\uninstall-agent-service.ps1"; DestDir: "{app}\support"; Flags: ignoreversion

[Code]
var
  ConfigPage: TWizardPage;
  PortEdit: TNewEdit;
  SecretEdit: TNewEdit;
  AliasEdit: TNewEdit;
  FirewallCheck: TNewCheckBox;

function ParamValue(const Name: string; const Default: string): string;
var
  Value: string;
begin
  Value := ExpandConstant('{param:' + Name + '|}');
  if Value = '' then
    Result := Default
  else
    Result := Value;
end;

function ParamBool(const Name: string; const Default: Boolean): Boolean;
var
  Value: string;
begin
  Value := Lowercase(ParamValue(Name, ''));
  if Value = '' then
    Result := Default
  else
    Result := (Value = '1') or (Value = 'true') or (Value = 'yes');
end;

function EscapeJson(const Value: string): string;
begin
  Result := Value;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
  StringChangeEx(Result, #13#10, '\n', True);
  StringChangeEx(Result, #10, '\n', True);
  StringChangeEx(Result, #13, '\n', True);
end;

function PowerShellPath(): string;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function BuildInstallOptionsJson(): string;
var
  AliasValue: string;
  SecretValue: string;
  FirewallValue: string;
begin
  AliasValue := Trim(AliasEdit.Text);
  SecretValue := Trim(SecretEdit.Text);
  if AliasValue = '' then
    AliasValue := 'null'
  else
    AliasValue := '"' + EscapeJson(AliasValue) + '"';

  if SecretValue = '' then
    SecretValue := '""'
  else
    SecretValue := '"' + EscapeJson(SecretValue) + '"';

  if FirewallCheck.Checked then
    FirewallValue := 'true'
  else
    FirewallValue := 'false';

    Result :=
      '{' + #13#10 +
      '  "InstallRoot": "' + EscapeJson(ExpandConstant('{app}')) + '",' + #13#10 +
      '  "DataRoot": "' + EscapeJson(ExpandConstant('{commonappdata}\InfraWatch Agent')) + '",' + #13#10 +
      '  "NssmPath": "' + EscapeJson(ExpandConstant('{app}\support\nssm.exe')) + '",' + #13#10 +
      '  "ServiceName": "InfraWatchAgent",' + #13#10 +
      '  "Port": ' + Trim(PortEdit.Text) + ',' + #13#10 +
    '  "Secret": ' + SecretValue + ',' + #13#10 +
    '  "HostAlias": ' + AliasValue + ',' + #13#10 +
    '  "BindHost": "0.0.0.0",' + #13#10 +
    '  "LogLevel": "info",' + #13#10 +
    '  "OpenFirewall": ' + FirewallValue + ',' + #13#10 +
    '  "ForceConfig": false' + #13#10 +
    '}';
end;

procedure InitializeWizard;
var
  LabelPort: TNewStaticText;
  LabelSecret: TNewStaticText;
  LabelAlias: TNewStaticText;
begin
  ConfigPage := CreateCustomPage(wpSelectDir, 'Configuracao do agente', 'Defina os parametros iniciais do InfraWatch Agent.');

  LabelPort := TNewStaticText.Create(ConfigPage);
  LabelPort.Parent := ConfigPage.Surface;
  LabelPort.Top := ScaleY(8);
  LabelPort.Left := 0;
  LabelPort.Caption := 'Porta do agente';

  PortEdit := TNewEdit.Create(ConfigPage);
  PortEdit.Parent := ConfigPage.Surface;
  PortEdit.Top := LabelPort.Top + ScaleY(18);
  PortEdit.Left := 0;
  PortEdit.Width := ScaleX(120);
  PortEdit.Text := ParamValue('Port', '9090');

  LabelSecret := TNewStaticText.Create(ConfigPage);
  LabelSecret.Parent := ConfigPage.Surface;
  LabelSecret.Top := PortEdit.Top + ScaleY(34);
  LabelSecret.Left := 0;
  LabelSecret.Caption := 'Secret do agente';

  SecretEdit := TNewEdit.Create(ConfigPage);
  SecretEdit.Parent := ConfigPage.Surface;
  SecretEdit.Top := LabelSecret.Top + ScaleY(18);
  SecretEdit.Left := 0;
  SecretEdit.Width := ScaleX(360);
  SecretEdit.PasswordChar := '*';
  SecretEdit.Text := ParamValue('Secret', '');

  LabelAlias := TNewStaticText.Create(ConfigPage);
  LabelAlias.Parent := ConfigPage.Surface;
  LabelAlias.Top := SecretEdit.Top + ScaleY(34);
  LabelAlias.Left := 0;
  LabelAlias.Caption := 'Alias amigavel do host (opcional)';

  AliasEdit := TNewEdit.Create(ConfigPage);
  AliasEdit.Parent := ConfigPage.Surface;
  AliasEdit.Top := LabelAlias.Top + ScaleY(18);
  AliasEdit.Left := 0;
  AliasEdit.Width := ScaleX(360);
  AliasEdit.Text := ParamValue('HostAlias', '');

  FirewallCheck := TNewCheckBox.Create(ConfigPage);
  FirewallCheck.Parent := ConfigPage.Surface;
  FirewallCheck.Top := AliasEdit.Top + ScaleY(38);
  FirewallCheck.Left := 0;
  FirewallCheck.Width := ScaleX(360);
  FirewallCheck.Caption := 'Criar regra de firewall para a porta configurada';
  FirewallCheck.Checked := ParamBool('OpenFirewall', True);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PortValue: Integer;
begin
  Result := True;
  if CurPageID = ConfigPage.ID then
  begin
    PortValue := StrToIntDef(Trim(PortEdit.Text), 0);
    if (PortValue < 1) or (PortValue > 65535) then
    begin
      MsgBox('Informe uma porta valida entre 1 e 65535.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  OptionsPath: string;
  ResultCode: Integer;
  CommandLine: string;
begin
  if CurStep = ssPostInstall then
  begin
    OptionsPath := ExpandConstant('{tmp}\infrawatch-agent-install.json');
    SaveStringToFile(OptionsPath, BuildInstallOptionsJson(), False);
    CommandLine :=
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\support\install-agent-service.ps1') + '"' +
      ' -ExecutablePath "' + ExpandConstant('{app}\{#MyAppExeName}') + '"' +
      ' -OptionsPath "' + OptionsPath + '"';

    if not Exec(PowerShellPath(), CommandLine, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      MsgBox('Falha ao executar o helper de instalacao do servico.', mbError, MB_OK);
      Abort;
    end;

    if ResultCode <> 0 then
    begin
      MsgBox('A instalacao concluiu a copia dos arquivos, mas falhou ao registrar ou iniciar o servico. Consulte C:\ProgramData\InfraWatch Agent\logs\install-helper.log e tente novamente.', mbError, MB_OK);
      Abort;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  RemoveData: Boolean;
  CommandLine: string;
begin
  if CurUninstallStep = usUninstall then
  begin
    RemoveData := MsgBox('Deseja remover tambem configuracao e logs do InfraWatch Agent?', mbConfirmation, MB_YESNO) = IDYES;
    CommandLine :=
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\support\uninstall-agent-service.ps1') + '"' +
      ' -InstallRoot "' + ExpandConstant('{app}') + '"' +
      ' -ServiceName "InfraWatchAgent"' +
      ' -DataRoot "' + ExpandConstant('{commonappdata}\InfraWatch Agent') + '"';
    if RemoveData then
      CommandLine := CommandLine + ' -RemoveData';

    Exec(PowerShellPath(), CommandLine, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

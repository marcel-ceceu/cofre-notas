#Requires -Version 5.1
<#
===============================================================================
 reinstalar.ps1
 CORRECAO - baixa o instalador do Cofre de Notas no GitHub Releases e reinstala
 Natureza: altera o sistema (instalacao por usuario em %LOCALAPPDATA%, sem admin)
===============================================================================
 Uso:
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\reinstalar.ps1"
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\reinstalar.ps1" -Version 0.14.0
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\reinstalar.ps1" -SomenteDiagnostico

 Sem -Version usa a release "latest". Se a CI ainda estiver buildando a tag,
 o script espera o instalador aparecer (ate -EsperarMinutos).
===============================================================================
#>

[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$Repo = 'marcel-ceceu/cofre-notas',
    [int]$EsperarMinutos = 20,
    [switch]$SomenteDiagnostico,
    [switch]$NaoAbrir,
    [switch]$SemAbrirLog
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

$Slug  = 'reinstalar_cofre_notas'
$Stamp = Get-Date -Format 'yyMMdd_HHmm'
$TOTAL = 7

$script:Passo    = 0
$script:Faltando = New-Object System.Collections.ArrayList
$script:Alertas  = New-Object System.Collections.ArrayList

# ---------- infraestrutura ----------

function Join-Seguro {
    param(
        [Parameter(Mandatory=$false)][AllowEmptyString()][AllowNull()][string]$Raiz = '',
        [Parameter(Mandatory=$false)][AllowEmptyString()][string]$Filho = ''
    )
    if ([string]::IsNullOrWhiteSpace($Raiz)) { return '' }
    try { return (Join-Path -Path $Raiz -ChildPath $Filho) } catch { return '' }
}

function Resolve-PastaLog {
    $bases = New-Object System.Collections.ArrayList
    try { [void]$bases.Add([Environment]::GetFolderPath('Desktop')) } catch { }
    [void]$bases.Add((Join-Seguro $env:USERPROFILE 'Desktop'))
    [void]$bases.Add((Join-Seguro $env:OneDrive 'Desktop'))
    [void]$bases.Add((Join-Seguro $env:OneDriveCommercial 'Desktop'))
    [void]$bases.Add($env:USERPROFILE)

    $validas = @($bases |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Where-Object { Test-Path -LiteralPath $_ -EA SilentlyContinue } |
        Select-Object -Unique)

    foreach ($b in $validas) {
        $p = Join-Seguro $b 'CAIXA DE ENTRADA\powerlogs-testes'
        if ($p -ne '' -and (Test-Path -LiteralPath $p -EA SilentlyContinue)) { return $p }
    }
    if (@($validas).Count -gt 0) {
        $p = Join-Seguro $validas[0] 'CAIXA DE ENTRADA\powerlogs-testes'
        if ($p -ne '') { try { New-Item -ItemType Directory -Path $p -Force | Out-Null; return $p } catch { } }
    }
    $p = Join-Seguro $env:TEMP 'powerlogs-testes'
    if ($p -ne '') { try { New-Item -ItemType Directory -Path $p -Force | Out-Null; return $p } catch { } }
    try { return (Get-Location).Path } catch { return '.' }
}

$PastaLog = Resolve-PastaLog
if ([string]::IsNullOrWhiteSpace($PastaLog)) { $PastaLog = '.' }
$LogPath = Join-Seguro $PastaLog ('_TEMP_{0}_{1}.txt' -f $Stamp, $Slug)

$script:LogAtivo = $false
if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    try { Set-Content -LiteralPath $LogPath -Value '' -Encoding UTF8 -EA Stop; $script:LogAtivo = $true }
    catch { Write-Host ('AVISO: log em arquivo indisponivel. Continuando em tela.') -ForegroundColor Yellow }
}

function Write-Log {
    param(
        [Parameter(Mandatory=$false)][AllowEmptyString()][AllowNull()][string]$Texto = '',
        [ValidateSet('INFO','OK','FALHA','ALERTA','TITULO','DADO')][string]$Nivel = 'INFO'
    )
    if ($null -eq $Texto) { $Texto = '' }
    $cor = 'Gray'; $linha = $Texto
    switch ($Nivel) {
        'OK'     { $linha = '  [OK]     ' + $Texto; $cor = 'Green' }
        'FALHA'  { $linha = '  [FALHA]  ' + $Texto; $cor = 'Red' }
        'ALERTA' { $linha = '  [ALERTA] ' + $Texto; $cor = 'Yellow' }
        'INFO'   { $linha = '  [INFO]   ' + $Texto; $cor = 'Gray' }
        'DADO'   { $linha = '           ' + $Texto; $cor = 'DarkGray' }
        'TITULO' { $linha = $Texto;                 $cor = 'White' }
    }
    if ($script:LogAtivo) { try { Add-Content -LiteralPath $LogPath -Value $linha -Encoding UTF8 -EA Stop } catch { } }
    Write-Host $linha -ForegroundColor $cor
}

function Write-Passo {
    param([Parameter(Mandatory=$false)][AllowEmptyString()][string]$Descricao = '')
    $script:Passo++
    if ($TOTAL -gt 0) {
        $txt = ('PROCESSANDO {0}/{1} ({2}%) -- {3}' -f $script:Passo, $TOTAL, [int](($script:Passo/$TOTAL)*100), $Descricao)
    } else {
        $txt = ('PROCESSANDO {0} -- {1}' -f $script:Passo, $Descricao)
    }
    Write-Host ''; Write-Host $txt -ForegroundColor Cyan
    if ($script:LogAtivo) { try { Add-Content -LiteralPath $LogPath -Value ([Environment]::NewLine + $txt) -Encoding UTF8 -EA Stop } catch { } }
}

function Add-Falta {
    param(
        [Parameter(Mandatory=$false)][AllowEmptyString()][string]$Item = '',
        [Parameter(Mandatory=$false)][AllowEmptyString()][string]$Motivo = '',
        [Parameter(Mandatory=$false)][AllowEmptyString()][string]$Comando = ''
    )
    [void]$script:Faltando.Add([PSCustomObject]@{ Item=$Item; Motivo=$Motivo; Comando=$Comando })
}

function Add-Alerta {
    param([Parameter(Mandatory=$false)][AllowEmptyString()][string]$Texto = '')
    [void]$script:Alertas.Add($Texto)
}

# autocopia para pasta canonica
$PastaScripts = Join-Seguro $PastaLog 'scripts'
try {
    if ($PastaScripts -ne '' -and -not (Test-Path -LiteralPath $PastaScripts)) {
        New-Item -ItemType Directory -Path $PastaScripts -Force | Out-Null
    }
    if ($PastaScripts -ne '' -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
        $org = $MyInvocation.MyCommand.Path
        if ((Split-Path $org -Parent) -ne $PastaScripts) {
            Copy-Item -LiteralPath $org -Destination (Join-Seguro $PastaScripts (Split-Path $org -Leaf)) -Force -EA SilentlyContinue
        }
    }
} catch { }

# ---------- helpers especificos ----------

$ProductName = 'Cofre de Notas'
$ExeName     = 'app.exe'
$PastaApp    = Join-Seguro $env:LOCALAPPDATA $ProductName
$ExePath     = Join-Seguro $PastaApp $ExeName

# Entrada de desinstalacao do NSIS (Tauri grava por usuario em HKCU; HKLM por garantia).
function Get-InstalacaoRegistrada {
    $raizes = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($r in $raizes) {
        $chaves = @(Get-ChildItem -Path $r -EA SilentlyContinue)
        foreach ($k in $chaves) {
            $p = $null
            try { $p = Get-ItemProperty -LiteralPath $k.PSPath -EA Stop } catch { continue }
            if ($null -ne $p -and ("$($p.DisplayName)" -eq $ProductName)) {
                return [PSCustomObject]@{
                    Chave       = $k.PSPath
                    Versao      = "$($p.DisplayVersion)"
                    Local       = "$($p.InstallLocation)"
                    Uninstaller = "$($p.UninstallString)"
                }
            }
        }
    }
    return $null
}

function Get-VersaoExe {
    param([Parameter(Mandatory=$false)][AllowEmptyString()][string]$Caminho = '')
    if ([string]::IsNullOrWhiteSpace($Caminho) -or -not (Test-Path -LiteralPath $Caminho)) { return '' }
    try {
        $fv = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Caminho)
        $v = "$($fv.ProductVersion)"
        if ([string]::IsNullOrWhiteSpace($v)) { $v = "$($fv.FileVersion)" }
        return $v.Trim()
    } catch { return '' }
}

function Get-ReleaseGitHub {
    param([Parameter(Mandatory=$false)][AllowEmptyString()][string]$Tag = '')
    $url = if ([string]::IsNullOrWhiteSpace($Tag)) {
        "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $hdr = @{ 'User-Agent' = 'cofre-notas-reinstalar'; 'Accept' = 'application/vnd.github+json' }
        return Invoke-RestMethod -Uri $url -Headers $hdr -TimeoutSec 30 -EA Stop
    } catch {
        return $null
    }
}

function Get-AssetInstalador {
    param($Release)
    if ($null -eq $Release -or $null -eq $Release.assets) { return $null }
    $ativos = @($Release.assets | Where-Object { "$($_.name)" -like '*-setup.exe' })
    if (@($ativos).Count -eq 0) { return $null }
    return $ativos[0]
}

# Download em stream com percentual (Invoke-WebRequest nao mostra progresso util no 5.1).
function Save-ComProgresso {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$Destino
    )
    $req = $null; $resp = $null; $in = $null; $out = $null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.UserAgent = 'cofre-notas-reinstalar'
        $req.AllowAutoRedirect = $true
        $req.Timeout = 60000
        $resp = $req.GetResponse()
        $total = [long]$resp.ContentLength
        $in  = $resp.GetResponseStream()
        $out = [System.IO.File]::Create($Destino)
        $buf = New-Object byte[] 262144
        $lido = 0L; $ultimo = -1
        while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
            $out.Write($buf, 0, $n)
            $lido += $n
            if ($total -gt 0) {
                $pct = [int](($lido * 100) / $total)
                if ($pct -ne $ultimo -and ($pct % 10) -eq 0) {
                    $ultimo = $pct
                    Write-Host ('    baixando... {0}% ({1:N1} MB de {2:N1} MB)' -f $pct, ($lido/1MB), ($total/1MB)) -ForegroundColor DarkCyan
                }
            }
        }
        return $lido
    } finally {
        if ($null -ne $out)  { try { $out.Close() }  catch { } }
        if ($null -ne $in)   { try { $in.Close() }   catch { } }
        if ($null -ne $resp) { try { $resp.Close() } catch { } }
    }
}

# Janela do app visivel? (user32 EnumWindows; classe "Tauri Window")
function Test-JanelaVisivel {
    param([int]$ProcessId = 0)
    if (-not ('CofreWin' -as [type])) {
        Add-Type -Namespace Native -Name CofreWin -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr lp);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder sb, int max);
public delegate bool EnumWindowsProc(System.IntPtr h, System.IntPtr lp);
public static bool Achou;
public static int Pid;
public static bool Cb(System.IntPtr h, System.IntPtr lp) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (Pid != 0 && (int)pid != Pid) return true;
    var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256);
    if (sb.ToString() == "Tauri Window" && IsWindowVisible(h)) { Achou = true; return false; }
    return true;
}
public static bool Procurar(int pid) { Achou = false; Pid = pid; EnumWindows(Cb, System.IntPtr.Zero); return Achou; }
'@ -EA SilentlyContinue
    }
    try { return [Native.CofreWin]::Procurar($ProcessId) } catch { return $false }
}

# ---------- cabecalho ----------
Clear-Host
Write-Log '===============================================================================' 'TITULO'
Write-Log ' REINSTALAR COFRE DE NOTAS (GitHub Releases -> instalador NSIS por usuario)' 'TITULO'
Write-Log '===============================================================================' 'TITULO'
Write-Log ('Executado em: ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss')) 'TITULO'
Write-Log ('Log ........: ' + $LogPath) 'TITULO'
if ($SomenteDiagnostico) {
    Write-Log 'NATUREZA ...: SOMENTE LEITURA (-SomenteDiagnostico)' 'TITULO'
} else {
    Write-Log 'NATUREZA ...: ALTERA O SISTEMA (fecha o app, baixa e reinstala)' 'TITULO'
}
Write-Log ('Repo .......: ' + $Repo) 'TITULO'
Write-Log ('Versao .....: ' + $(if ($Version) { $Version } else { 'latest' })) 'TITULO'
Write-Log '===============================================================================' 'TITULO'

# ---------- corpo ----------

Write-Passo 'Estado atual: instalacao registrada, exe e processo'
$instAntes = Get-InstalacaoRegistrada
if ($null -ne $instAntes) {
    Write-Log ('Registrado: ' + $ProductName + ' ' + $instAntes.Versao) 'OK'
    Write-Log ('Local: ' + $instAntes.Local) 'DADO'
} else {
    Write-Log 'Nenhuma entrada de desinstalacao encontrada (app nao instalado ou instalacao manual).' 'ALERTA'
}
$verExeAntes = Get-VersaoExe $ExePath
if ($verExeAntes) {
    Write-Log ('Exe: ' + $ExePath + ' (versao ' + $verExeAntes + ')') 'OK'
} else {
    Write-Log ('Exe nao encontrado em ' + $ExePath) 'INFO'
}
$procs = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExeName)) -EA SilentlyContinue |
    Where-Object { "$($_.Path)" -ieq $ExePath })
if (@($procs).Count -gt 0) {
    Write-Log ('App em execucao: ' + @($procs).Count + ' processo(s), PID ' + (($procs | ForEach-Object { $_.Id }) -join ', ')) 'INFO'
} else {
    Write-Log 'App nao esta em execucao.' 'INFO'
}

Write-Passo 'Consultando a release no GitHub (espera a CI se a tag ainda estiver buildando)'
$tag = if ($Version) { 'v' + $Version.TrimStart('v') } else { '' }
$release = $null; $asset = $null
$prazo = (Get-Date).AddMinutes([Math]::Max(0, $EsperarMinutos))
$tentativa = 0
do {
    $tentativa++
    $release = Get-ReleaseGitHub -Tag $tag
    $asset = Get-AssetInstalador -Release $release
    if ($null -ne $asset) { break }
    $faltam = [int]([Math]::Ceiling(($prazo - (Get-Date)).TotalMinutes))
    if ($faltam -le 0 -or $SomenteDiagnostico) { break }
    $motivo = if ($null -eq $release) { 'release ainda nao existe' } else { 'release sem instalador *-setup.exe ainda' }
    Write-Host ('    tentativa ' + $tentativa + ': ' + $motivo + '; nova consulta em 30 s (restam ~' + $faltam + ' min)') -ForegroundColor DarkYellow
    Start-Sleep -Seconds 30
} while ($true)

if ($null -eq $release) {
    Write-Log ('Release nao encontrada: ' + $(if ($tag) { $tag } else { 'latest' })) 'FALHA'
    Add-Falta 'Release no GitHub' 'A API nao devolveu a release (tag inexistente, CI ainda rodando ou sem rede).' ('https://github.com/' + $Repo + '/actions')
} elseif ($null -eq $asset) {
    Write-Log ('Release ' + $release.tag_name + ' existe, mas sem instalador *-setup.exe.') 'FALHA'
    Add-Falta 'Instalador na release' 'A CI ainda nao publicou o asset ou o build falhou.' ('https://github.com/' + $Repo + '/actions')
} else {
    Write-Log ('Release: ' + $release.tag_name + ' (' + $release.name + ')') 'OK'
    Write-Log ('Instalador: ' + $asset.name + ' (' + ('{0:N1}' -f ($asset.size/1MB)) + ' MB)') 'DADO'
    Write-Log ('Publicado em: ' + $asset.updated_at) 'DADO'
    $verRelease = "$($release.tag_name)".TrimStart('v')
    if ($null -ne $instAntes -and $instAntes.Versao -eq $verRelease) {
        Add-Alerta ('A versao instalada (' + $instAntes.Versao + ') ja e a da release; reinstalacao sera por cima (idempotente).')
    }
}

if ($SomenteDiagnostico) {
    Write-Log 'Modo diagnostico: nada sera baixado nem instalado.' 'INFO'
} elseif ($null -ne $asset) {

    Write-Passo 'Baixando o instalador para Downloads'
    $pastaDown = Join-Seguro $env:USERPROFILE 'Downloads'
    if ($pastaDown -eq '' -or -not (Test-Path -LiteralPath $pastaDown)) { $pastaDown = $env:TEMP }
    $destino = Join-Seguro $pastaDown $asset.name
    $bytes = 0L
    try {
        if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Force -EA SilentlyContinue }
        $bytes = Save-ComProgresso -Url $asset.browser_download_url -Destino $destino
    } catch {
        Write-Log ('Falha no download: ' + $_.Exception.Message) 'FALHA'
    }
    $okDownload = $false
    if ($bytes -gt 0 -and (Test-Path -LiteralPath $destino)) {
        $tam = (Get-Item -LiteralPath $destino).Length
        if ($tam -eq [long]$asset.size) {
            $okDownload = $true
            Write-Log ('Baixado: ' + $destino + ' (' + ('{0:N1}' -f ($tam/1MB)) + ' MB, tamanho confere)') 'OK'
            try {
                $sha = (Get-FileHash -LiteralPath $destino -Algorithm SHA256 -EA Stop).Hash
                Write-Log ('SHA256: ' + $sha) 'DADO'
            } catch { }
            try { Unblock-File -LiteralPath $destino -EA SilentlyContinue } catch { }
        } else {
            Write-Log ('Tamanho divergente: esperado ' + $asset.size + ', obtido ' + $tam + ' bytes.') 'FALHA'
            Add-Falta 'Download do instalador' 'Arquivo incompleto.' ('Baixe manualmente: ' + $asset.browser_download_url)
        }
    } else {
        Add-Falta 'Download do instalador' 'Nao foi possivel baixar.' ('Baixe manualmente: ' + $asset.browser_download_url)
    }

    if ($okDownload) {

        Write-Passo 'Fechando o app se estiver aberto'
        $procs = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExeName)) -EA SilentlyContinue |
            Where-Object { "$($_.Path)" -ieq $ExePath })
        if (@($procs).Count -gt 0) {
            foreach ($p in $procs) { try { Stop-Process -Id $p.Id -Force -EA Stop } catch { } }
            Start-Sleep -Seconds 2
            $restantes = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExeName)) -EA SilentlyContinue |
                Where-Object { "$($_.Path)" -ieq $ExePath })
            if (@($restantes).Count -eq 0) { Write-Log ('Encerrado(s) ' + @($procs).Count + ' processo(s).') 'OK' }
            else { Write-Log 'Ainda ha processo do app vivo; o instalador pode pedir para fechar.' 'ALERTA' }
        } else {
            Write-Log 'Nada a fechar.' 'OK'
        }

        Write-Passo 'Executando o instalador NSIS em modo silencioso (/S)'
        $inicio = Get-Date
        $codigo = -1
        try {
            $pi = Start-Process -FilePath $destino -ArgumentList '/S' -PassThru -Wait -EA Stop
            $codigo = $pi.ExitCode
        } catch {
            Write-Log ('Falha ao executar o instalador: ' + $_.Exception.Message) 'FALHA'
        }
        $dur = [int]((Get-Date) - $inicio).TotalSeconds
        if ($codigo -eq 0) {
            Write-Log ('Instalador terminou com codigo 0 em ' + $dur + ' s.') 'OK'
        } else {
            Write-Log ('Instalador terminou com codigo ' + $codigo + ' em ' + $dur + ' s.') 'FALHA'
            Add-Falta 'Instalacao silenciosa' ('Codigo de saida ' + $codigo) ('Rode manualmente: "' + $destino + '"')
        }

        Write-Passo 'Conferindo a versao instalada'
        $instDepois = Get-InstalacaoRegistrada
        $verExeDepois = Get-VersaoExe $ExePath
        $verAlvo = "$($release.tag_name)".TrimStart('v')
        if ($null -ne $instDepois) {
            if ($instDepois.Versao -eq $verAlvo) { Write-Log ('Registro: ' + $instDepois.Versao + ' (= release)') 'OK' }
            else { Write-Log ('Registro: ' + $instDepois.Versao + ' (esperado ' + $verAlvo + ')') 'FALHA'; Add-Falta 'Versao registrada' 'Nao bate com a release.' 'Rode o instalador manualmente.' }
        } else {
            Write-Log 'Sem entrada de desinstalacao apos instalar.' 'FALHA'
        }
        if ($verExeDepois) {
            if ($verExeDepois -like ($verAlvo + '*')) { Write-Log ('Exe: ' + $verExeDepois) 'OK' }
            else { Write-Log ('Exe: ' + $verExeDepois + ' (esperado ' + $verAlvo + ')') 'ALERTA' }
        } else {
            Write-Log ('Exe nao encontrado em ' + $ExePath) 'FALHA'
        }

        Write-Passo 'Abrindo o app e verificando se a janela aparece'
        if ($NaoAbrir) {
            Write-Log 'Pulado (-NaoAbrir).' 'INFO'
        } elseif (Test-Path -LiteralPath $ExePath) {
            $app = $null
            try { $app = Start-Process -FilePath $ExePath -PassThru -EA Stop } catch { Write-Log ('Nao abriu: ' + $_.Exception.Message) 'FALHA' }
            if ($null -ne $app) {
                $visivel = $false
                for ($t = 1; $t -le 20; $t++) {
                    Start-Sleep -Milliseconds 500
                    if (Test-JanelaVisivel -ProcessId $app.Id) { $visivel = $true; break }
                }
                if ($visivel) { Write-Log ('Janela visivel (PID ' + $app.Id + ', ' + ($t * 0.5) + ' s).') 'OK' }
                else {
                    Write-Log 'Processo iniciou, mas nenhuma janela "Tauri Window" visivel em 10 s.' 'FALHA'
                    Add-Falta 'Janela do app' 'Pode ser o problema da 0.11.0 (janela oculta) ou o app ainda carregando.' 'Veja o processo app.exe no Gerenciador de Tarefas e abra DevTools (F12) se aparecer.'
                }
            }
        } else {
            Write-Log 'Exe ausente; nada a abrir.' 'FALHA'
        }
    }
}

# ---------- fecho ----------
Write-Log '' 'TITULO'
Write-Log '===============================================================================' 'TITULO'
Write-Log ' RESUMO - PLANO DE ACAO' 'TITULO'
Write-Log '===============================================================================' 'TITULO'

$lf = @($script:Faltando)
if (@($lf).Count -eq 0) {
    Write-Log 'Nada pendente.' 'OK'
} else {
    Write-Log ('ITENS PENDENTES: ' + @($lf).Count) 'TITULO'
    $i = 0
    foreach ($f in $lf) {
        $i++
        Write-Log '' 'TITULO'
        Write-Log ($i.ToString() + ') ' + $f.Item) 'FALHA'
        Write-Log ('Motivo ..: ' + $f.Motivo) 'DADO'
        Write-Log ('Sugestao : ' + $f.Comando) 'DADO'
    }
}

$la = @($script:Alertas)
if (@($la).Count -gt 0) {
    Write-Log '' 'TITULO'
    Write-Log ('ALERTAS: ' + @($la).Count) 'TITULO'
    $j = 0
    foreach ($a in $la) { $j++; Write-Log ($j.ToString() + ') ' + $a) 'ALERTA' }
}

Write-Log '' 'TITULO'
Write-Log '===============================================================================' 'TITULO'
Write-Log ' CONCLUIDO' 'TITULO'
Write-Log (' Passos: ' + $script:Passo) 'TITULO'
Write-Log (' Log: ' + $LogPath) 'TITULO'
Write-Log '===============================================================================' 'TITULO'

Write-Host ''
Write-Host 'CONCLUIDO. Abrindo o log...' -ForegroundColor Green

if (-not $SemAbrirLog -and $script:LogAtivo) {
    try { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $LogPath + '"') -EA Stop }
    catch { try { Invoke-Item -LiteralPath $LogPath } catch { Write-Host ('Log em: ' + $LogPath) -ForegroundColor Yellow } }
}

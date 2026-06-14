# 2605 Leitor Notas PC (Vite) - servidor local
# Duplo-clique no ficheiro OU cole este bloco INTEIRO no PowerShell.
# Parametros opcionais: -UseExisting  |  -Restart

param(
    [switch]$UseExisting,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { 'c:\projetos\2605_APPLEITOR_LeitorNotasPC' }
$DesiredPort = 5173
$CandidatePorts = @(5173, 5174, 5175, 5176, 5177, 5178)
$ProjectMarker = '2605_APPLEITOR_LeitorNotasPC'

function Get-PortListeners {
    param([int[]]$Ports)
    $items = @()
    foreach ($port in $Ports) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            $items += [pscustomobject]@{
                Port = $port
                PID = $conn.OwningProcess
                Process = if ($proc) { $proc.ProcessName } else { 'desconhecido' }
            }
        }
    }
    return $items
}

function Test-PortFree {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return -not $conn
}

function Get-ExistingProjectServers {
    param([string]$RootPath)
    $rootNorm = (Resolve-Path -LiteralPath $RootPath).Path.TrimEnd('\').ToLower()
    $found = @()
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        $cmdLower = $cmd.ToLower()
        if ($cmdLower.IndexOf($rootNorm) -lt 0) { continue }
        if ($cmdLower -notmatch 'vite|npm.*dev') { continue }
        $port = $DesiredPort
        if ($cmd -match '(?:--port|-p)\s+(\d+)') { $port = [int]$Matches[1] }
        $conns = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($CandidatePorts -contains $c.LocalPort) {
                $port = $c.LocalPort
                break
            }
        }
        $found += [pscustomobject]@{
            PID = $p.ProcessId
            Port = $port
        }
    }
    return $found | Sort-Object Port -Unique
}

function Stop-ProjectDevServers {
    param($Servers)
    foreach ($s in $Servers) {
        Write-Host "Encerrando PID $($s.PID) (porta $($s.Port))..." -ForegroundColor Yellow
        Stop-Process -Id $s.PID -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

Set-Location -LiteralPath $Root

$Pkg = Join-Path $Root 'package.json'
if (-not (Test-Path -LiteralPath $Pkg)) {
    Write-Host 'ERRO: package.json nao existe em:' -ForegroundColor Red
    Write-Host "  $Root" -ForegroundColor Red
    Write-Host 'Abra o PowerShell na pasta do repo ou corrija $Root no script.' -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'ERRO: npm nao encontrado. Instale Node.js (nodejs.org).' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Host "npm install em $Root ..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$PortInfo = Get-PortListeners -Ports $CandidatePorts
Write-Host ''
Write-Host '--- Resumo de portas ---' -ForegroundColor White
Write-Host "Porta desejada (padrao $ProjectMarker): $DesiredPort"
if ($PortInfo.Count -gt 0) {
    Write-Host 'Portas ocupadas (candidatas):' -ForegroundColor Yellow
    $PortInfo | Format-Table Port, PID, Process -AutoSize
} else {
    Write-Host 'Nenhuma porta candidata esta ocupada.' -ForegroundColor Green
}

$Existing = @(Get-ExistingProjectServers -RootPath $Root)

if ($Existing.Count -gt 0) {
    Write-Host ''
    Write-Host 'Servidor Vite deste projeto ja detectado:' -ForegroundColor Yellow
    $Existing | Format-Table PID, Port -AutoSize

    $choice = '1'
    if ($Restart) {
        $choice = '2'
    } elseif ($UseExisting) {
        $choice = '1'
    } else {
        Write-Host ''
        Write-Host '[1] Abrir o servidor existente no navegador (recomendado)' -ForegroundColor Green
        Write-Host '[2] Encerrar processo(s) antigo(s) e iniciar servidor novo' -ForegroundColor Yellow
        $inputRaw = Read-Host 'Opcao (Enter = 1)'
        if ($inputRaw -eq '2') { $choice = '2' }
    }

    if ($choice -eq '1') {
        $usePort = $Existing[0].Port
        $Url = "http://localhost:$usePort"
        Write-Host ''
        Write-Host "Porta desejada: $DesiredPort" -ForegroundColor White
        Write-Host "Porta em uso (existente): $usePort" -ForegroundColor Green
        Write-Host "Abrindo: $Url" -ForegroundColor Green
        Start-Process $Url
        Write-Host 'Nenhum servidor novo foi iniciado.' -ForegroundColor Cyan
        exit 0
    }

    Stop-ProjectDevServers -Servers $Existing
    Write-Host 'Processos antigos encerrados. Seguindo para novo servidor...' -ForegroundColor Cyan
}

$SelectedPort = $null
foreach ($port in $CandidatePorts) {
    if (Test-PortFree -Port $port) {
        $SelectedPort = $port
        break
    }
}

if (-not $SelectedPort) {
    Write-Host 'ERRO: nenhuma porta livre na lista de candidatas.' -ForegroundColor Red
    Write-Host "Testadas: $($CandidatePorts -join ', ')" -ForegroundColor Red
    exit 1
}

$Url = "http://localhost:$SelectedPort"
Write-Host ''
Write-Host "Porta desejada: $DesiredPort" -ForegroundColor White
Write-Host "Porta selecionada: $SelectedPort" -ForegroundColor Green
Write-Host "URL: $Url" -ForegroundColor Green
Write-Host ''

Start-Job -ScriptBlock {
    param($OpenUrl)
    for ($i = 1; $i -le 90; $i++) {
        try {
            Invoke-WebRequest -Uri $OpenUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            Start-Process $OpenUrl
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList $Url | Out-Null

Write-Host "Dash: $Url  (Ctrl+C para parar)" -ForegroundColor Green
if ($SelectedPort -eq $DesiredPort) {
    npm run dev
} else {
    npm run dev -- --port $SelectedPort
}

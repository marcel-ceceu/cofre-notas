# 2606 Cofre de Notas (Vite) - servidor local
# Duplo-clique OU cole este ficheiro inteiro no PowerShell.
#
# Regras:
# 1) Sempre validar a rota $DashPath (nunca abrir 404).
# 2) Servidor antigo deste repo -> derrubar e valer o novo.
# 3) Nunca matar outros repos (portas fora da lista candidata).

$ErrorActionPreference = 'Stop'

function Test-RepoRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $Path 'package.json'))
}

$CanonicalRoot = 'C:\3.1-Projetos2\2606_COFRENOTAS-LeitorNotasObsidianAPP'
$Root = $null
foreach ($candidate in @($PSScriptRoot, (Get-Location).Path, $CanonicalRoot)) {
    if (Test-RepoRoot -Path $candidate) {
        $Root = (Resolve-Path -LiteralPath $candidate).Path
        break
    }
}
if (-not $Root) { $Root = $CanonicalRoot }

$DesiredPort = 5173
# 5173 = dev Vite / Tauri devUrl. 5180 = Playwright E2E (nao usar como fallback).
$CandidatePorts = @(5173, 5174, 5175, 5176, 5177, 5178)
$DashPath = '/'
$ProjectMatchHint = '2606_cofrenotas'
$ExcludePathHints = @()

function Get-ProcessCommandLine {
    param([int]$ProcessId)
    try {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
        return [string]$p.CommandLine
    } catch {
        return ''
    }
}

function Get-PortRow {
    param([int]$Port)
    $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($conns.Count -eq 0) {
        return [pscustomobject]@{ Port = $Port; Status = 'livre'; PID = ''; Process = ''; CommandLine = '' }
    }
    $conn = $conns[0]
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    $cmd = Get-ProcessCommandLine -ProcessId $conn.OwningProcess
    if ($cmd.Length -gt 100) { $cmd = $cmd.Substring(0, 97) + '...' }
    return [pscustomobject]@{
        Port        = $Port
        Status      = 'ocupada'
        PID         = $conn.OwningProcess
        Process     = if ($proc) { $proc.ProcessName } else { '?' }
        CommandLine = $cmd
    }
}

function Test-PortFree {
    param([int]$Port)
    return -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-IsExcludedSubApp {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $cmd = $CommandLine.ToLowerInvariant().Replace('/', '\')
    foreach ($hint in $ExcludePathHints) {
        $h = $hint.ToLowerInvariant().Replace('/', '\')
        if ($cmd -like "*$h*") { return $true }
    }
    return $false
}

function Test-IsCofreProjectProcess {
    param(
        [string]$CommandLine,
        [string]$ProjectRoot
    )
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    if (Test-IsExcludedSubApp -CommandLine $CommandLine) { return $false }
    $cmd = $CommandLine.ToLowerInvariant()
    $rootKey = $ProjectRoot.TrimEnd('\').ToLowerInvariant()
    if ($cmd -notmatch 'vite|npm.*dev|pnpm.*dev') { return $false }
    return (
        $cmd -like "*$rootKey*" -or
        $cmd -like "*$ProjectMatchHint*" -or
        $cmd -like '*cofre-notas*' -or
        $cmd -like '*leitornotasobsidianapp*'
    )
}

function Get-HttpStatusCode {
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return [int]$resp.StatusCode
    } catch {
        if ($_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode
        }
        return $null
    }
}

function Test-AppRouteOk {
    param([int]$Port)
    $url = "http://localhost:$Port$DashPath"
    $code = Get-HttpStatusCode -Url $url
    if ($null -eq $code) { return $false }
    if ($code -eq 404) { return $false }
    return $true
}

function Get-CofreListeners {
    param([string]$ProjectRoot)
    $found = @()
    $seen = @{}
    $scanPorts = (@($DesiredPort) + $CandidatePorts) | Select-Object -Unique
    foreach ($port in $scanPorts) {
        $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        foreach ($conn in $conns) {
            $procId = [int]$conn.OwningProcess
            if ($seen.ContainsKey($procId)) { continue }
            $cmd = Get-ProcessCommandLine -ProcessId $procId
            if (-not (Test-IsCofreProjectProcess -CommandLine $cmd -ProjectRoot $ProjectRoot)) { continue }
            $seen[$procId] = $true
            $routeOk = Test-AppRouteOk -Port $port
            $found += [pscustomobject]@{
                Port    = $port
                PID     = $procId
                RouteOk = $routeOk
                Cmd     = $cmd
            }
        }
    }
    return $found
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -le 4) { return }
    $parentId = 0
    try {
        $parentId = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue).ParentProcessId
    } catch { }
    try {
        $null = & taskkill.exe /PID $ProcessId /T /F 2>&1
    } catch {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($parentId -gt 4) {
        $parentCmd = Get-ProcessCommandLine -ProcessId $parentId
        if (Test-IsCofreProjectProcess -CommandLine $parentCmd -ProjectRoot $Root) {
            try { $null = & taskkill.exe /PID $parentId /T /F 2>&1 } catch { }
        }
    }
}

function Stop-StaleCofreListeners {
    param(
        [string]$ProjectRoot,
        [object[]]$Listeners
    )
    if (-not $Listeners -or $Listeners.Count -eq 0) { return 0 }
    $killed = 0
    foreach ($item in $Listeners) {
        $status = if ($item.RouteOk) { 'rota ok, mas antigo - derrubar p/ valer o novo' } else { "rota $DashPath invalida/404 - derrubar" }
        Write-Host "Derrubando PID $($item.PID) na porta $($item.Port) ($status)" -ForegroundColor Yellow
        Stop-ProcessTree -ProcessId ([int]$item.PID)
        $killed++
    }
    Start-Sleep -Seconds 1
    return $killed
}

function Resolve-NodeTool {
    param([string]$Name)
    $candidates = @(
        (Join-Path $env:ProgramFiles "nodejs\$Name.cmd"),
        (Join-Path $env:ProgramFiles "nodejs\$Name.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\$Name.cmd"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\$Name.exe"),
        (Join-Path $env:APPDATA "npm\$Name.cmd"),
        (Join-Path $env:LOCALAPPDATA "pnpm\$Name.exe"),
        (Join-Path $env:LOCALAPPDATA "pnpm\$Name.cmd")
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        $src = $cmd.Source
        if ($src -match '\.ps1$') {
            $alt = $src -replace '\.ps1$', '.cmd'
            if (Test-Path -LiteralPath $alt) { return (Resolve-Path -LiteralPath $alt).Path }
        }
        if (Test-Path -LiteralPath $src) { return (Resolve-Path -LiteralPath $src).Path }
        return $src
    }
    return $null
}

function Resolve-PackageRunner {
    param([switch]$PreferPnpm)
    if ($PreferPnpm) {
        $pnpm = Resolve-NodeTool -Name 'pnpm'
        if ($pnpm) {
            return [pscustomobject]@{ Executable = $pnpm; Prefix = @() }
        }
        $corepack = Resolve-NodeTool -Name 'corepack'
        if ($corepack) {
            return [pscustomobject]@{ Executable = $corepack; Prefix = @('pnpm') }
        }
        return $null
    }
    $npm = Resolve-NodeTool -Name 'npm'
    if ($npm) {
        return [pscustomobject]@{ Executable = $npm; Prefix = @() }
    }
    return $null
}

function Invoke-NodePackage {
    param(
        [string]$RunnerPath,
        [string[]]$PrefixArgs = @(),
        [string[]]$ArgumentList,
        [switch]$Wait
    )
    $allArgs = @($PrefixArgs + $ArgumentList)
    $common = @{
        FilePath         = $RunnerPath
        ArgumentList     = $allArgs
        WorkingDirectory = $Root
    }
    if ($Wait) {
        $proc = Start-Process @common -Wait -PassThru -NoNewWindow
        return $proc.ExitCode
    }
    Start-Process @common -NoNewWindow | Out-Null
    return 0
}

function Get-DevServerArgs {
    param(
        [bool]$UsePnpm,
        [int]$Port
    )
    if ($UsePnpm) {
        if ($Port -eq $DesiredPort) {
            return @('dev')
        }
        return @('exec', '--', 'vite', '--port', "$Port")
    }
    if ($Port -eq $DesiredPort) {
        return @('run', 'dev')
    }
    return @('run', 'dev', '--', '--port', "$Port")
}

function Start-DevServerWindow {
    param(
        [string]$RunnerPath,
        [string[]]$PrefixArgs,
        [string[]]$DevArgs,
        [int]$Port
    )
    $helperPath = Join-Path $env:TEMP "2606-dev-server-$Port.ps1"
    $quotedRunner = $RunnerPath.Replace("'", "''")
    $quotedRoot = $Root.Replace("'", "''")
    $argParts = @($PrefixArgs + $DevArgs) | ForEach-Object {
        if ($_ -match '\s') { "'$($_.Replace("'", "''"))'" } else { $_ }
    }
    $argLine = $argParts -join ' '
    @"
`$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath '$quotedRoot'
if (-not `$env:NODE_OPTIONS -or `$env:NODE_OPTIONS -notmatch 'max-old-space-size') {
    `$env:NODE_OPTIONS = ((`$env:NODE_OPTIONS + ' --max-old-space-size=4096').Trim())
}
Write-Host 'vite (dev) porta $Port  (Ctrl+C para parar; heap max 4 GB)' -ForegroundColor Cyan
& '$quotedRunner' $argLine
"@ | Set-Content -LiteralPath $helperPath -Encoding UTF8

    Start-Process powershell.exe -WindowStyle Minimized -ArgumentList @(
        '-NoExit',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $helperPath
    ) | Out-Null
}

function Wait-AppRouteReady {
    param(
        [string]$Url,
        [int]$Port,
        [int]$MaxSeconds = 90
    )
    for ($i = 1; $i -le $MaxSeconds; $i++) {
        if ($i -eq 1 -or ($i % 5) -eq 0) {
            Write-Host "  ... aguardando rota $DashPath (${i}s)" -ForegroundColor DarkGray
        }
        $listening = -not (Test-PortFree -Port $Port)
        if ($i -ge 20 -and -not $listening) {
            Write-Host ''
            Write-Host 'ERRO: o servidor nao ficou ativo na porta.' -ForegroundColor Red
            Write-Host 'Abra a janela PowerShell minimizada para ver o erro.' -ForegroundColor Yellow
            return $false
        }
        if (Test-AppRouteOk -Port $Port) {
            return $true
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

# --- main ---

Set-Location -LiteralPath $Root

if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
    Write-Host 'ERRO: package.json nao existe em:' -ForegroundColor Red
    Write-Host "  $Root" -ForegroundColor Red
    Read-Host 'Enter para fechar'
    exit 1
}

$UsePnpm = Test-Path -LiteralPath (Join-Path $Root 'pnpm-lock.yaml')
$Runner = Resolve-PackageRunner -PreferPnpm:$UsePnpm
if (-not $Runner) {
    $need = if ($UsePnpm) { 'pnpm (ou corepack do Node.js)' } else { 'npm' }
    Write-Host "ERRO: $need nao encontrado. Instale Node.js LTS (nodejs.org)." -ForegroundColor Red
    Read-Host 'Enter para fechar'
    exit 1
}
if ($UsePnpm -and $Runner.Prefix.Count -gt 0) {
    Write-Host 'pnpm via corepack (Node.js)' -ForegroundColor DarkGray
}

if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Host 'Instalando dependencias (primeira vez)...' -ForegroundColor Cyan
    $exitCode = Invoke-NodePackage -RunnerPath $Runner.Executable -PrefixArgs $Runner.Prefix -ArgumentList @('install') -Wait
    if ($exitCode -ne 0) {
        Read-Host 'Enter para fechar'
        exit $exitCode
    }
}

Clear-Host
Write-Host ''
Write-Host '=== 2606 Cofre de Notas (Vite) ===' -ForegroundColor Cyan
Write-Host "Pasta: $Root" -ForegroundColor DarkGray
Write-Host "Rota obrigatoria: $DashPath" -ForegroundColor DarkGray
Write-Host ''
Write-Host '--- Portas candidatas ---' -ForegroundColor White
$rows = foreach ($p in $CandidatePorts) { Get-PortRow -Port $p }
$rows | Format-Table Port, Status, PID, Process -AutoSize
$occupied = @($rows | Where-Object { $_.Status -eq 'ocupada' })
if ($occupied.Count -gt 0) {
    Write-Host 'Processos nas portas ocupadas:' -ForegroundColor DarkGray
    foreach ($o in $occupied) {
        Write-Host "  :$($o.Port)  PID $($o.PID)  $($o.Process)"
        if ($o.CommandLine) { Write-Host "         $($o.CommandLine)" -ForegroundColor DarkGray }
    }
} else {
    Write-Host 'Nenhuma porta candidata ocupada.' -ForegroundColor Green
}

Write-Host ''
Write-Host "Porta desejada:    $DesiredPort" -ForegroundColor Cyan

$cofreListeners = @(Get-CofreListeners -ProjectRoot $Root)
if ($cofreListeners.Count -gt 0) {
    Write-Host ''
    Write-Host "Encontrado(s) $($cofreListeners.Count) servidor(es) antigo(s) deste projeto." -ForegroundColor Yellow
    $null = Stop-StaleCofreListeners -ProjectRoot $Root -Listeners $cofreListeners
    Write-Host 'Antigos encerrados. Subindo servidor novo...' -ForegroundColor Cyan
    Write-Host ''
}

$SelectedPort = $null
foreach ($port in $CandidatePorts) {
    if (Test-PortFree -Port $port) {
        $SelectedPort = $port
        break
    }
}

if (-not $SelectedPort) {
    Write-Host 'ERRO: nenhuma porta livre na lista.' -ForegroundColor Red
    Write-Host "Testadas: $($CandidatePorts -join ', ')" -ForegroundColor Red
    Read-Host 'Enter para fechar'
    exit 1
}

$Url = "http://localhost:$SelectedPort$DashPath"
Write-Host "Porta selecionada: $SelectedPort" -ForegroundColor Green
Write-Host "URL:               $Url" -ForegroundColor Green
Write-Host ''

$devTail = Get-DevServerArgs -UsePnpm:$UsePnpm -Port $SelectedPort
Start-DevServerWindow -RunnerPath $Runner.Executable -PrefixArgs $Runner.Prefix -DevArgs $devTail -Port $SelectedPort

Write-Host 'Servidor iniciado em janela minimizada (logs la).' -ForegroundColor DarkGray
Write-Host "Aguardando $DashPath responder (sem 404)..." -ForegroundColor DarkGray

$opened = Wait-AppRouteReady -Url $Url -Port $SelectedPort
if ($opened) {
    Start-Process $Url
}

Write-Host ''
if ($opened) {
    Write-Host "Pronto. Rota $DashPath validada. Navegador aberto." -ForegroundColor Green
} else {
    Write-Host 'Servidor ainda compilando ou rota nao validou. Abra manualmente:' -ForegroundColor Yellow
    Write-Host "  $Url" -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Para parar: feche a janela PowerShell minimizada ou Ctrl+C la.' -ForegroundColor DarkGray
Write-Host 'Sync Supabase (opcional): defina VITE_SUPABASE_* no .env e reinicie o dev.' -ForegroundColor DarkGray
Read-Host 'Enter para fechar esta janela'

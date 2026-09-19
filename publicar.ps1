# publicar.ps1 - cria a tag de versao e dispara o workflow de release no GitHub.
# A CI (tauri-action) builda, ASSINA e publica o instalador + latest.json.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File ".\publicar.ps1"
#   powershell -NoProfile -ExecutionPolicy Bypass -File ".\publicar.ps1" -Version 0.2.0

param(
    [string]$Version = "0.11.1",
    [string]$Repo = "marcel-ceceu/cofre-notas"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Repo:    $Repo"     -ForegroundColor Cyan
Write-Host "==> Versao:  $Version"  -ForegroundColor Cyan
Write-Host ""

# 1) Senha da chave do updater: a chave NAO tem senha, e o workflow le o secret
#    ausente como string vazia — que e' exatamente o que o tauri espera.
#    NUNCA "setar vazio" via pipe: no PowerShell 5.1, `$null | gh secret set`
#    grava uma linha em branco e a CI cai com "Wrong password for that key"
#    (foi o que derrubou a release v0.10.0 em 19/09/2026). Garantimos a ausencia.
Write-Host "==> Garantindo que TAURI_SIGNING_PRIVATE_KEY_PASSWORD NAO existe no repo..." -ForegroundColor Cyan
$secrets = (gh secret list --repo $Repo 2>$null) -join "`n"
if ($secrets -match "TAURI_SIGNING_PRIVATE_KEY_PASSWORD") {
    gh secret delete TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repo
    Write-Host "    Secret removido (senha vazia = ausente)." -ForegroundColor Green
}
else {
    Write-Host "    OK (ausente)." -ForegroundColor Green
}
Write-Host ""

# 2) Tag de versao + push (dispara o workflow .github/workflows/release.yml)
$tag = "v$Version"
Write-Host "==> Criando/enviando a tag $tag..." -ForegroundColor Cyan

$existeLocal = (git tag --list $tag)
if ($existeLocal) {
    Write-Host "    Tag $tag ja existe localmente; pulando 'git tag'." -ForegroundColor Yellow
}
else {
    git tag $tag
}

git push origin $tag
Write-Host ""

Write-Host "==> Pronto! O build comecou. Acompanhe em:" -ForegroundColor Green
Write-Host "    https://github.com/$Repo/actions"
Write-Host ""
Write-Host "    Quando ficar verde, o instalador estara em:" -ForegroundColor Green
Write-Host "    https://github.com/$Repo/releases/latest"
Write-Host "    Baixe e instale UMA vez (essa versao ja tem o updater)."

# publicar.ps1 - cria a tag de versao e dispara o workflow de release no GitHub.
# A CI (tauri-action) builda, ASSINA e publica o instalador + latest.json.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File ".\publicar.ps1"
#   powershell -NoProfile -ExecutionPolicy Bypass -File ".\publicar.ps1" -Version 0.2.0

param(
    [string]$Version = "0.9.2",
    [string]$Repo = "marcel-ceceu/cofre-notas"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Repo:    $Repo"     -ForegroundColor Cyan
Write-Host "==> Versao:  $Version"  -ForegroundColor Cyan
Write-Host ""

# 1) Secret da senha (vazia). A chave nao tem senha; isso e' so para deixar explicito.
#    Se falhar, nao tem problema: o workflow trata secret ausente como string vazia.
Write-Host "==> Configurando secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD (vazia)..." -ForegroundColor Cyan
$tmp = New-TemporaryFile
try {
    Get-Content -Raw $tmp.FullName | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repo
    Write-Host "    OK (senha vazia configurada)." -ForegroundColor Green
}
catch {
    Write-Warning "    Nao consegui setar a senha vazia; seguindo (o workflow assume vazio por padrao)."
}
finally {
    Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
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

param (
    [string]$NodePort = "8090",
    [string]$ScraperPort = "8080",
    [string]$DataFolder = "gmapsdata"
)

if (-not (Test-Path $DataFolder)) {
    New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
}

Write-Host "Iniciando servidor Node de BUSCA-CHAMBA-3000 en http://localhost:$NodePort ..." -ForegroundColor Cyan
Start-Process node -ArgumentList "server.js" -WindowStyle Hidden

Write-Host "Iniciando motor web del Scraper en http://localhost:$ScraperPort ..." -ForegroundColor Green
Start-Sleep -Seconds 1

Start-Process "http://localhost:$NodePort"

Write-Host ""
Write-Host "Panel de Leads en Vivo: http://localhost:$NodePort" -ForegroundColor Green
Write-Host "Scraper nativo:         http://localhost:$ScraperPort" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona Ctrl+C para detener."

.\google_maps_scraper.exe -web -addr ":$ScraperPort" -data-folder $DataFolder

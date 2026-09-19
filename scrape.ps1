param (
    [string]$Queries = "queries.txt",
    [int]$Depth = 1,
    [int]$Concurrency = 4
)

if (-not (Test-Path $Queries)) {
    Write-Error "No existe el archivo de consultas: $Queries"
    exit 1
}

if (-not (Test-Path "salidas")) {
    New-Item -ItemType Directory -Force -Path "salidas" | Out-Null
}

Write-Host "Ejecutando scraper para '$Queries' con profundidad $Depth y concurrencia $Concurrency..." -ForegroundColor Cyan
.\google_maps_scraper.exe -input $Queries -results "salidas\resultados.csv" -depth $Depth -c $Concurrency -email -lang es -exit-on-inactivity 3m

Write-Host ""
Write-Host "Listo. Resultados guardados en: salidas\resultados.csv" -ForegroundColor Green

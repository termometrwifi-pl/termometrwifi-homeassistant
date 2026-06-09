<#
.SYNOPSIS
  Deploy the TermometrWifi integration straight into Home Assistant (skip git/HACS/zipball).

.DESCRIPTION
  Copies custom_components\termometrwifi (and optionally blueprints) into the HA `config` folder.
  Optionally restarts HA via the REST API using a long-lived token.

.EXAMPLE
  # 1) Set the HA config path once (Samba/SSH/mount), e.g. HA OS + Samba add-on:
  $env:TWIFI_HA_CONFIG = "\\homeassistant\config"
  # or "Z:\config" / "\\NAS\ha\config" / "C:\ha\config"

  # 2) Copy files only:
  .\scripts\deploy.ps1

  # 3) Copy + auto restart HA (token from Profile -> Long-lived tokens):
  $env:TWIFI_HA_URL   = "http://homeassistant.local:8123"
  $env:TWIFI_HA_TOKEN = "eyJ..."
  .\scripts\deploy.ps1 -Restart

.PARAMETER Target
  Path to HA `config` folder (overrides $env:TWIFI_HA_CONFIG).
.PARAMETER Restart
  Restart HA via REST API after copying.
.PARAMETER Blueprint
  Also copy blueprints\ (skipped by default).
#>
param(
  [string]$Target = $env:TWIFI_HA_CONFIG,
  [switch]$Restart,
  [switch]$Blueprint,
  [string]$HaUrl = $env:TWIFI_HA_URL,
  [string]$HaToken = $env:TWIFI_HA_TOKEN
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$srcInt = Join-Path $repo "custom_components\termometrwifi"

if (-not $Target) {
  Write-Host "No HA path. Set `$env:TWIFI_HA_CONFIG (e.g. \\homeassistant\config) or use -Target." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $srcInt)) { Write-Host "Source not found: $srcInt" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Target)) { Write-Host "Target not found/unreachable: $Target" -ForegroundColor Red; exit 1 }

$dstInt = Join-Path $Target "custom_components\termometrwifi"
Write-Host "Deploy: $srcInt  ->  $dstInt"
# /MIR mirrors (removes deleted files); skip caches and compiled files.
robocopy $srcInt $dstInt /MIR /XD __pycache__ /XF *.pyc *.pyo | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "robocopy error (code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
Write-Host "  integration copied." -ForegroundColor Green

if ($Blueprint) {
  $srcBp = Join-Path $repo "blueprints\automation\termometrwifi"
  if (Test-Path $srcBp) {
    $dstBp = Join-Path $Target "blueprints\automation\termometrwifi"
    robocopy $srcBp $dstBp /MIR | Out-Null
    Write-Host "  blueprint copied." -ForegroundColor Green
  }
}

if ($Restart) {
  if (-not $HaUrl -or -not $HaToken) {
    Write-Host "Restart skipped: set `$env:TWIFI_HA_URL and `$env:TWIFI_HA_TOKEN (long-lived token)." -ForegroundColor Yellow
  } else {
    Write-Host "Restarting HA via REST API..."
    $headers = @{ Authorization = "Bearer $HaToken" }
    Invoke-RestMethod -Method Post -Uri "$($HaUrl.TrimEnd('/'))/api/services/homeassistant/restart" -Headers $headers | Out-Null
    Write-Host "  HA restart requested." -ForegroundColor Green
  }
}

Write-Host "Done. .py changes need an HA restart; www/*.js changes only need Ctrl+Shift+R in the browser." -ForegroundColor Cyan

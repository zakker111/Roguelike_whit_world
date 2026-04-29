# Local QA helper (PowerShell): runs the full QA gates (lint/build + acceptance phase6 + acceptance phase0).
# Usage:
#   pwsh -File .\scripts\qa_full.ps1

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RootDir

New-Item -ItemType Directory -Force -Path artifacts/qa | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logPath = "artifacts/qa/qa_full_$stamp.log"

"## node version" | Tee-Object -FilePath $logPath
node -v | Tee-Object -FilePath $logPath -Append
"## npm version" | Tee-Object -FilePath $logPath -Append
npm -v | Tee-Object -FilePath $logPath -Append

"## npm install" | Tee-Object -FilePath $logPath -Append
npm install 2>&1 | Tee-Object -FilePath $logPath -Append

"## npx playwright install --with-deps chromium" | Tee-Object -FilePath $logPath -Append
npx playwright install --with-deps chromium 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run lint:strict" | Tee-Object -FilePath $logPath -Append
npm run lint:strict 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run build" | Tee-Object -FilePath $logPath -Append
npm run build 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run acceptance:phase6" | Tee-Object -FilePath $logPath -Append
npm run acceptance:phase6 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run acceptance:phase0" | Tee-Object -FilePath $logPath -Append
npm run acceptance:phase0 2>&1 | Tee-Object -FilePath $logPath -Append

Write-Host "Wrote QA log to $logPath"

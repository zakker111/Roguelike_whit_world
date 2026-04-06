# Local QA helper (PowerShell): runs the same checks the validator expects.
# Usage:
#   pwsh -File .\scripts\qa_phase6.ps1

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RootDir

New-Item -ItemType Directory -Force -Path artifacts/qa | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logPath = "artifacts/qa/qa_phase6_$stamp.log"

"## node version" | Tee-Object -FilePath $logPath
node -v | Tee-Object -FilePath $logPath -Append
"## npm version" | Tee-Object -FilePath $logPath -Append
npm -v | Tee-Object -FilePath $logPath -Append

"## npm install" | Tee-Object -FilePath $logPath -Append
npm install 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run ci" | Tee-Object -FilePath $logPath -Append
npm run ci 2>&1 | Tee-Object -FilePath $logPath -Append

"## npm run acceptance:phase6" | Tee-Object -FilePath $logPath -Append
npm run acceptance:phase6 2>&1 | Tee-Object -FilePath $logPath -Append

Write-Host "Wrote QA log to $logPath"

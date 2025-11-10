Write-Host "== AI Orchestrate (First Message) ==" -ForegroundColor Cyan
curl.exe -X POST -H "Content-Type: application/json" `
  --data-binary "@payloads/orchestrate_first.json" `
  "https://api.alex-io.com/api/ai/orchestrate?t=$(Get-Random)" | ConvertFrom-Json

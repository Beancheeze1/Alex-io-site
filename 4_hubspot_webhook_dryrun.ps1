Write-Host "== HubSpot Webhook DryRun ==" -ForegroundColor Cyan
curl.exe -X POST -H "Content-Type: application/json" `
  --data-binary "@payloads/webhook_dryrun.json" `
  "https://api.alex-io.com/api/hubspot/webhook?dryRun=1&t=$(Get-Random)" | ConvertFrom-Json

Write-Host "== Microsoft Graph Send Test ==" -ForegroundColor Cyan
curl.exe -X POST -H "Content-Type: application/json" `
  --data-binary "@payloads/send_graph.json" `
  "https://api.alex-io.com/api/msgraph/send?t=$(Get-Random)" | ConvertFrom-Json

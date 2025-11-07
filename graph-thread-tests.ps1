# graph-thread-tests.ps1
# Usage:
#   .\graph-thread-tests.ps1 -Base "https://api.alex-io.com" -To "25thhourdesign@gmail.com" -MessageId "<real.message.id@domain>"
param(
  [string]$Base = "https://api.alex-io.com",
  [string]$To   = "25thhourdesign@gmail.com",
  [string]$MessageId
)

function Header($url, $method="GET", $bodyPath=$null) {
  if ($bodyPath) {
    curl.exe -i "$url" -H "Content-Type: application/json" --data-binary "@$bodyPath"
  } else {
    curl.exe -i "$url"
  }
}

function Parse($url, $method="GET", $bodyPath=$null) {
  if ($bodyPath) {
    curl.exe "$url" -H "Content-Type: application/json" --data-binary "@$bodyPath" | ConvertFrom-Json
  } else {
    curl.exe "$url" | ConvertFrom-Json
  }
}

Write-Host "== A) Lookup by Internet-Message-ID ==" -ForegroundColor Cyan
if (-not $MessageId) {
  Write-Host "Provide -MessageId '<...@...>' (RFC 5322). Lookup will be skipped." -ForegroundColor Yellow
} else {
  $lookupGet = "$Base/api/msgraph/lookup?id=$([uri]::EscapeDataString($MessageId))&t=$(Get-Random)"
  Header $lookupGet        | Select-String -Pattern "HTTP/1.1", "content-type"
  $lookup = Parse  $lookupGet
  $lookup | Format-List
  if (-not $lookup.ok -or -not $lookup.found) {
    Write-Host "Lookup did not find the message in MS_MAILBOX_FROM. Aborting send step." -ForegroundColor Red
    return
  }
}

Write-Host "`n== B) Orchestrator dry run (no send) ==" -ForegroundColor Cyan
$dry = @{
  mode    = "ai"
  toEmail = $To
  subject = "Re: foam quote"
  text    = "qty 10; PE 1.7 pcf; outside 12 x 8 x 2 in; thickness under: 1/2 in"
  dryRun  = $true
} | ConvertTo-Json -Depth 6
$dryPath = "orch_dry.json"; $dry | Out-File -Encoding utf8 -NoNewline $dryPath

$dryUrl = "$Base/api/ai/orchestrate?t=$(Get-Random)"
Header $dryUrl "POST" $dryPath | Select-String -Pattern "HTTP/1.1", "content-type"
$dryRes = Parse  $dryUrl "POST" $dryPath
$dryRes | Format-List

Write-Host "`n== C) Orchestrator live threaded reply ==" -ForegroundColor Cyan
if (-not $MessageId) {
  Write-Host "Skipping live send because -MessageId was not provided." -ForegroundColor Yellow
  return
}

$live = @{
  mode      = "ai"
  toEmail   = $To
  html      = "<p>This should land as a threaded reply via Graph.</p>"
  inReplyTo = $MessageId
  dryRun    = $false
} | ConvertTo-Json -Depth 6
$livePath = "orch_reply.json"; $live | Out-File -Encoding utf8 -NoNewline $livePath

$liveUrl = "$Base/api/ai/orchestrate?t=$(Get-Random)"
Header $liveUrl "POST" $livePath | Select-String -Pattern "HTTP/1.1", "content-type"
$liveRes = Parse  $liveUrl "POST" $livePath
$liveRes | Format-List

if ($liveRes.ok -and $liveRes.forwarded -eq "/api/msgraph/send") {
  Write-Host "`nThreaded send attempted via Graph. If you see any 'sendMail_fallback' or 'reply_target_not_found', re-check the Message-ID with /api/msgraph/lookup." -ForegroundColor Green
}

Write-Host "== Alex-IO Admin Health Check ==" -ForegroundColor Cyan
curl.exe 'https://api.alex-io.com/api/admin/health?t=$(Get-Random)' | ConvertFrom-Json
curl.exe 'https://api.alex-io.com/api/admin/whoami?t=$(Get-Random)' | ConvertFrom-Json
curl.exe 'https://api.alex-io.com/api/admin/redis-check?t=$(Get-Random)' | ConvertFrom-Json
curl.exe 'https://api.alex-io.com/api/admin/mem?t=$(Get-Random)' | ConvertFrom-Json

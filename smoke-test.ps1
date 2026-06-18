# smoke-test.ps1
# Alex-IO post-deploy smoke test1.
# Usage:
#   .\smoke-test.ps1
#   .\smoke-test.ps1 -BaseUrl http://localhost:3000

param(
    [string]$BaseUrl = "https://api.alex-io.com"
)

$BaseUrl = $BaseUrl.TrimEnd("/")
$pass = 0
$fail = 0

function Pass($label) {
    Write-Host "  [PASS] $label" -ForegroundColor Green
    $script:pass++
}

function Fail($label, $detail) {
    Write-Host "  [FAIL] $label" -ForegroundColor Red
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkRed }
    $script:fail++
}

function Get-Url($path) {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl$path" -UseBasicParsing -ErrorAction Stop -TimeoutSec 15
        return @{ status = [int]$r.StatusCode; body = $r.Content; headers = $r.Headers }
    } catch {
        $s = 0
        if ($_.Exception.Response) { $s = [int]$_.Exception.Response.StatusCode }
        return @{ status = $s; body = ""; headers = @{}; error = $_.Exception.Message }
    }
}

function Post-Url($path, $body) {
    try {
        $json = $body | ConvertTo-Json -Compress
        $r = Invoke-WebRequest -Uri "$BaseUrl$path" -Method POST -ContentType "application/json" -Body $json -UseBasicParsing -ErrorAction Stop -TimeoutSec 15
        $parsed = $r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
        return @{ status = [int]$r.StatusCode; parsed = $parsed; raw = $r.Content }
    } catch {
        $s = 0; $raw = ""; $parsed = $null
        if ($_.Exception.Response) {
            $s = [int]$_.Exception.Response.StatusCode
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $raw = $reader.ReadToEnd()
                $parsed = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
            } catch {}
        }
        return @{ status = $s; parsed = $parsed; raw = $raw; error = $_.Exception.Message }
    }
}

Write-Host ""
Write-Host "Alex-IO Smoke Test" -ForegroundColor White
Write-Host "Target : $BaseUrl" -ForegroundColor DarkGray
Write-Host "Time   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
Write-Host ""

# 1. GET /api/health
$r = Get-Url "/api/health"
if ($r.status -eq 200) { Pass "GET /api/health -> 200" }
else { Fail "GET /api/health -> 200" "Got $($r.status)" }

# 2. GET /landing
$r = Get-Url "/landing"
if ($r.status -eq 200) { Pass "GET /landing -> 200" }
else { Fail "GET /landing -> 200" "Got $($r.status)" }

# 3-4. CSP headers
$csp = ""
if ($r.headers -and $r.headers["Content-Security-Policy"]) { $csp = $r.headers["Content-Security-Policy"] }

if ($csp -match "googleads\.g\.doubleclick\.net") { Pass "CSP contains googleads.g.doubleclick.net" }
else { Fail "CSP contains googleads.g.doubleclick.net" "Not found in CSP header" }

if ($csp -match "www\.google\.com") { Pass "CSP contains www.google.com" }
else { Fail "CSP contains www.google.com" "Not found in CSP header" }

# 5. demo-lead FreeTrial
$r = Post-Url "/api/demo-lead" @{ tier = "FreeTrial"; name = "Smoke Test"; email = "smoketest@alex-io.com" }
if ($r.parsed.ok -eq $true) { Pass "POST /api/demo-lead tier=FreeTrial -> ok:true" }
else { Fail "POST /api/demo-lead tier=FreeTrial -> ok:true" "Got: $($r.raw)" }

# 6. demo-lead Starter
$r = Post-Url "/api/demo-lead" @{ tier = "Starter"; name = "Smoke Test"; email = "smoketest@alex-io.com" }
if ($r.parsed.ok -eq $true) { Pass "POST /api/demo-lead tier=Starter -> ok:true" }
else { Fail "POST /api/demo-lead tier=Starter -> ok:true" "Got: $($r.raw)" }

# 7. demo-lead invalid tier
$r = Post-Url "/api/demo-lead" @{ tier = "BOGUS_XYZ"; name = "X"; email = "x@x.com" }
if ($r.parsed.ok -eq $false) { Pass "POST /api/demo-lead tier=BOGUS_XYZ -> ok:false" }
else { Fail "POST /api/demo-lead tier=BOGUS_XYZ -> ok:false" "Expected rejection, got: $($r.raw)" }

# 8. Public shipping-settings
$r = Get-Url "/api/public/shipping-settings"
if ($r.status -eq 200) {
    $p = $r.body | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($p.ok -eq $true -and $null -ne $p.rough_ship_pct -and ($p.rough_ship_pct -is [double] -or $p.rough_ship_pct -is [int])) {
        Pass "GET /api/public/shipping-settings -> 200 ok:true rough_ship_pct=$($p.rough_ship_pct)"
    } else {
        Fail "GET /api/public/shipping-settings body" "ok=$($p.ok) rough_ship_pct=$($p.rough_ship_pct)"
    }
} else { Fail "GET /api/public/shipping-settings -> 200" "Got $($r.status)" }

# 9. Admin shipping-settings requires auth
$r = Get-Url "/api/admin/shipping-settings"
if ($r.status -eq 401) { Pass "GET /api/admin/shipping-settings without auth -> 401" }
else { Fail "GET /api/admin/shipping-settings without auth -> 401" "Got $($r.status)" }

# 10. Track page_view
$sid = [System.Guid]::NewGuid().ToString()
$r = Post-Url "/api/track" @{ session_id = $sid; event_type = "page_view"; page = "/landing" }
if ($r.parsed.ok -eq $true) { Pass "POST /api/track event_type=page_view -> ok:true" }
else { Fail "POST /api/track event_type=page_view -> ok:true" "Got: $($r.raw)" }

# 11. Track invalid event
$r = Post-Url "/api/track" @{ session_id = $sid; event_type = "INVALID_XYZ"; page = "/landing" }
if ($r.parsed.ok -eq $false) { Pass "POST /api/track event_type=INVALID_XYZ -> ok:false" }
else { Fail "POST /api/track event_type=INVALID_XYZ -> ok:false" "Got: $($r.raw)" }

# 12. Demo seed
$r = Post-Url "/api/demo/seed" @{
    outsideL = "16"; outsideW = "12"; outsideH = "10"; qty = "100"
    shipMode = "box"; insertType = "set"; holding = "pockets"
    pocketCount = "2"; layerCount = "2"
    materialMode = "known"; materialText = "Polyethylene 1.7 PCF"
    cavities = "3.5 dia x 2, 3.5 dia x 2"; source = "smoke-test"
}
if ($r.parsed.ok -eq $true -and $r.parsed.redirectPath) { Pass "POST /api/demo/seed -> ok:true with redirectPath" }
else { Fail "POST /api/demo/seed -> ok:true with redirectPath" "Got: $($r.raw) (status $($r.status))" }

# 13. Admin logs requires auth
$r = Get-Url "/api/admin/logs"
if ($r.status -in @(401, 403)) { Pass "GET /api/admin/logs without auth -> $($r.status)" }
elseif ($r.status -eq 404) { Pass "GET /api/admin/logs -> 404 (not exposed)" }
else { Fail "GET /api/admin/logs without auth -> 401 or 403" "Got $($r.status)" }

# 14. Admin users requires auth
$r = Get-Url "/api/admin/users"
if ($r.status -in @(401, 403)) { Pass "GET /api/admin/users without auth -> $($r.status)" }
elseif ($r.status -eq 404) { Pass "GET /api/admin/users -> 404 (not exposed)" }
else { Fail "GET /api/admin/users without auth -> 401 or 403" "Got $($r.status)" }

# Summary
$total = $pass + $fail
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray
if ($fail -eq 0) {
    Write-Host "  ALL $total TESTS PASSED" -ForegroundColor Green
} else {
    Write-Host "  $pass / $total passed   ($fail failed)" -ForegroundColor Red
}
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host ""
exit $(if ($fail -eq 0) { 0 } else { 1 })

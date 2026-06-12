# Taekwondo Scoreboard Local Web Server
# Run this script using PowerShell: .\start_server.ps1
# Set the execution policy first if blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$port = 8080

# Auto-detect Local IPv4 Address (exclude localhost and virtual network adapters)
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.IPAddress -notlike "127.*" -and 
    $_.IPAddress -notlike "169.254.*" -and 
    $_.InterfaceAlias -notlike "*vEthernet*" -and 
    $_.InterfaceAlias -notlike "*Virtual*"
} | Select-Object -First 1).IPAddress

if (!$ip) {
    $ip = "127.0.0.1"
}

$url = "http://*:$port/"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " [StarLord TKD] Taekwondo Scoring Server Starting..." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Host URL: http://localhost:${port}/" -ForegroundColor Yellow
Write-Host "Mobile QR URL: http://${ip}:${port}/mobile.html" -ForegroundColor Green
Write-Host "Local IP: ${ip}" -ForegroundColor Green
Write-Host "Make sure phone and PC are connected to the SAME Wi-Fi." -ForegroundColor Yellow
Write-Host "To stop server, press [Ctrl + C] in this window." -ForegroundColor Red
Write-Host "========================================================" -ForegroundColor Cyan

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
} catch {
    Write-Host "ERROR: Cannot start server. Run PowerShell as Administrator." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit
}

# Queue for storing referee button inputs
$pendingPresses = [System.Collections.Generic.List[string]]::new()

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $path = $request.Url.AbsolutePath
        
        if ($path -eq "/" -or $path -eq "/index.html") {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "index.html"))
            $response.ContentType = "text/html; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/app.js") {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "app.js"))
            $response.ContentType = "application/javascript; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/style.css") {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "style.css"))
            $response.ContentType = "text/css; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/mobile.html") {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "mobile.html"))
            $response.ContentType = "text/html; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/qrcode.min.js") {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "qrcode.min.js"))
            $response.ContentType = "application/javascript; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/api/ip") {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($ip)
            $response.ContentType = "text/plain"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/api/press") {
            # Receives scoring hit: /api/press?judge=1&color=blue&points=2
            $judge = $request.QueryString["judge"]
            $color = $request.QueryString["color"]
            $points = $request.QueryString["points"]
            if (!$points) { $points = "2" }
            if ($judge -and $color) {
                [System.Threading.Monitor]::Enter($pendingPresses)
                try {
                    $item = "${judge}:${color}:${points}"
                    $pendingPresses.Add($item)
                } finally {
                    [System.Threading.Monitor]::Exit($pendingPresses)
                }
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("ok")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($path -eq "/api/poll") {
            # Operator page polls for fresh mobile scores
            $presses = @()
            [System.Threading.Monitor]::Enter($pendingPresses)
            try {
                if ($pendingPresses.Count -gt 0) {
                    $presses = $pendingPresses.ToArray()
                    $pendingPresses.Clear()
                }
            } finally {
                [System.Threading.Monitor]::Exit($pendingPresses)
            }
            # Convert to array JSON
            $json = ConvertTo-Json -InputObject $presses -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $response.StatusCode = 404
        }
        
        $response.Close()
    }
    catch {
        # Catch network or exit exceptions silently to prevent script crash
    }
}

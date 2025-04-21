# Adds two paths to the system PATH environment variable
# Run PowerShell as Administrator

$pathsToAdd = @(
    "C:\Windows\System32",
    "%SYSTEMROOT%\System32\WindowsPowerShell\v1.0\"
)

# Get current system PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")

# Split current PATH into array
$pathArray = $currentPath -split ';'

# Add new paths if not already present
foreach ($newPath in $pathsToAdd) {
    if (-not ($pathArray -contains $newPath)) {
        $pathArray += $newPath
    }
}

# Join array back to string
$newPathValue = ($pathArray -join ';').TrimEnd(';')

# Set the new PATH
[Environment]::SetEnvironmentVariable("Path", $newPathValue, "Machine")

Write-Output "System PATH updated. You may need to restart your session for changes to take effect."

# --- Add proxy environment variables for the current user if not already set ---
$proxyVars = @{
    "http_proxy"  = "http://fortigate.misa.local:8080"
    "https_proxy" = "http://fortigate.misa.local:8080"
    "no_proxy"    = "tfs2017-app,tfs2017,tfs2017-03,192.168.41.206,aiagentmonitor.misa.local"
}

foreach ($var in $proxyVars.Keys) {
    if ($var -eq "no_proxy") {
        $currentValue = [Environment]::GetEnvironmentVariable($var, "User")
        if ($null -eq $currentValue) {
            [Environment]::SetEnvironmentVariable($var, $proxyVars[$var], "User")
            Write-Output "$var set to $($proxyVars[$var])"
        } else {
            # Append aiagentmonitor.misa.local if not already present
            $noProxyList = $currentValue -split ','
            if ($noProxyList -notcontains "aiagentmonitor.misa.local") {
                $newNoProxy = ($noProxyList + "aiagentmonitor.misa.local") -join ','
                [Environment]::SetEnvironmentVariable($var, $newNoProxy, "User")
                Write-Output "$var updated to include aiagentmonitor.misa.local"
            } else {
                Write-Output "$var already contains aiagentmonitor.misa.local, skipping."
            }
        }
    } else {
        $currentValue = [Environment]::GetEnvironmentVariable($var, "User")
        if ($null -eq $currentValue -or $currentValue -ne $proxyVars[$var]) {
            [Environment]::SetEnvironmentVariable($var, $proxyVars[$var], "User")
            Write-Output "$var set to $($proxyVars[$var])"
        } else {
            Write-Output "$var already set to desired value, skipping."
        }
    }
}

Write-Output "User proxy environment variables checked and set if needed. You may need to restart your session for changes to take effect."
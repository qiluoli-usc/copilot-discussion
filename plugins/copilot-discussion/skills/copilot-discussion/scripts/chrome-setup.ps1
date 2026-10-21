param([switch]$NoInstall, [string]$OfflineInstaller)
$ErrorActionPreference = 'Stop'
function Find-DiscussionChrome {
    $DiscussionCandidates = @(
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($DiscussionRegistry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
        if (Test-Path -LiteralPath $DiscussionRegistry) { $DiscussionCandidates += (Get-Item -LiteralPath $DiscussionRegistry).GetValue('') }
    }
    foreach ($DiscussionCandidate in $DiscussionCandidates) { if ($DiscussionCandidate -and (Test-Path -LiteralPath $DiscussionCandidate -PathType Leaf)) { return $DiscussionCandidate } }
    return $null
}
$DiscussionChrome = Find-DiscussionChrome
$DiscussionAction = 'reused'
if (!$DiscussionChrome -and !$NoInstall) {
    if ($OfflineInstaller) {
        $DiscussionExpectedHash = '2a9b18526096b614fbfda4324280fc69316e42dcb0668301f2cd8a4524054664'
        if (!(Test-Path -LiteralPath $OfflineInstaller -PathType Leaf) -or (Get-FileHash -LiteralPath $OfflineInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $DiscussionExpectedHash) { throw 'Bundled Chrome installer SHA256 mismatch.' }
        $DiscussionSignature = Get-AuthenticodeSignature -LiteralPath $OfflineInstaller
        if ($DiscussionSignature.Status -ne 'Valid' -or $DiscussionSignature.SignerCertificate.Subject -notmatch 'O=Google LLC') { throw 'Bundled Chrome installer signature verification failed.' }
        $DiscussionProcess = Start-Process -FilePath $OfflineInstaller -ArgumentList '--do-not-launch-chrome' -WindowStyle Hidden -Wait -PassThru
        $DiscussionAction = if ($DiscussionProcess.ExitCode -in @(0,3)) { 'installed_offline' } else { 'installation_needs_action' }
        $DiscussionChrome = Find-DiscussionChrome
    } else {
    $DiscussionWinget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($DiscussionWinget) {
        # The official winget-pkgs Google.Chrome.EXE manifest offers a user
        # installer. Do not elevate, force a hash mismatch or replace a browser.
        & $DiscussionWinget.Source install --id Google.Chrome.EXE --exact --source winget --scope user --silent --disable-interactivity --accept-source-agreements --accept-package-agreements *> $null
        $DiscussionAction = if ($LASTEXITCODE -eq 0) { 'installed' } else { 'installation_needs_action' }
        $DiscussionChrome = Find-DiscussionChrome
    }
    }
}
if ($DiscussionChrome) {
    @{ status='installed'; action=$DiscussionAction; path=$DiscussionChrome; authorization='manual'; next='Open chrome://inspect/#remote-debugging, enable remote debugging, and approve Chrome Allow. Microsoft login remains manual.' } | ConvertTo-Json -Compress
} else {
    @{ status='needs_action'; action=$DiscussionAction; reason='Google Chrome not found; user-scope winget installation is unavailable or blocked. Install Google Chrome, then rerun setup --check-browser.' } | ConvertTo-Json -Compress
}

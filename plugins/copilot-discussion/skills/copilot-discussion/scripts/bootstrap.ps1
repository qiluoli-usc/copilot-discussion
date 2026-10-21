[CmdletBinding()]
param(
    [string]$Workspace = (Get-Location).Path,
    [string]$Target = 'all',
    [string]$RuntimeRoot = '',
    [string]$DataDir = '',
    [string]$Config = '',
    [string]$Output = '',
    [string]$SkillsDir = '',
    [switch]$InstallSkills,
    [switch]$NoInstall,
    [switch]$Isolated,
    [switch]$ForceManagedNode,
    [switch]$SkipBrowserCheck,
    [switch]$SkipChromeInstall,
    [switch]$Replace
)
$ErrorActionPreference = 'Stop'
$env:COPILOT_DISCUSSION_BOOTSTRAP_STARTED_AT = [DateTime]::UtcNow.ToString('o')
$env:COPILOT_DISCUSSION_BOOTSTRAP_NODE_ACTION = 'reused'
if ($env:OS -ne 'Windows_NT') { throw 'Jev Native bootstrap currently supports local Windows only.' }
if (!$DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'CopilotDiscussion' }
if (![IO.Path]::IsPathRooted($DataDir) -or ![IO.Path]::IsPathRooted($Workspace)) { throw 'DataDir and Workspace must be absolute.' }
$DiscussionLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$DiscussionNode = $null
if (!$ForceManagedNode) {
    $DiscussionCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($DiscussionCommand) {
        $DiscussionVersion = & $DiscussionCommand.Source --version
        if ($LASTEXITCODE -eq 0 -and $DiscussionVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { $DiscussionNode = $DiscussionCommand.Source }
    }
}
if (!$DiscussionNode) {
    $env:COPILOT_DISCUSSION_BOOTSTRAP_NODE_ACTION = 'managed'
    if ($NoInstall) { throw 'Node 20+ missing; NoInstall does not download it.' }
    $DiscussionArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $DiscussionArch = switch ($DiscussionArchitecture) { 'AMD64' {'x64'} 'ARM64' {'arm64'} default { throw 'Only Windows x64/arm64 supported.' } }
    $DiscussionAsset = $DiscussionLock.node.$DiscussionArch
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $DiscussionData = (Resolve-Path -LiteralPath $DataDir).Path.TrimEnd('\')
    $DiscussionNodeFolder = [IO.Path]::GetFullPath((Join-Path $DiscussionData "tools\node-$($DiscussionLock.node.version)-$DiscussionArch"))
    if (!$DiscussionNodeFolder.StartsWith($DiscussionData + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Node target escapes data directory.' }
    $DiscussionNode = Join-Path $DiscussionNodeFolder "$($DiscussionAsset.folder)\node.exe"
    if (!(Test-Path -LiteralPath $DiscussionNode -PathType Leaf)) {
        if (Test-Path -LiteralPath $DiscussionNodeFolder) { throw 'Incomplete Node folder exists; choose a fresh DataDir.' }
        $DiscussionDownloads = Join-Path $DiscussionData 'downloads'
        New-Item -ItemType Directory -Path $DiscussionDownloads -Force | Out-Null
        $DiscussionZip = Join-Path $DiscussionDownloads "node-$($DiscussionLock.node.version)-$DiscussionArch.zip"
        if (!(Test-Path -LiteralPath $DiscussionZip)) {
            $DiscussionPartial = $DiscussionZip + '.' + [guid]::NewGuid().ToString('N') + '.partial'
            Invoke-WebRequest -UseBasicParsing -Uri $DiscussionAsset.url -OutFile $DiscussionPartial
            if ((Get-FileHash -LiteralPath $DiscussionPartial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $DiscussionAsset.sha256) { throw 'Node download SHA256 mismatch; nothing executed.' }
            Move-Item -LiteralPath $DiscussionPartial -Destination $DiscussionZip
        }
        if ((Get-FileHash -LiteralPath $DiscussionZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $DiscussionAsset.sha256) { throw 'Cached Node SHA256 mismatch.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $DiscussionNodeFolder) -Force | Out-Null
        & (Join-Path $PSScriptRoot 'expand-archive.ps1') -Archive $DiscussionZip -Destination $DiscussionNodeFolder
    }
    $DiscussionVersion = & $DiscussionNode --version
    if ($LASTEXITCODE -ne 0 -or $DiscussionVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) { throw 'Managed Node verification failed.' }
}
Write-Host 'Preparing Jev Native. Chrome may show Allow. Remote debugging and Microsoft sign-in require your action; no recording or decision-model calls during setup.'
$DiscussionArguments = @((Join-Path $PSScriptRoot 'setup.mjs'), '--workspace', $Workspace, '--target', $Target, '--data-dir', $DataDir)
foreach ($DiscussionPair in @(@('--runtime-root',$RuntimeRoot), @('--config',$Config), @('--output',$Output), @('--skills-dir',$SkillsDir))) {
    if ($DiscussionPair[1]) { $DiscussionArguments += $DiscussionPair }
}
if ($InstallSkills) { $DiscussionArguments += '--install-skills' }
if ($NoInstall) { $DiscussionArguments += '--no-install' }
if ($Isolated) { $DiscussionArguments += '--isolated' }
if ($Replace) { $DiscussionArguments += '--replace' }
if (!$SkipBrowserCheck) { $DiscussionArguments += '--check-browser' }
if ($SkipChromeInstall) { $DiscussionArguments += '--skip-chrome-install' }
& $DiscussionNode @DiscussionArguments
exit $LASTEXITCODE

param([string]$NodeCommand = 'node')
$ErrorActionPreference = 'Stop'
try {
    $DiscussionConfig = if ($env:COPILOT_DISCUSSION_CONFIG) { $env:COPILOT_DISCUSSION_CONFIG } else { Join-Path $env:USERPROFILE '.copilot-discussion\config.json' }
    $DiscussionCandidates = @()
    if ($env:COPILOT_DISCUSSION_NODE) { $DiscussionCandidates += $env:COPILOT_DISCUSSION_NODE }
    if ($NodeCommand) { $DiscussionCandidates += $NodeCommand }
    $DiscussionLauncherFile = Join-Path (Split-Path -Parent $DiscussionConfig) 'launcher.json'
    if (Test-Path -LiteralPath $DiscussionLauncherFile -PathType Leaf) {
        $DiscussionLauncher = Get-Content -LiteralPath $DiscussionLauncherFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($DiscussionLauncher.schemaVersion -eq 1 -and [IO.Path]::IsPathRooted($DiscussionLauncher.nodeExecutable)) { $DiscussionCandidates += $DiscussionLauncher.nodeExecutable }
    }
    $DiscussionNode = $null
    foreach ($DiscussionCandidate in $DiscussionCandidates) {
        $DiscussionExecutable = Get-Command $DiscussionCandidate -ErrorAction SilentlyContinue
        if ($DiscussionExecutable) {
            $DiscussionVersion = & $DiscussionExecutable.Source --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $DiscussionVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { $DiscussionNode = $DiscussionExecutable.Source; break }
        }
    }
    if (!$DiscussionNode) { throw 'Node 20+ missing. Run this plugin scripts/bootstrap.ps1 once; MCP startup does not install dependencies.' }
    & $DiscussionNode (Join-Path $PSScriptRoot 'mcp-server.mjs') --config $DiscussionConfig
    exit $LASTEXITCODE
} catch { [Console]::Error.WriteLine('Copilot Discussion MCP launcher failed. Complete bootstrap.ps1 and check the config/Node paths.'); exit 2 }

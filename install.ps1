[CmdletBinding()]
param(
    [string]$Workspace = (Get-Location).Path,
    [string]$Target = 'all', [string]$RuntimeRoot = '', [string]$DataDir = '',
    [string]$Config = '', [string]$Output = '', [string]$SkillsDir = '',
    [switch]$InstallSkills, [switch]$NoInstall, [switch]$Isolated,
    [switch]$ForceManagedNode, [switch]$SkipBrowserCheck, [switch]$SkipChromeInstall, [switch]$Replace
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'plugins\copilot-discussion\skills\copilot-discussion\scripts\bootstrap.ps1') @PSBoundParameters
exit $LASTEXITCODE

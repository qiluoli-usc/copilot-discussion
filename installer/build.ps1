param([string]$Node, [string]$SeedDownloads, [string]$PreparedWheels, [string]$Output, [string]$SignTool, [string]$CertificateThumbprint, [string]$TimestampUrl)
$ErrorActionPreference = 'Stop'
if (!$Node) { $Node = (Get-Command node.exe -ErrorAction Stop).Source }
$DiscussionBuildArgs = @((Join-Path $PSScriptRoot 'build.mjs'))
if ($SeedDownloads) { $DiscussionBuildArgs += @('--seed-downloads', $SeedDownloads) }
if ($PreparedWheels) { $DiscussionBuildArgs += @('--prepared-wheels', $PreparedWheels) }
if ($Output) { $DiscussionBuildArgs += @('--output', $Output) }
if ($SignTool) { $DiscussionBuildArgs += @('--sign-tool', $SignTool) }
if ($CertificateThumbprint) { $DiscussionBuildArgs += @('--certificate-thumbprint', $CertificateThumbprint) }
if ($TimestampUrl) { $DiscussionBuildArgs += @('--timestamp-url', $TimestampUrl) }
& $Node @DiscussionBuildArgs
exit $LASTEXITCODE

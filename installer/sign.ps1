param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string]$SignTool,
    [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
    [string]$TimestampUrl
)
$ErrorActionPreference = 'Stop'
if (![IO.Path]::IsPathRooted($File) -or !(Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Signing target must be an existing absolute file.' }
if (![IO.Path]::IsPathRooted($SignTool) -or !(Test-Path -LiteralPath $SignTool -PathType Leaf)) { throw 'Supply the actual Windows SDK SignTool path.' }
if ($CertificateThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Supply one explicit code-signing certificate thumbprint.' }
$DiscussionSignArgs = @('sign','/fd','SHA256','/sha1',$CertificateThumbprint)
if ($TimestampUrl) {
    if ($TimestampUrl -notmatch '^https://') { throw 'Timestamp endpoint must be HTTPS.' }
    $DiscussionSignArgs += @('/tr',$TimestampUrl,'/td','SHA256')
}
# The key remains with the user's certificate provider; never export it, read a
# PFX, accept a password, create a self-signed root, or change trust/policy.
& $SignTool @DiscussionSignArgs $File *> $null
if ($LASTEXITCODE -ne 0) { throw 'Code signing failed; unsigned output is not a signed release.' }
$DiscussionSignature = Get-AuthenticodeSignature -LiteralPath $File
if ($DiscussionSignature.Status -ne 'Valid' -or $DiscussionSignature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) { throw 'Authenticode verification failed after signing.' }
Write-Output 'Authenticode signature verified.'

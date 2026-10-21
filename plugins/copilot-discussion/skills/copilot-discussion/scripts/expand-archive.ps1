param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$DiscussionTarget = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
if (Test-Path -LiteralPath $Destination) { throw 'Extraction destination must be new.' }
$DiscussionZip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    foreach ($DiscussionEntry in $DiscussionZip.Entries) {
        $DiscussionName = $DiscussionEntry.FullName.Replace('/', '\')
        $DiscussionFull = [IO.Path]::GetFullPath([IO.Path]::Combine($DiscussionTarget, $DiscussionName))
        if ([IO.Path]::IsPathRooted($DiscussionName) -or $DiscussionName.Contains(':') -or !$DiscussionFull.StartsWith($DiscussionTarget, [StringComparison]::OrdinalIgnoreCase) -or (($DiscussionEntry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
            throw 'Archive entry escapes its destination or is a symbolic link.'
        }
    }
} finally { $DiscussionZip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)

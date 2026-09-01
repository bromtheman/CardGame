<#
.SYNOPSIS
    Associates .customBattle files with From The Depths, so opening one launches
    straight into that battle.

.DESCRIPTION
    Writes to HKCU only — no admin rights, no effect on other users. The game's own
    command-line reader handles the rest: passed a .customBattle path it dispatches
    BootInstruction_LoadCustomBattleFileAndLaunch, which loads the file, starts the
    battle and unpauses.

    Players run this once. After that, a battle file downloaded from the site opens
    the game on double-click.

.EXAMPLE
    .\register-custombattle-association.ps1
    .\register-custombattle-association.ps1 -GamePath "D:\SteamLibrary\steamapps\common\From The Depths"
    .\register-custombattle-association.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$GamePath,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$progId = 'FromTheDepths.CustomBattle'
$extKey = 'HKCU:\Software\Classes\.customBattle'
$progKey = "HKCU:\Software\Classes\$progId"

if ($Remove) {
    foreach ($k in @($extKey, $progKey)) {
        if (Test-Path $k) { Remove-Item $k -Recurse -Force }
    }
    Write-Host "Association removed." -ForegroundColor Green
    return
}

function Find-GameExe {
    $roots = @()
    if ($GamePath) { $roots += $GamePath }

    $steamRoots = @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam")
    try {
        $reg = Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue
        if ($reg.SteamPath) { $steamRoots += $reg.SteamPath.Replace('/', '\') }
    } catch { }

    foreach ($steam in ($steamRoots | Where-Object { $_ -and (Test-Path $_) })) {
        $roots += (Join-Path $steam 'steamapps\common\From The Depths')
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            Select-String -Path $vdf -Pattern '"path"\s+"(.+?)"' -AllMatches |
                ForEach-Object { $_.Matches } |
                ForEach-Object {
                    $lib = $_.Groups[1].Value -replace '\\\\', '\'
                    $roots += (Join-Path $lib 'steamapps\common\From The Depths')
                }
        }
    }

    # The folder has spaces but the executable does not: it ships as
    # From_The_Depths.exe. Both spellings are probed, then any other exe in the
    # game root as a last resort, so a rename in a future build doesn't break this.
    $exeNames = @('From_The_Depths.exe', 'From The Depths.exe')

    foreach ($r in ($roots | Where-Object { $_ -and (Test-Path $_) })) {
        foreach ($n in $exeNames) {
            $exe = Join-Path $r $n
            if (Test-Path $exe) { return $exe }
        }
        $found = Get-ChildItem -Path $r -Filter *.exe -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'UnityCrashHandler64.exe' } |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

$exe = Find-GameExe
if (-not $exe) {
    $hint = ""
    if ($GamePath -and (Test-Path $GamePath)) {
        $names = (Get-ChildItem -Path $GamePath -Filter *.exe -File -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name) -join ", "
        $hint = if ($names) { "  Executables in that folder: $names" }
                else { "  No .exe found directly in that folder." }
    }
    throw ("Could not find the From The Depths executable. " +
           "Re-run with -GamePath '<folder containing the exe>'.$hint")
}

New-Item -Path $extKey -Force | Out-Null
Set-ItemProperty -Path $extKey -Name '(Default)' -Value $progId

New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $progKey -Name '(Default)' -Value 'From The Depths battle'
Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(Default)' -Value "`"$exe`" `"%1`""

Write-Host "Associated .customBattle with:" -ForegroundColor Green
Write-Host "  $exe"
Write-Host ""
Write-Host "Double-click a .customBattle file to launch straight into that battle."
Write-Host "Explorer may need a sign-out/in, or a restart of explorer.exe, to notice the new association."

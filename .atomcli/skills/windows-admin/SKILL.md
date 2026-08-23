---
name: windows-admin
description: Use when the target OS is Windows (Windows 10/11, Windows Server 2019-2025) for any system administration task - winget package management, PowerShell administration, service control via sc.exe/Get-Service, registry editing, event logs, Windows Defender and firewall management. Trigger on requests like "Windows'ta kur", "install on Windows", "check Windows service", "registry", "event log", "winget install".
trigger_words:
  [
    windows,
    windows 11,
    windows 10,
    windows server,
    powershell,
    cmd,
    winget,
    cmdlet,
    registry,
    regedit,
    reg add,
    event log,
    Get-Service,
    Get-Process,
    sc.exe,
    wmic,
    dism,
    sfc,
    choco,
    chocolatey,
    msix,
    msiexec,
    scheduled task,
    schtasks,
    UAC,
    defender,
    firewall rule,
    netsh,
    active directory,
    grup ilkesi,
    kayıt defteri,
    hizmet yönetimi,
    windows güncelleme,
    windows update,
    servis başlat,
    servis durdur,
    windows service,
  ]
---

# Windows System Administrator

## Purpose

Expert Windows system administration guidance for interactive use and autonomous coding agents working on
Windows machines: OS discovery, filesystem layout exploration, package management, services, processes,
registry, event logs, security hardening, and troubleshooting — using modern tooling current as of 2026
(PowerShell 7.x, WinGet with DSC v3 resources, Windows 11 24H2/25H2, Server 2025).

## When to Use This Skill

Load this skill whenever the host or the target machine is Windows and the task involves:

- Discovering what the machine is (`winver`, `Get-ComputerInfo`, edition/build/SKU)
- Exploring the filesystem (`C:\Users`, `C:\ProgramData`, `C:\Program Files`, `HKLM:\SOFTWARE`)
- Installing, updating, removing software (`winget`, `choco`, `msiexec`)
- Managing services (`Get-Service`, `sc.exe`), scheduled tasks (`Register-ScheduledTask`, `schtasks`)
- Processes, performance, event logs, network diagnostics
- Registry reads/writes, environment variables, PATH manipulation
- Defender / Firewall configuration, updates (USOClient, PSWindowsUpdate)

## How to Use This Skill

### Step 0 — Detect the Environment First

Never assume edition or shell. Establish ground truth before acting:

```powershell
# Edition + build + version (run first, always)
Get-ComputerInfo -Property OsName, OsVersion, OsBuildNumber, WindowsProductName, CsProcessors, CsTotalPhysicalMemory

# Quick build check (build numbers matter: 26100 = 24H2, 26200 = 25H2)
[System.Environment]::OSVersion.Version

# Is this PowerShell 7+ (pwsh) or legacy Windows PowerShell 5.1?
$PSVersionTable.PSVersion   # 5.x = legacy powershell.exe; 7.x = pwsh.exe

# Admin rights?
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

Adapt behavior to findings:

- **PowerShell 5.1 vs 7.x**: prefer `pwsh`; some cmdlets/modules are 7-only (`ForEach-Object -Parallel`,
  `Test-Connection` improvements). Scripts must state their minimum.
- **Admin vs non-elevated**: many operations need elevation. Detect first; if not elevated, tell the user
  which commands require an **elevated** terminal rather than failing mysteriously.

### Filesystem Exploration

Windows filesystem conventions differ fundamentally from Unix. Know the map before navigating:

| Path                                         | Purpose           | Notes                                                        |
| -------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `C:\Users\<user>`                            | User profile      | Desktop/Documents live here                                  |
| `C:\Users\<user>\AppData\Local`, `\Roaming`  | Per-user app data | Hidden by default; Roaming follows the profile in domains    |
| `C:\ProgramData`                             | Shared app data   | Hidden; machine-wide config                                  |
| `C:\Program Files`, `C:\Program Files (x86)` | Installed apps    | Write requires admin                                         |
| `C:\Windows\System32`                        | System binaries   | Do not modify; SIP-like protection via TrustedInstaller ACLs |
| `C:\Windows\Temp`                            | Machine temp      | Needs admin to clean others' files                           |

```powershell
# Explore safely (hidden/system items included only when asked)
Get-ChildItem -Force C:\Users\<user>\AppData\Local
Get-ChildItem -Recurse -Filter *.log C:\ProgramData -ErrorAction SilentlyContinue

# Find where a command resolves from (PATH diagnosis)
Get-Command node, python, git -ErrorAction SilentlyContinue | Format-Table Name, Source

# Disk usage by top-level folder
Get-ChildItem C:\ -Directory -Force -ErrorAction SilentlyContinue |
  ForEach-Object { [PSCustomObject]@{ Dir=$_.Name; GB=[math]::Round((Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB,2) } } | Sort-Object GB -Descending
```

Key differences from Unix that trip up agents:

- Path separator is `\` in native APIs but `/` works in most .NET/PowerShell contexts; always quote paths
  with spaces (`"C:\Program Files\..."`).
- Case-insensitive filesystem: `README.md` and `readme.md` collide.
- Drives are mounted as letters (`C:\`, `D:`), not under `/`.
- Line endings: text tooling may produce CRLF; be deliberate about LF vs CRLF when writing files.
- Long paths (>260 chars) need `\\?\` prefix or the LongPathsEnabled registry policy.

### Package Management (WinGet-first hierarchy)

Prefer in this order: **winget → choco (if already present) → direct installer download**.

```powershell
# Discovery
winget search <query>
winget show <package>            # details, installer type, hashes

# Install / upgrade / uninstall (add --silent for unattended runs; --disable-interactivity for CI)
winget install --id Git.Git -e --silent
winget upgrade                    # list available upgrades
winget upgrade --all --silent     # bulk update
winget uninstall --id <id> -e
winget list                       # everything installed incl. non-winget installs

# Reproducible machine setup: export/import a manifest
winget export -o packages.json
winget import -i packages.json --accept-package-agreements --accept-source-agreements
```

Notes:

- `--silent` suppresses installer UI; `-e` (--exact) prevents fuzzy matches installing the wrong package.
- Elevation: winget prompts UAC per-package unless already elevated; in scripts prefer running the whole
  session elevated.
- WinGet Configuration (`winget configure`) applies declarative YAML with DSC v3 resources — preferred for
  idempotent machine setup.
- If winget is missing (rare, e.g. Server without Store): bootstrap via
  `Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe` or use the
  `Microsoft.WinGet.Client` PowerShell module (`Repair-WinGetPackageManager`).

Chocolatey (only if already installed):

```powershell
choco search <pkg>; choco install <pkg> -y; choco upgrade all -y
```

MSI silent install pattern:

```powershell
msiexec /i package.msi /qn /norestart /l*v install.log
```

### Services

```powershell
# Query
Get-Service | Where-Object Status -eq 'Running'
Get-Service <name> | Select-Object -ExpandProperty ServicesDependedOn

# Control (needs admin)
Start-Service <name>; Stop-Service <name>; Restart-Service <name>
Set-Service <name> -StartupType Automatic   # Automatic | Manual | Disabled

# sc.exe remains the precise low-level tool (note: name quoting differs from PowerShell)
sc.exe query <name>
sc.exe config <name> start= delayed-auto    # space after 'start=' is REQUIRED
sc.exe sdshow <name>                         # SDDL security descriptor

# Dependency-safe restart of a service tree
Restart-Service <name> -Force
```

Common gotchas:

- `sc` in PowerShell is an alias for `Set-Content` — always use `sc.exe`.
- Stopping a service with dependents fails; use `-Force` deliberately after checking dependents.
- Service recovery options (restart on crash) are set via `sc.exe failure <name> reset= 86400 actions= restart/60000`.

### Scheduled Tasks

```powershell
# Modern API (preferred over schtasks.exe for scripting)
$action  = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument '-NoProfile -File C:\scripts\task.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'NightlyJob' -Action $action -Trigger $trigger -RunLevel Highest

Get-ScheduledTask | Where-Object State -eq 'Ready'
Start-ScheduledTask -TaskName 'NightlyJob'
Unregister-ScheduledTask -TaskName 'NightlyJob' -Confirm:$false

# Legacy CLI (fine for one-liners)
schtasks /create /tn NightlyJob /tr "pwsh -File C:\scripts\task.ps1" /sc daily /st 03:00 /rl highest
```

### Processes & Performance

```powershell
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
Get-Process -Id <pid> | Select-Object Name, Path, StartTime
Stop-Process -Id <pid> -Force              # kill

# Resource pressure
Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory
Get-PSDrive -PSProvider FileSystem         # disk free space

# Ports / connections (replaces netstat for scripting)
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select OwningProcess, State
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess   # who owns port 8080
```

### Registry

Treat HKLM writes as system-critical. Always read back to verify.

```powershell
# Read
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select ProductName, DisplayVersion
Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Services\<svc>' Start

# Write (admin for HKLM)
New-Item -Path 'HKLM:\SOFTWARE\MyApp' -Force
Set-ItemProperty -Path 'HKLM:\SOFTWARE\MyApp' -Name 'InstallDir' -Value 'C:\MyApp' -Type String

# Search values under a key
Get-ChildItem -Recurse 'HKLM:\SOFTWARE\MyApp' | Out-String
```

Environment variables persistently (user vs machine scope):

```powershell
[Environment]::SetEnvironmentVariable('MY_VAR', 'value', 'User')
[Environment]::SetEnvironmentVariable('MY_VAR', 'value', 'Machine')   # admin
# Append to PATH without clobbering:
$p = [Environment]::SetEnvironmentVariable('Path', $old + ';C:\tools\bin', 'Machine')
```

Note: GUI sessions pick up machine env changes only after re-login or Explorer restart; child shells inherit
from their parent at spawn time.

### Event Logs

```powershell
# Recent errors across main logs (fast triage)
Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 50

# Application crashes
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'} -MaxEvents 20

# A specific service's history
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'} -MaxEvents 100 |
  Where-Object Message -match '<service>'
```

Levels: 1=Critical, 2=Error, 3=Warning, 4=Informational. Start with Level 1–2, widen only if needed.

### Networking

```powershell
Get-NetIPConfiguration                     # adapters + IPs + DNS
Get-DnsClientServerAddress
Test-NetConnection <host> -Port 443        # TCP connectivity + latency
Resolve-DnsName <host>

# Firewall (admin)
Get-NetFirewallRule -Enabled True -Direction Inbound | Select DisplayName, Action
New-NetFirewallRule -DisplayName 'Allow 8080' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
Remove-NetFirewallRule -DisplayName 'Allow 8080'

# Network diagnostics classic tools still work: ipconfig /all, ping, tracert
ipconfig /flushdns
```

### Security Posture

```powershell
# Windows Defender
Get-MpComputerStatus                        # real-time protection, definitions age
Get-MpPreference | Select ExclusionPath, ExclusionProcess
Add-MpPreference -ExclusionPath 'C:\dev'    # dev folders often need exclusions for perf
Update-MpSignature                          # refresh definitions
Start-MpScan -ScanType QuickScan

# Updates (built-in USOClient is limited; PSWindowsUpdate module is the standard)
Install-Module PSWindowsUpdate -Force -Scope CurrentUser
Get-WindowsUpdate
Install-WindowsUpdate -AcceptAll -AutoReboot

# BitLocker status
Get-BitLockerVolume | Select-Object MountPoint, VolumeStatus, ProtectionStatus, EncryptionPercentage

# Local users/groups (modern replacement for net user)
Get-LocalUser | Where-Object Enabled
Get-LocalGroupMember Administrators
```

### Troubleshooting Playbook

1. **"Command not found"**: `Get-Command <name>`; check `$env:Path` split on `;`. New PATH entries require a new shell.
2. **"Access denied"**: check elevation state (Step 0); check file ACLs with `Get-Acl <path>`; check
   TrustedInstaller-owned paths (do not fight them).
3. **Port conflict**: `Get-NetTCPConnection -LocalPort <port>` → owning PID → `Get-Process -Id <pid>`.
4. **Service won't start**: `Get-EventLog`/`Get-WinEvent` SCM provider entries; check dependencies
   (`ServicesDependedOn`); check the service account's permissions.
5. **Disk full**: WinSxS cleanup via `Dism /Online /Cleanup-Image /AnalyzeComponentStore` then
   `/StartComponentCleanup`; temp dirs `%TEMP%`, `C:\Windows\Temp`; `cleanmgr` for GUI.
6. **Corrupt system files**: `sfc /scannow`, then `DISM /Online /Cleanup-Image /RestoreHealth`.
7. **Slow boot**: `Get-CimInstance Win32_StartupCommand`; services set to Automatic (delayed vs not);
   Event Log Diagnostics-Performance.

### Safety Rules

- **Always detect elevation before privileged operations**; report instead of failing mid-way.
- Registry HKLM/HKU writes: read back after write; prefer creating app-specific keys, never edit
  `CurrentControlSet` entries you don't understand.
- `Remove-Item -Recurse -Force` on user profiles or Program Files is destructive — confirm scope explicitly
  before running against anything beyond temp/cache directories.
- Prefer `-WhatIf` (works on most mutating cmdlets) for dry-runs.
- Never disable Defender real-time protection as a "fix"; use scoped exclusions only when justified.
- Quote every path with spaces; prefer `Join-Path` over string concatenation.
- After changing services/startup config, verify with a query command, don't assume success from exit code alone.

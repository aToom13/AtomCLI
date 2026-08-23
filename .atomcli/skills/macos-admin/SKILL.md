---
name: macos-admin
description: Use when the target OS is macOS (Apple Silicon or Intel, macOS 14 Sonoma through 26 Tahoe) for any system administration task - Homebrew package management, launchd services and LaunchAgents, filesystem exploration (/Library, ~/Library, /Applications), defaults preferences, diskutil, networksetup, FileVault/SIP/Gatekeeper security, and troubleshooting Mac-specific issues. Trigger on "macOS", "brew install", "launchctl", "Mac'te kur", "plist".
trigger_words: [macos, mac os x, osx, macbook, imac, mac mini, mac studio, darwin, homebrew, brew install, brew cask, launchd, launchctl, plist, launchagent, launchdaemon, defaults write, diskutil, apfs, filevault, sip, gatekeeper, spctl, xattr, codesign, softwareupdate, mac yönetimi, mac kurulum]
---

# macOS System Administrator

## Purpose

Expert macOS administration for interactive use and autonomous agents working on Macs: OS discovery,
filesystem layout exploration, Homebrew package management, launchd services, `defaults` preference system,
storage (APFS/diskutil), networking (`networksetup`), security stack (SIP/FileVault/Gatekeeper), and
troubleshooting — current as of macOS 26 Tahoe era (Apple Silicon-first, Intel deprecated).

## When to Use This Skill

Load this skill whenever the host or target machine is macOS and the task involves:
- Identifying macOS version, chip architecture, boot mode
- Exploring the macOS filesystem (`/Applications`, `/Library`, `~/Library`, `/opt/homebrew`)
- Installing/updating software via Homebrew (formulae vs casks) or Mas (App Store)
- Managing background jobs via launchd/LaunchAgents/LaunchDaemons
- Reading/writing user preferences via `defaults`
- Disks/volumes/images via `diskutil`, memory/processes, network locations
- Security posture: SIP, FileVault, Gatekeeper, TCC privacy permissions

## How to Use This Skill

### Step 0 — Detect Version and Architecture First

```bash
# macOS version + build (26.x = Tahoe era, 15.x = Sequoia, 14.x = Sonoma)
sw_vers

# Chip architecture decides EVERYTHING about paths and compatibility
uname -m        # arm64 = Apple Silicon; x86_64 = Intel (legacy, being phased out)
sysctl -n machdep.cpu.brand_string

# Am I root / can I sudo?
id -u; sudo -n true 2>/dev/null && echo "passwordless sudo" || echo "sudo needs password"

# Hardware overview (model year matters for OS support)
system_profiler SPHardwareDataType | grep -E "Model|Chip|Memory|Serial"
```

Architecture consequences:
- **Apple Silicon (arm64)**: Homebrew lives at `/opt/homebrew`; Rosetta 2 optional for x86 binaries.
- **Intel (x86_64)**: Homebrew at `/usr/local`; no longer receives new macOS versions — flag as legacy.

### Filesystem Exploration

macOS looks Unix-like but has critical Apple-specific layers:

| Path | Contents |
|---|---|
| `/Applications`, `~/Applications` | Installed apps (.app bundles) |
| `/Library`, `~/Library` | System-wide / per-user app support, preferences, caches |
| `~/Library/Preferences` | Per-user plist preferences (`defaults` domain files) |
| `~/Library/Application Support` | App data (the real "appdata") |
| `~/Library/Caches`, `/Library/Caches` | Caches — safe to clean when apps closed |
| `~/Library/LaunchAgents` | User login agents |
| `/Library/LaunchDaemons` | Root daemons (start at boot) |
| `/Library/LaunchAgents` | Agents for all users at login |
| `/opt/homebrew` | Homebrew on Apple Silicon |
| `/usr/local` | Homebrew on Intel + local software |
| `/System`, `/usr` (except `/usr/local`) | Sealed system volume (SSV) — READ-ONLY, SIP protected |

Key differences from Linux:
- **`/System` is on a sealed, read-only snapshot** — nothing installs there, ever; don't try.
- User-level config lives in **plists**, not dotfiles in `/etc`.
- `~/Library` is hidden in Finder but central to troubleshooting (logs in `~/Library/Logs`).
- Apps are self-contained `.app` bundles; "installation" is often just copying to `/Applications`.

```bash
# Explore app support data safely
ls ~/Library/"Application Support"
du -sh ~/Library/Caches/* 2>/dev/null | sort -rh | head    # cache hogs
log show --predicate 'process == "mysqld"' --last 1h       # unified log instead of /var/log

# What is this .app's bundle ID (needed for defaults)?
osascript -e 'id of app "Visual Studio Code"'
mdls -name kMDItemCFBundleIdentifier /Applications/Safari.app
```

### Package Management (Homebrew)

Homebrew is the de-facto standard. Formula = CLI/library; Cask = GUI app.

```bash
# Install Homebrew if absent (installs Xcode CLT too)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# On Apple Silicon, afterwards add to shell profile:
eval "$(/opt/homebrew/bin/brew shellenv)"

brew update                     # refresh formulae metadata (do this first)
brew search <query>
brew info <formula>             # version, deps, caveats — ALWAYS read caveats
brew install <formula>          # CLI tool / library
brew install --cask <app>       # GUI application
brew list; brew list --cask     # what's installed
brew outdated                   # what can be upgraded
brew upgrade                    # upgrade all (or specific formula)
brew uninstall <pkg>
brew cleanup -s                 # remove old versions + cache (reclaim disk)
brew doctor                     # diagnose broken installs

# Declarative setup (Brewfile) — reproducible machine provisioning
brew bundle dump --file=~/Brewfile          # export current state
brew bundle --file=~/Brewfile               # install everything listed
```

Other channels:
```bash
brew install --mas <app-id>                 # NOT a thing — use mas CLI:
mas search <name> && mas install <id>       # Mac App Store apps
softwareupdate -l                           # macOS system updates (separate from brew!)
sudo softwareupdate -ia                     # install ALL pending OS updates
softwareupdate --fetch-full-installer --full-installer-version 26.1   # full installer download
```

Critical distinction: **`brew` does not update macOS itself or Apple apps** — run `softwareupdate`
separately as part of any "update the machine" task.

### Services & Background Jobs (launchd)

launchd replaces cron/systemd. Modern syntax (Tahoe era) uses domain-targeted bootstrap:

```bash
# List services
launchctl list | head                       # PID, last exit code, label
launchctl print gui/$(id -u)/com.example.myagent   # deep inspection of one agent

# Modern lifecycle (preferred):
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.agent.plist   # load+start
launchctl bootout gui/$(id -u)/com.example.agent                                   # unload
launchctl kickstart gui/$(id -u)/com.example.agent                                  # restart now

# Legacy syntax (still works, prints deprecation warnings):
launchctl load ~/Library/LaunchAgents/com.example.agent.plist
launchctl unload ~/Library/LaunchAgents/com.example.agent.plist

# System daemons need sudo and the system domain:
sudo launchctl bootstrap system /Library/LaunchDaemons/com.example.daemon.plist
```

Minimal plist template (`~/Library/LaunchAgents/com.example.backup.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.backup</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string><string>-lc</string><string>/Users/me/scripts/backup.sh</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer></dict>
  <key>StandardOutPath</key><string>/tmp/backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/backup.err</string>
</dict></plist>
```

Validate plists before loading: `plutil -lint <file>`.

Cron exists but is Apple-deprecated — use launchd for anything new. KeepTime-based alternatives:
`StartInterval` (every N seconds) or `WatchPaths` (run on file change).

### Preferences (defaults)

Every app's settings are plists addressed by reverse-DNS bundle ID:

```bash
defaults read com.apple.finder               # dump one domain
defaults read -g                             # global domain
defaults read com.apple.dock tilesize

# Write + apply pattern (many prefs need an app restart to take effect)
defaults write com.apple.dock autohide -bool true && killall Dock
defaults write com.apple.finder ShowHiddenFiles -bool true && killall Finder
defaults delete com.apple.something obsoleteKey

# Where did this setting come from? Managed profiles (MDM) override defaults:
profiles list                                # installed configuration profiles
```

Warning: `defaults write` on unknown keys fails silently — always read the domain first to confirm the key
exists and its type (`-bool`, `-string`, `-int`, `-array`).

### Storage (APFS & diskutil)

```bash
df -h                                        # quick capacity check
diskutil list                                # THE disk map: physical store → container → volumes
diskutil info /                              # details of root volume

# APFS model: volumes SHARE a container's free space — "full" one volume can mean container pressure
diskutil apfs list

# Mount/unmount (external disks, images)
diskutil mountDisk /dev/disk2; diskutil unmount /Volumes/USB

# Erase (DESTRUCTIVE — confirm target twice)
diskutil eraseDisk APFS MyDisk /dev/disk2

# Disk images
hdiutil create -size 5g -fs APFS -volname Work work.dmg
hdiutil attach work.dmg; hdiutil detach /Volumes/Work

# Memory pressure & swap
memory_pressure -Q | head; sysctl vm.swapusage
```

### Networking

```bash
networksetup -listallnetworkservices         # named services (Wi-Fi, Ethernet...)
networksetup -getinfo "Wi-Fi"                # IP/mask/router/DHCP state
ifconfig en0 | grep "inet "                  # active IP
scutil --dns | head                          # effective DNS
netstat -rn | head                           # routing table

# DNS per service (GUI-equivalent)
sudo networksetup -setdnsservers "Wi-Fi" 1.1.1.1 8.8.8.8
sudo networksetup -setdnsservers "Wi-Fi" "Empty"      # reset to DHCP

# Connectivity triage
ping -c3 1.1.1.1; dig +short example.com; curl -sI https://example.com | head -1

# Listening ports / who owns them
lsof -iTCP -sTCP:LISTEN -n -P
lsof -iTCP:8080 -sTCP:LISTEN                 # specific port

# Wi-Fi diagnostics
system_profiler SPAirPortDataType | grep -E "Current Network|Signal"
sudo wdutil info 2>/dev/null || networksetup -getairportnetwork en0
```

### Security Stack

```bash
# SIP (System Integrity Protection) — must stay enabled unless you KNOW why not
csrutil status                               # "enabled" expected; changes require Recovery mode

# FileVault disk encryption
fdesetup status

# Gatekeeper: who can run downloaded apps
spctl --status
spctl --assess --verbose /Applications/SomeApp.app

# Quarantine attribute (why "app can't be opened")
xattr -l /Applications/SomeApp.app
xattr -d com.apple.quarantine /Applications/SomeApp.app    # remove AFTER trusting source

# Code signature verification
codesign -dv --verbose=2 /Applications/SomeApp.app 2>&1 | grep -E "Authority|TeamIdentifier"
codesign --verify --deep --strict /Applications/SomeApp.app

# TCC privacy permissions (camera, mic, disk access...) live in a SIP-protected DB;
# manage via System Settings > Privacy & Security — CLI reads need Full Disk Access:
sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" 'SELECT client,service FROM access LIMIT 5;'

# Firewall (socketfilterfw, not iptables)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/MyApp.app
```

Hardening essentials (align with CIS/NIST macOS 26 benchmarks): keep SIP on, enable FileVault, require admin
password for system-wide settings, keep Gatekeeper on, review Login Items & LaunchAgents periodically.

### Troubleshooting Playbook

1. **"App can't be opened / damaged"**: quarantine attr → `xattr -dr com.apple.quarantine <app>` after
   verifying source; then `codesign --verify`.
2. **Login item / agent not running**: `plutil -lint <plist>` → `launchctl print gui/$(id -u)/<label>` →
   check exit code in `launchctl list` output.
3. **Slow machine**: Activity Monitor equivalents — `top -o cpu`, `ps aux | sort -rk3 | head`;
   `sysctl vm.swapusage` (high swap = memory pressure); check `~/Library/Caches` sizes.
4. **Disk almost full**: `du -sh ~/Library/Caches/* | sort -rh`; Xcode DerivedData
   (`~/Library/Developer/Xcode/DerivedData`); `brew cleanup -s`; TimeMachine local snapshots
   (`tmutil listlocalsnapshots /`, thin with `tmutil deletelocalsnapshots <date>`).
5. **Network flaky**: renew DHCP `sudo ipconfig set en0 DHCP`; flush DNS `sudo dscacheutil -flushcache;
   sudo killall -HUP mDNSResponder`; create fresh network location as reset.
6. **Weird system behavior**: unified log first — `log show --last 30m --predicate 'eventMessage CONTAINS "error"'`
   (it replaced /var/log/system.log); kernel panics/reboots: `log show --last_boot` style queries or
   `ls -lt /Library/Logs/DiagnosticReports | head`.
7. **Password prompt loops / permission weirdness**: check Secure Token status for the user:
   `sysadminctl -secureTokenStatus $(id -un)` — needed for FileVault-enabled accounts.

### Safety Rules

- Never write under `/System`, `/usr` (except `/usr/local`), `/bin`, `/sbin` — sealed volume rejects it and
  SIP blocks workarounds. Local software belongs in `/usr/local` or `/opt/homebrew`.
- `sudo rm -rf` on Library folders can destroy irreplaceable app data — enumerate contents before deleting;
  prefer caches over Application Support.
- After changing LaunchAgent/Daemon plists, `plutil -lint` then bootout→bootstrap cycle; check
  `launchctl list` for non-zero exit codes.
- `defaults write` without reading existing domain first risks clobbering typed values; read → modify → write.
- `csrutil disable` and lowering Gatekeeper (`spctl --master-disable`) only with explicit user consent and a
  documented reason — re-enable afterward.
- Before OS updates on managed machines, check `profiles list` for MDM restrictions.
- Killall on UI processes (Dock/Finder/SystemUIServer) is safe; never `killall loginwindow` while apps have
  unsaved work.

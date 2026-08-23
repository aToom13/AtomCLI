---
name: linux-admin
description: Use when the target OS is Linux for any system administration task - distribution detection, package management (apt/dnf/pacman/zypper), systemd service management, filesystem exploration (/etc, /var, /proc), journald logs, users and permissions, networking with ip/nftables, containers, and modern 2026 practices (run0, immutable distros, sysext). Trigger on "Linux sunucu", "systemctl restart", "journalctl", "apt install", disk full, service management.
trigger_words: [linux, ubuntu, debian, fedora, rhel, centos, rocky, almalinux, arch, opensuse, suse, alpine, nixos, systemd, systemctl, journalctl, apt-get, dnf, pacman, zypper, apk add, snap, flatpak, cgroup, fstab, mount, lsblk, cron, crontab, sshd, fail2ban, ufw, firewalld, nftables, lvm, selinux, apparmor, sunucu, servis yönetimi, disk doldu, log incele]
---

# Linux System Administrator

## Purpose

Expert Linux system administration for interactive use and autonomous agents: OS/distribution discovery,
filesystem exploration, package management across all major families, systemd services, logging, storage,
networking, security hardening, containers — current as of 2026 (systemd v257–261 era, including breaking
changes: cgroup v1 removal, SysV init removal, persistent journald default, run0 availability).

## When to Use This Skill

Load this skill whenever the host or target machine is Linux and the task involves:
- Identifying the distribution and init system
- Exploring the filesystem (`/etc`, `/var`, `/proc`, `/sys`) and understanding FHS layout
- Installing/updating packages on any major distribution family
- Managing services and timers via systemd; reading logs via journald
- Users/groups, file permissions, sudo policy
- Disks/LVM/mounts, network interfaces/firewall, performance triage
- Containers (Podman/Docker), SELinux/AppArmor basics

## How to Use This Skill

### Step 0 — Detect the Distribution First

Never assume apt vs dnf vs pacman. Establish ground truth:

```bash
# Canonical distribution identification (always works)
cat /etc/os-release

# Init system + version (systemd features vary hugely by version)
systemctl --version | head -1

# Kernel + architecture
uname -r && uname -m

# Privilege check: am I root / can I sudo?
id -u    # 0 = root
sudo -n true 2>/dev/null && echo "passwordless sudo" || echo "sudo needs password or unavailable"

# Container? (many commands behave differently)
cat /proc/1/cgroup | head -3; [ -f /.dockerenv ] && echo "docker container"
```

Adapt to the family:

| Family | Distros | Package manager | Firewall default |
|---|---|---|---|
| Debian | Ubuntu, Debian, Mint, Pop!_OS | `apt` (+ `dpkg`) | `ufw` |
| RHEL | Fedora, RHEL, Rocky, Alma | `dnf` (+ `rpm`) | `firewalld` |
| Arch | Arch, Manjaro, CachyOS | `pacman` (+ AUR helpers) | usually none preconfigured |
| SUSE | openSUSE Leap/Tumbleweed, SLES | `zypper` (+ `rpm`) | `firewalld` |
| Alpine | Alpine | `apk` | none |
| Immutable | Fedora Silverblue/Bazzite, openSUSE Aeon | `rpm-ostree`/`transactional-update`, Flatpak-first | varies |
| Declarative | NixOS | `nix` via configuration.nix | declarative |

Immutable distro caveat: `/usr` is read-only. Do not try to `dnf install` into the base image casually —
layer with `rpm-ostree install` (requires reboot) or prefer Flatpak/containers/toolbox.

Modern privilege escalation note (2026): newer systemd (v257+) ships **run0** as a SUID-free sudo alternative
(Fedora 43+, expected in Ubuntu 26.04+). It coexists with sudo. Default to `sudo`; if only run0 exists,
`run0 <command>` replaces `sudo <command>` and there is no sudoers file — authorization is polkit-based.
Do not migrate scripts to run0 unless the target is verified to ship it.

### Filesystem Exploration (FHS)

Know where things live before searching blindly:

| Path | Contents |
|---|---|
| `/etc` | System-wide config (text files) — edit here, never in `/usr` |
| `/etc/fstab`, `/etc/crypttab` | Mounts, encryption |
| `/var/log` | Logs (journald also at `/var/log/journal` on modern systems) |
| `/var/lib` | Persistent service state (databases, package dbs) |
| `/var/cache` | Regenerable caches — safe-ish to clean |
| `/tmp` | Ephemeral; often tmpfs (RAM), cleared on reboot |
| `/usr`, `/bin` (→ `/usr/bin`) | Distro-managed binaries — do not hand-edit |
| `/usr/local` | Locally installed software (your responsibility zone) |
| `/opt` | Third-party self-contained apps |
| `/home/<user>`, `/root` | User homes |
| `/proc`, `/sys` | Kernel pseudo-filesystems (process info, hardware state) |

```bash
# What's eating disk? (fast top-down)
df -h                                   # filesystem-level usage first
du -xh --max-depth=2 /var 2>/dev/null | sort -rh | head -20
du -sh /* 2>/dev/null                   # root-level breakdown (-x stays on one fs)

# Find large files (>100MB)
find / -xdev -type f -size +100M -exec ls -lh {} \+ 2>/dev/null

# Which config defines a service's behavior?
systemctl cat <service>.service          # shows the unit + drop-ins

# Recent config changes (if etckeeper or rpm/dpkg verify available)
cd /etc && find . -newermt '7 days ago' -type f
```

### Package Management

```bash
# --- Debian/Ubuntu ---
sudo apt update && apt list --upgradable
sudo apt install -y <pkg>
sudo apt remove --purge <pkg> && sudo apt autoremove
apt search <query>; apt show <pkg>; dpkg -L <pkg>   # which files did it install?

# --- Fedora/RHEL family ---
sudo dnf upgrade -y                       # 'update' is an alias
sudo dnf install <pkg>
dnf search <query>; dnf info <pkg>; rpm -ql <pkg>
dnf history                                # transactional undo possible: dnf history undo <id>

# --- Arch ---
sudo pacman -Syu                           # NEVER -Sy without -u (partial upgrades break)
sudo pacman -S <pkg>; pacman -Rns <pkg>    # -Rns removes deps + configs
pacman -Ql <pkg>; pacman -Qs <query>

# --- openSUSE ---
sudo zypper dup                            # Tumbleweed; Leap: zypper up
sudo zypper in <pkg>

# --- Alpine ---
apk update && apk add <pkg>

# --- Universal formats ---
flatpak install flathub <app.id>           # desktop apps on immutable systems
snap list; sudo snap refresh               # Ubuntu-specific
```

Automatic security updates:
```bash
# Debian/Ubuntu
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
# RHEL family
sudo dnf install -y dnf-automatic && sudo systemctl enable --now dnf-automatic.timer
```

### Service Management (systemd)

```bash
systemctl status <unit>                     # state + recent log lines
sudo systemctl start|stop|restart <unit>
sudo systemctl enable --now <unit>          # boot-persist AND start immediately (preferred combined form)
systemctl list-units --state=failed         # failed units after a bad boot
systemctl list-timers                        # what cron-like jobs exist
systemd-analyze blame | head                 # what slowed boot
systemctl cat <unit>                         # view effective unit incl. drop-ins

# Override a unit WITHOUT editing vendor files (survives package updates):
sudo systemctl edit <unit>                   # opens drop-in editor; e.g. add:
#   [Service]
#   MemoryMax=512M

# Reload unit definitions after editing files manually:
sudo systemctl daemon-reload
```

Timers replace most cron uses on modern systems:
```bash
systemctl list-timers --all
systemctl status <timer>.timer; journalctl -u <service>.service
```

Cron still exists and is fine for user jobs:
```bash
crontab -e                    # current user; sudo crontab -e for root
# m h dom mon dow  command
# */15 * * * * /usr/local/bin/check.sh
```

### Logging (journald)

On systemd ≥259 the journal persists to disk by default (`Storage=persistent`). Watch disk on chatty hosts.

```bash
journalctl -xe                              # latest entries + explanatory context (start here)
journalctl -u <unit> -f                     # follow one unit
journalctl -p err --since today             # errors since midnight
journalctl --since "-2h" --until "-1h"
journalctl -k -b -1                         # kernel log of PREVIOUS boot
journalctl --disk-usage                     # how much space logs use
sudo journalctl --vacuum-size=500M          # cap it when huge
```

Classic logs that still matter: `/var/log/auth.log` or `/var/log/secure` (SSH/auth), `/var/log/syslog`
or `/var/log/messages` (non-journald daemons).

### Users, Permissions, Sudo

```bash
sudo useradd -m -s /bin/bash alice       # -m creates home
sudo passwd alice
sudo usermod -aG sudo,docker alice        # -aG APPENDS to groups; omitting -a destroys groups!
getent group sudo                          # verify membership (works on all distros; wheel on RHEL/Arch)
sudo deluser --remove-home alice           # Debian; RHEL: userdel -r

# File permissions
ls -la; stat <file>
chmod 600 ~/.ssh/authorized_keys           # SSH refuses wrong perms silently
sudo chown -R www-data:www-data /srv/app   # match service user

# Sudo policy (ALWAYS use visudo / visudo.d, never raw-edit)
sudo visudo -f /etc/sudoers.d/alice        # drop-in style; validate before save
```

**Critical rule:** `usermod -G group user` (without `-a`) REPLACES all supplementary groups. Always `-aG`.

### Storage

```bash
lsblk -f                                    # disks, partitions, filesystems, UUIDs
findmnt                                     # active mounts tree
sudo blkid                                  # UUIDs for fstab
free -h; swapon --show                      # memory & swap

# Add a disk permanently: partition → format → fstab by UUID → mount
sudo fdisk /dev/sdb                         # or parted
sudo mkfs.ext4 /dev/sdb1
sudo blkid /dev/sdb1                        # grab UUID
echo 'UUID=<uuid> /data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mkdir -p /data && sudo mount -a        # validates fstab BEFORE reboot; nofail prevents boot hangs

# LVM quick reference
sudo vgdisplay; sudo lvdisplay
sudo lvextend -r -L +10G /dev/vg0/lv0       # -r grows the filesystem too
```

**fstab safety:** always test with `sudo mount -a` (or `findmnt --verify`) before rebooting. A broken fstab is
the #1 cause of unbootable servers. Use `nofail` for non-critical mounts.

### Networking

```bash
ip -br addr                                 # concise interface overview
ip route; ss -tulpn                         # routes + listening sockets (replaces netstat)
resolvectl status | head                    # DNS (systemd-resolved)

# Connectivity triage order:
ping -c3 1.1.1.1                            # L3 reachable?
ping -c3 google.com                         # DNS resolves?
curl -sI https://example.com | head -1      # HTTP works?

# Firewall — detect which one is active first:
sudo ufw status verbose                     # Debian/Ubuntu family
sudo firewall-cmd --state && sudo firewall-cmd --list-all   # RHEL/SUSE family
sudo nft list ruleset                       # raw nftables (also what systemd-networkd now requires)

# Allow a port (pick per detected firewall)
sudo ufw allow 8080/tcp
sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload
```

2026 note: iptables NAT support has been dropped from systemd-networkd/nspawn (v259+) — new rules should be
written directly in nftables syntax.

### Security Hardening Essentials

```bash
# SSH baseline (/etc/ssh/sshd_config or drop-in /etc/ssh/sshd_config.d/*.conf)
#   PermitRootLogin no
#   PasswordAuthentication no            # ONLY after confirming key login works!
#   PubkeyAuthentication yes
sudo sshd -t                                 # VALIDATE CONFIG BEFORE RESTART (prevents lockout)
sudo systemctl restart sshd                  # keep your session open until a second login succeeds

# fail2ban against brute force (Debian example)
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd

# Automatic updates (see Package Management section)

# MAC systems — check mode before assuming why something fails:
getenforce                                   # SELinux: Enforcing/Permissive/Disabled (RHEL family)
aa-status 2>/dev/null | head -5              # AppArmor (Ubuntu/SUSE)
# Wrong-label file fix: restorecon -Rv /path  — NOT blanket setenforce 0
```

**Lockout prevention:** when touching SSH config, always keep the existing session connected and verify a NEW
connection succeeds before closing it.

### Containers & Services Quick Reference

```bash
podman ps -a; podman logs -f <ctr>; podman exec -it <ctr> bash     # rootless preferred
docker ps -a; docker compose logs -f
systemctl --user status                                        # user services (lingering: loginctl enable-linger)
```

### Troubleshooting Playbook

1. **Service won't start**: `systemctl status <unit>` → `journalctl -u <unit> -n 50 --no-pager` →
   check unit deps (`systemctl list-dependencies <unit>`).
2. **Disk full**: `df -h` → `du -xh --max-depth=1 /var | sort -rh` → usual suspects:
   `journalctl --disk-usage`, old logs in `/var/log`, docker/podman images (`<runtime> system prune`),
   package caches (`apt clean`, `dnf clean all`).
3. **Boot hangs**: read previous boot: `journalctl -b -1 -p err`; fstab suspect → boot with
   `systemd.unit=emergency.target`; `systemd-analyze blame`.
4. **No network**: triage order above (ping IP → ping name → curl); check `ip link` (interface down?),
   NetworkManager vs networkd (`nmcli device status` / `networkctl status`).
5. **Permission denied on service**: check `User=` in unit, SELinux label (`restorecon`), home dir perms.
6. **High load but low CPU**: `iostat -x 1` / `vmstat 1` — likely IO wait; find culprit:
   `iotop -o` or `pidstat -d 1`.

### Safety Rules

- Never run `rm -rf` with a variable path without checking it's non-empty; never `rm -rf /` patterns even as jokes.
- Prefer `systemctl edit` drop-ins over editing vendor unit files (updates overwrite them).
- Validate SSH/sshd and fstab changes before they take effect (`sshd -t`, `mount -a`, `findmnt --verify`).
- Keep an active session open while testing remote-access changes.
- `pacman -Sy <pkg>` alone corrupts dependency resolution — always full `-Syu`.
- On immutable distros don't fight the read-only root; use the sanctioned layering mechanism or containers.
- Before destructive ops on production: snapshot/backup (`lvcreate -s`, btrfs subvolume snapshot, VM snapshot),
  and state the rollback command before executing the change.

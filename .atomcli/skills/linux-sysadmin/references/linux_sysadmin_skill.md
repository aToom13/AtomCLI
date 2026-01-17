---
name: linux-sysadmin
description: This skill should be used when users need Linux system administration tasks including package management, service control, network configuration, security hardening, monitoring, and general server management. Use when users request installing/updating software, configuring services, managing users/permissions, firewall rules, or system maintenance tasks.
---

# Linux System Administrator

## Purpose

Transform Claude into a professional Linux system administrator capable of handling comprehensive server management tasks. Provide expert guidance on package management, service configuration, network setup, security hardening, monitoring, and troubleshooting across different Linux distributions with primary focus on Ubuntu/Debian systems.

## When to Use This Skill

Use this skill when users request:
- Package installation, updates, or removal (apt, dnf, pacman, zypper)
- Service management (systemd, init scripts)
- Network configuration (interfaces, firewall, DNS, routing)
- User and permission management
- Security configuration (SSH, firewall, SELinux/AppArmor)
- System monitoring and log analysis
- Performance tuning and resource management
- Backup and recovery operations
- Cron jobs and scheduled tasks
- Any Linux server administration task expressed in natural language

## How to Use This Skill

### Distribution Detection

Always detect the Linux distribution first to provide appropriate commands:

```bash
# Detect distribution
cat /etc/os-release
# or
lsb_release -a
```

Adapt commands based on detected distribution:
- **Ubuntu/Debian**: Use `apt`, `ufw`, `systemctl`
- **RHEL/CentOS/Fedora**: Use `dnf`/`yum`, `firewalld`, `systemctl`
- **Arch**: Use `pacman`, `systemctl`
- **openSUSE**: Use `zypper`, `firewalld`, `systemctl`

### Command Generation Workflow

1. **Understand the request** in natural language
2. **Detect distribution** (if not already known)
3. **Generate complete, safe commands** with explanations
4. **Include sudo** where necessary
5. **Provide verification steps** to confirm success
6. **Add rollback commands** for risky operations

### Package Management

**Installation:**
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y <package>

# RHEL/Fedora
sudo dnf install -y <package>

# Arch
sudo pacman -S <package>
```

**Updates:**
```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# RHEL/Fedora
sudo dnf upgrade -y

# Arch
sudo pacman -Syu
```

**Removal:**
```bash
# Ubuntu/Debian
sudo apt remove --purge <package>
sudo apt autoremove

# RHEL/Fedora
sudo dnf remove <package>
sudo dnf autoremove
```

**Search:**
```bash
# Ubuntu/Debian
apt search <keyword>

# RHEL/Fedora
dnf search <keyword>
```

### Service Management

**Control services:**
```bash
sudo systemctl start <service>
sudo systemctl stop <service>
sudo systemctl restart <service>
sudo systemctl status <service>
sudo systemctl enable <service>  # Start on boot
sudo systemctl disable <service>
```

**Check logs:**
```bash
sudo journalctl -u <service>
sudo journalctl -u <service> -f  # Follow mode
sudo journalctl -u <service> --since "1 hour ago"
```

**Create custom systemd service:**
Refer to `references/systemd-service-template.md` for complete service file templates.

### Network Configuration

**Interface management:**
```bash
# View interfaces
ip addr show
ip link show

# Configure static IP (netplan for Ubuntu)
# Edit /etc/netplan/*.yaml
sudo netplan apply
```

**Firewall (UFW - Ubuntu/Debian):**
```bash
sudo ufw status
sudo ufw enable
sudo ufw allow <port>/tcp
sudo ufw allow from <ip> to any port <port>
sudo ufw delete allow <port>/tcp
sudo ufw reload
```

**Firewall (firewalld - RHEL/Fedora):**
```bash
sudo firewall-cmd --state
sudo firewall-cmd --permanent --add-port=<port>/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

**DNS configuration:**
```bash
# systemd-resolved (modern systems)
sudo nano /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved

# Traditional
sudo nano /etc/resolv.conf
```

### User and Permission Management

**User operations:**
```bash
sudo useradd -m -s /bin/bash <username>
sudo passwd <username>
sudo usermod -aG sudo <username>  # Add to sudo group
sudo userdel -r <username>  # Delete with home directory
```

**File permissions:**
```bash
sudo chmod <permissions> <file>
sudo chown <user>:<group> <file>
sudo chown -R <user>:<group> <directory>
```

**SSH key setup:**
```bash
# Generate key
ssh-keygen -t ed25519 -C "comment"

# Copy to remote
ssh-copy-id user@host

# Set permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### Security Hardening

**SSH configuration:**
```bash
sudo nano /etc/ssh/sshd_config
# Key changes:
# PermitRootLogin no
# PasswordAuthentication no
# Port 2222 (change default)
sudo systemctl restart sshd
```

**Automatic updates:**
```bash
# Ubuntu/Debian
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# RHEL/Fedora
sudo dnf install dnf-automatic
sudo systemctl enable --now dnf-automatic.timer
```

**Fail2ban setup:**
```bash
sudo apt install fail2ban
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo systemctl enable --now fail2ban
```

### System Monitoring

**Resource usage:**
```bash
# CPU and memory
htop
top
free -h
vmstat 1

# Disk usage
df -h
du -sh /path/*
ncdu /path  # Interactive

# Processes
ps aux | grep <process>
pgrep -a <process>
```

**Log analysis:**
```bash
# System logs
sudo journalctl -xe
sudo journalctl --since today
sudo journalctl -p err

# Application logs
sudo tail -f /var/log/<logfile>
sudo grep ERROR /var/log/<logfile>
```

### Disk and Storage

**Partition management:**
```bash
# List disks
lsblk
sudo fdisk -l

# Format partition
sudo mkfs.ext4 /dev/sdX1

# Mount
sudo mount /dev/sdX1 /mnt/mountpoint
# Permanent mount - edit /etc/fstab
```

**LVM operations:**
Refer to `references/lvm-guide.md` for detailed LVM management.

### Backup and Recovery

**Backup with rsync:**
```bash
# Local backup
sudo rsync -avz --progress /source/ /backup/

# Remote backup
sudo rsync -avz -e ssh /source/ user@remote:/backup/
```

**Database backups:**
```bash
# MySQL/MariaDB
mysqldump -u root -p database_name > backup.sql

# PostgreSQL
sudo -u postgres pg_dump database_name > backup.sql
```

### Cron Jobs

**Edit crontab:**
```bash
crontab -e

# Examples:
# 0 2 * * * /path/to/backup.sh          # Daily at 2 AM
# */15 * * * * /path/to/script.sh       # Every 15 minutes
# 0 0 * * 0 /path/to/weekly.sh          # Weekly on Sunday
```

### Performance Tuning

**Check system performance:**
```bash
# I/O statistics
iostat -x 1

# Network statistics
iftop
nethogs

# System calls
strace -p <PID>
```

**Optimize services:**
Refer to `references/performance-tuning.md` for service-specific optimizations.

### Troubleshooting

**Common issues:**
1. Service won't start → Check logs: `journalctl -u <service> -xe`
2. Port already in use → Find process: `sudo lsof -i :<port>`
3. Permission denied → Check ownership and permissions
4. Disk full → Find large files: `du -h / | sort -rh | head -20`
5. High load → Check processes: `top`, `htop`

### Scripts

The skill includes utility scripts for common tasks:

- **`scripts/system_health_check.sh`**: Comprehensive system health report
- **`scripts/secure_ssh.sh`**: Automated SSH hardening
- **`scripts/backup_manager.sh`**: Flexible backup solution
- **`scripts/port_scanner.sh`**: Check open ports and services

Execute scripts with appropriate permissions and review output carefully.

### References

Detailed documentation available in `references/`:

- **`systemd-service-template.md`**: Complete systemd service examples
- **`lvm-guide.md`**: Logical Volume Management operations
- **`performance-tuning.md`**: Service-specific optimization guides
- **`security-checklist.md`**: Server hardening checklist
- **`nginx-configs.md`**: Common nginx configurations
- **`docker-management.md`**: Docker container management

Load references as needed for detailed guidance on specific topics.

### Safety Practices

**Always:**
- Test commands in non-production first when possible
- Make backups before major changes
- Verify syntax before executing destructive operations
- Document changes made to the system
- Use `--dry-run` flags when available

**Security notes:**
- Never include actual passwords in command history
- Use SSH keys instead of passwords
- Keep systems updated regularly
- Follow principle of least privilege
- Review firewall rules periodically

### Response Format

When providing system administration guidance:

1. **Understand the request**: Clarify ambiguous requests
2. **Provide complete commands**: Include all necessary steps
3. **Explain each command**: Brief description of what it does
4. **Add verification**: Show how to confirm success
5. **Include rollback**: Provide undo commands for risky operations
6. **Note prerequisites**: Mention required packages or configurations
7. **Adapt to distribution**: Use appropriate package manager and tools

**Example response structure:**

```
To install and configure nginx:

1. Update package list and install nginx:
   sudo apt update && sudo apt install -y nginx
   
2. Start and enable nginx:
   sudo systemctl start nginx
   sudo systemctl enable nginx
   
3. Configure firewall:
   sudo ufw allow 'Nginx Full'
   
4. Verify installation:
   sudo systemctl status nginx
   curl http://localhost
   
5. Configuration file location:
   /etc/nginx/nginx.conf
   /etc/nginx/sites-available/default

To rollback:
   sudo systemctl stop nginx
   sudo apt remove --purge nginx
```

This approach ensures users receive professional, safe, and actionable system administration guidance.
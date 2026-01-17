# Linux Server Security Hardening Checklist

## Initial Server Setup

### 1. Update System
```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
```

### 2. Create Non-Root User with Sudo Access
```bash
sudo adduser deployuser
sudo usermod -aG sudo deployuser
```

### 3. Set Strong Password Policy
```bash
sudo apt install libpam-pwquality
sudo nano /etc/security/pwquality.conf
```

Configuration:
```
minlen = 12
dcredit = -1
ucredit = -1
ocredit = -1
lcredit = -1
```

## SSH Hardening

### 1. Generate and Use SSH Keys
```bash
# On local machine
ssh-keygen -t ed25519 -C "user@host"
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server
```

### 2. Configure SSH Daemon
```bash
sudo nano /etc/ssh/sshd_config
```

Recommended settings:
```
Port 2222                              # Change default port
PermitRootLogin no                     # Disable root login
PasswordAuthentication no              # Require SSH keys
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
MaxSessions 2
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers deployuser                  # Whitelist specific users
Protocol 2
```

### 3. Restart SSH Service
```bash
sudo systemctl restart sshd
```

**Test new connection before closing current session!**

## Firewall Configuration

### UFW (Ubuntu/Debian)

```bash
# Install and enable
sudo apt install ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow specific services
sudo ufw allow 2222/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Enable firewall
sudo ufw enable
sudo ufw status verbose
```

### Firewalld (RHEL/CentOS/Fedora)

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --remove-service=ssh
sudo firewall-cmd --permanent --add-port=2222/tcp
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## Fail2Ban Installation

### Install and Configure
```bash
sudo apt install fail2ban
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Configuration for SSH:
```ini
[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
```

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

## Automatic Security Updates

### Ubuntu/Debian
```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Edit configuration:
```bash
sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
```

Enable security updates:
```
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
```

### RHEL/Fedora
```bash
sudo dnf install dnf-automatic
sudo nano /etc/dnf/automatic.conf
```

Set `apply_updates = yes`, then:
```bash
sudo systemctl enable --now dnf-automatic.timer
```

## File System Security

### 1. Set Appropriate Permissions
```bash
# Web directories
sudo chown -R www-data:www-data /var/www
sudo chmod -R 755 /var/www
sudo find /var/www -type f -exec chmod 644 {} \;

# Application directories
sudo chown -R appuser:appuser /opt/myapp
sudo chmod 700 /opt/myapp
```

### 2. Secure Temporary Directories
```bash
sudo nano /etc/fstab
```

Add:
```
tmpfs /tmp tmpfs defaults,noexec,nosuid,nodev 0 0
tmpfs /var/tmp tmpfs defaults,noexec,nosuid,nodev 0 0
```

Remount:
```bash
sudo mount -o remount /tmp
sudo mount -o remount /var/tmp
```

### 3. Disable Unused Filesystems
```bash
sudo nano /etc/modprobe.d/disable-filesystems.conf
```

Add:
```
install cramfs /bin/true
install freevxfs /bin/true
install jffs2 /bin/true
install hfs /bin/true
install hfsplus /bin/true
install udf /bin/true
```

## Network Security

### 1. Disable IPv6 (if not used)
```bash
sudo nano /etc/sysctl.conf
```

Add:
```
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

Apply:
```bash
sudo sysctl -p
```

### 2. Enable TCP Syncookies (DDoS Protection)
```bash
sudo nano /etc/sysctl.conf
```

Add:
```
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5
```

### 3. Disable IP Forwarding
```
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
```

### 4. Ignore ICMP Redirects
```
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
```

Apply all:
```bash
sudo sysctl -p
```

## Service Hardening

### 1. Disable Unnecessary Services
```bash
# List all services
systemctl list-unit-files --type=service

# Disable unused services
sudo systemctl disable <service>
sudo systemctl stop <service>
```

Common services to consider disabling:
- avahi-daemon (if not using Bonjour/Zeroconf)
- cups (if not printing)
- bluetooth
- rpcbind (if not using NFS)

### 2. Audit Running Services
```bash
sudo ss -tulpn
sudo netstat -tulpn
```

### 3. Disable Ctrl+Alt+Del
```bash
sudo systemctl mask ctrl-alt-del.target
```

## AppArmor / SELinux

### AppArmor (Ubuntu/Debian)
```bash
sudo apt install apparmor apparmor-utils
sudo systemctl enable apparmor
sudo systemctl start apparmor

# Check status
sudo aa-status

# Enforce profiles
sudo aa-enforce /etc/apparmor.d/*
```

### SELinux (RHEL/CentOS/Fedora)
```bash
# Check status
sestatus

# Set to enforcing
sudo setenforce 1
sudo nano /etc/selinux/config
# SELINUX=enforcing

# Troubleshoot denials
sudo ausearch -m avc -ts recent
```

## Audit and Logging

### 1. Install Audit Daemon
```bash
sudo apt install auditd
sudo systemctl enable auditd
sudo systemctl start auditd
```

### 2. Configure Audit Rules
```bash
sudo nano /etc/audit/rules.d/audit.rules
```

Add rules:
```
# Monitor authentication
-w /var/log/auth.log -p wa -k auth_log
-w /etc/passwd -p wa -k passwd_changes
-w /etc/shadow -p wa -k shadow_changes
-w /etc/group -p wa -k group_changes

# Monitor sudo usage
-w /etc/sudoers -p wa -k sudoers_changes
-w /var/log/sudo.log -p wa -k sudo_log

# Monitor network configuration
-w /etc/network/ -p wa -k network_changes
-w /etc/hosts -p wa -k hosts_changes
-w /etc/resolv.conf -p wa -k dns_changes

# Monitor system calls
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time_change
-a always,exit -F arch=b64 -S mount -S umount2 -k mounts
```

Reload rules:
```bash
sudo augenrules --load
```

### 3. Configure Log Rotation
```bash
sudo nano /etc/logrotate.d/custom
```

Example:
```
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 myapp myapp
    sharedscripts
}
```

## Root Account Security

### 1. Set Strong Root Password
```bash
sudo passwd root
```

### 2. Limit Root Login
Already covered in SSH configuration (PermitRootLogin no)

### 3. Configure Sudo Timeout
```bash
sudo visudo
```

Add:
```
Defaults timestamp_timeout=5
Defaults passwd_tries=3
```

## Regular Maintenance Tasks

### Daily
- Check system logs: `sudo journalctl -p err -b`
- Review failed login attempts: `sudo grep "Failed" /var/log/auth.log`
- Check disk usage: `df -h`

### Weekly
- Update packages: `sudo apt update && sudo apt upgrade`
- Review firewall rules: `sudo ufw status numbered`
- Check for rootkits: `sudo rkhunter --check`

### Monthly
- Review user accounts: `cat /etc/passwd`
- Audit sudo access: `getent group sudo`
- Check for security updates: `apt list --upgradable`
- Review open ports: `sudo ss -tulpn`

## Additional Security Tools

### Rootkit Detection
```bash
sudo apt install rkhunter chkrootkit
sudo rkhunter --update
sudo rkhunter --propupd
sudo rkhunter --check
```

### Lynis Security Audit
```bash
sudo apt install lynis
sudo lynis audit system
```

### ClamAV Antivirus
```bash
sudo apt install clamav clamav-daemon
sudo freshclam
sudo clamscan -r /home
```

## Quick Security Verification Script

```bash
#!/bin/bash
echo "=== Security Check ==="
echo "Open ports:"
sudo ss -tulpn
echo ""
echo "Failed login attempts (last 10):"
sudo grep "Failed" /var/log/auth.log | tail -10
echo ""
echo "Firewall status:"
sudo ufw status
echo ""
echo "Services listening:"
sudo netstat -tulpn | grep LISTEN
echo ""
echo "Last logins:"
last -n 10
```

## Post-Hardening Checklist

- [ ] Root login disabled
- [ ] SSH key authentication enabled
- [ ] Password authentication disabled  
- [ ] SSH port changed from default
- [ ] Firewall configured and enabled
- [ ] Fail2Ban installed and running
- [ ] Automatic security updates enabled
- [ ] Unnecessary services disabled
- [ ] File permissions properly set
- [ ] AppArmor/SELinux enabled
- [ ] Audit logging configured
- [ ] Strong password policy enforced
- [ ] Regular backups configured
- [ ] Monitoring alerts set up

## Emergency Response

If server is compromised:

1. **Disconnect from network** (if possible)
2. **Change all passwords** from different machine
3. **Review logs**: `/var/log/auth.log`, `/var/log/syslog`, `journalctl`
4. **Check for unauthorized users**: `cat /etc/passwd`
5. **Scan for rootkits**: `rkhunter --check`
6. **Check cron jobs**: `crontab -l`, `ls /etc/cron.*`
7. **Verify SSH keys**: `cat ~/.ssh/authorized_keys`
8. **Restore from backup** if necessary
9. **Update all software**: Full system update
10. **Strengthen security**: Implement additional measures
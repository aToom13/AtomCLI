#!/bin/bash

###############################################################################
# System Health Check Script
# Performs comprehensive health check on Linux systems
# Usage: sudo ./system_health_check.sh
###############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}" 
   exit 1
fi

echo "=========================================="
echo "    SYSTEM HEALTH CHECK REPORT"
echo "    $(date)"
echo "=========================================="
echo ""

# 1. System Information
echo -e "${GREEN}[1] System Information${NC}"
echo "Hostname: $(hostname)"
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "OS: $PRETTY_NAME"
fi
echo "Uptime: $(uptime -p)"
echo ""

# 2. CPU Usage
echo -e "${GREEN}[2] CPU Usage${NC}"
echo "Load Average: $(uptime | awk -F'load average:' '{print $2}')"
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print "  Idle: " $1"%"}'
echo "Top 5 CPU processes:"
ps aux --sort=-%cpu | head -6 | tail -5
echo ""

# 3. Memory Usage
echo -e "${GREEN}[3] Memory Usage${NC}"
free -h
MEMORY_USED=$(free | grep Mem | awk '{print ($3/$2) * 100.0}')
MEMORY_THRESHOLD=80
if (( $(echo "$MEMORY_USED > $MEMORY_THRESHOLD" | bc -l) )); then
    echo -e "${RED}WARNING: Memory usage is above ${MEMORY_THRESHOLD}% (${MEMORY_USED}%)${NC}"
else
    echo -e "${GREEN}Memory usage is healthy (${MEMORY_USED}%)${NC}"
fi
echo ""

# 4. Disk Usage
echo -e "${GREEN}[4] Disk Usage${NC}"
df -h | grep -vE '^Filesystem|tmpfs|cdrom'
echo ""
DISK_THRESHOLD=85
while IFS= read -r line; do
    USAGE=$(echo "$line" | awk '{print $5}' | sed 's/%//')
    MOUNT=$(echo "$line" | awk '{print $6}')
    if [ "$USAGE" -gt "$DISK_THRESHOLD" ]; then
        echo -e "${RED}WARNING: $MOUNT is ${USAGE}% full${NC}"
    fi
done < <(df -h | grep -vE '^Filesystem|tmpfs|cdrom' | tail -n +1)
echo ""

# 5. Network Connectivity
echo -e "${GREEN}[5] Network Connectivity${NC}"
echo "Network Interfaces:"
ip -brief addr show
echo ""
echo "Testing connectivity:"
if ping -c 1 8.8.8.8 &> /dev/null; then
    echo -e "${GREEN}✓ Internet connectivity OK${NC}"
else
    echo -e "${RED}✗ No internet connectivity${NC}"
fi
if ping -c 1 google.com &> /dev/null; then
    echo -e "${GREEN}✓ DNS resolution OK${NC}"
else
    echo -e "${RED}✗ DNS resolution failed${NC}"
fi
echo ""

# 6. Open Ports
echo -e "${GREEN}[6] Listening Ports${NC}"
if command -v ss &> /dev/null; then
    ss -tulpn | grep LISTEN
elif command -v netstat &> /dev/null; then
    netstat -tulpn | grep LISTEN
fi
echo ""

# 7. Services Status
echo -e "${GREEN}[7] Critical Services Status${NC}"
SERVICES=("ssh" "sshd" "cron" "systemd-resolved")
for service in "${SERVICES[@]}"; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $service is running"
    else
        if systemctl list-unit-files | grep -q "^$service.service"; then
            echo -e "  ${RED}✗${NC} $service is not running"
        fi
    fi
done
echo ""

# 8. Failed Services
echo -e "${GREEN}[8] Failed Services${NC}"
FAILED=$(systemctl --failed --no-pager --no-legend | wc -l)
if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}No failed services${NC}"
else
    echo -e "${RED}$FAILED failed services found:${NC}"
    systemctl --failed --no-pager
fi
echo ""

# 9. Last Logins
echo -e "${GREEN}[9] Last 5 Login Attempts${NC}"
last -n 5 -a
echo ""

# 10. Failed Login Attempts
echo -e "${GREEN}[10] Recent Failed Login Attempts${NC}"
if [ -f /var/log/auth.log ]; then
    FAILED_LOGINS=$(grep "Failed password" /var/log/auth.log 2>/dev/null | tail -5)
    if [ -z "$FAILED_LOGINS" ]; then
        echo -e "${GREEN}No recent failed login attempts${NC}"
    else
        echo "$FAILED_LOGINS"
    fi
elif [ -f /var/log/secure ]; then
    FAILED_LOGINS=$(grep "Failed password" /var/log/secure 2>/dev/null | tail -5)
    if [ -z "$FAILED_LOGINS" ]; then
        echo -e "${GREEN}No recent failed login attempts${NC}"
    else
        echo "$FAILED_LOGINS"
    fi
fi
echo ""

# 11. Firewall Status
echo -e "${GREEN}[11] Firewall Status${NC}"
if command -v ufw &> /dev/null; then
    ufw status
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --state
    firewall-cmd --list-all
else
    echo "No firewall detected"
fi
echo ""

# 12. System Updates
echo -e "${GREEN}[12] System Updates${NC}"
if command -v apt &> /dev/null; then
    UPDATES=$(apt list --upgradable 2>/dev/null | grep -c upgradable || true)
    if [ "$UPDATES" -gt 1 ]; then
        echo -e "${YELLOW}$((UPDATES - 1)) updates available${NC}"
    else
        echo -e "${GREEN}System is up to date${NC}"
    fi
elif command -v dnf &> /dev/null; then
    UPDATES=$(dnf check-update --quiet | wc -l)
    if [ "$UPDATES" -gt 0 ]; then
        echo -e "${YELLOW}$UPDATES updates available${NC}"
    else
        echo -e "${GREEN}System is up to date${NC}"
    fi
elif command -v yum &> /dev/null; then
    UPDATES=$(yum check-update --quiet | wc -l)
    if [ "$UPDATES" -gt 0 ]; then
        echo -e "${YELLOW}$UPDATES updates available${NC}"
    else
        echo -e "${GREEN}System is up to date${NC}"
    fi
fi
echo ""

# 13. Security Checks
echo -e "${GREEN}[13] Basic Security Checks${NC}"

# Check root login
ROOT_LOGIN=$(grep "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}')
if [ "$ROOT_LOGIN" = "no" ]; then
    echo -e "  ${GREEN}✓${NC} Root SSH login is disabled"
else
    echo -e "  ${YELLOW}!${NC} Root SSH login is enabled (consider disabling)"
fi

# Check password authentication
PASS_AUTH=$(grep "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}')
if [ "$PASS_AUTH" = "no" ]; then
    echo -e "  ${GREEN}✓${NC} Password authentication is disabled"
else
    echo -e "  ${YELLOW}!${NC} Password authentication is enabled (consider using keys)"
fi

# Check fail2ban
if systemctl is-active --quiet fail2ban 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Fail2Ban is running"
else
    echo -e "  ${YELLOW}!${NC} Fail2Ban is not installed or not running"
fi

echo ""

# 14. Summary
echo "=========================================="
echo "           HEALTH CHECK SUMMARY"
echo "=========================================="

# Check overall health
WARNINGS=0

# Memory warning
if (( $(echo "$MEMORY_USED > $MEMORY_THRESHOLD" | bc -l) )); then
    ((WARNINGS++))
fi

# Disk warnings
while IFS= read -r line; do
    USAGE=$(echo "$line" | awk '{print $5}' | sed 's/%//')
    if [ "$USAGE" -gt "$DISK_THRESHOLD" ]; then
        ((WARNINGS++))
    fi
done < <(df -h | grep -vE '^Filesystem|tmpfs|cdrom' | tail -n +1)

# Failed services
if [ "$FAILED" -gt 0 ]; then
    ((WARNINGS++))
fi

if [ "$WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}✓ System health is GOOD${NC}"
    echo "  No critical issues detected"
else
    echo -e "${YELLOW}! System has $WARNINGS warning(s)${NC}"
    echo "  Please review the issues above"
fi

echo ""
echo "Report generated: $(date)"
echo "=========================================="
#!/bin/bash

###############################################################################
# SSH Hardening Script
# Automatically secures SSH configuration with best practices
# Usage: sudo ./secure_ssh.sh
# 
# WARNING: This script will modify SSH configuration. Make sure you have
# an active SSH connection before running, and test the new configuration
# in a separate terminal before closing your current session!
###############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_CONFIG_BACKUP="${SSHD_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
NEW_SSH_PORT=2222

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}" 
   exit 1
fi

echo "=========================================="
echo "     SSH HARDENING SCRIPT"
echo "=========================================="
echo ""

# Function to update or add SSH config parameter
update_ssh_config() {
    local param=$1
    local value=$2
    local config_file=$3
    
    if grep -q "^${param}" "$config_file"; then
        # Parameter exists, update it
        sed -i "s/^${param}.*/${param} ${value}/" "$config_file"
    elif grep -q "^#${param}" "$config_file"; then
        # Parameter is commented, uncomment and update
        sed -i "s/^#${param}.*/${param} ${value}/" "$config_file"
    else
        # Parameter doesn't exist, add it
        echo "${param} ${value}" >> "$config_file"
    fi
}

# Backup existing configuration
echo -e "${YELLOW}[1] Backing up SSH configuration...${NC}"
cp "$SSHD_CONFIG" "$SSHD_CONFIG_BACKUP"
echo -e "${GREEN}✓ Backup created: $SSHD_CONFIG_BACKUP${NC}"
echo ""

# Get current user for AllowUsers
CURRENT_USER=$(who am i | awk '{print $1}')
echo -e "${YELLOW}[2] Configuring SSH hardening...${NC}"
echo "Current user: $CURRENT_USER"
echo ""

# Ask for confirmation
read -p "Change SSH port to $NEW_SSH_PORT? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    update_ssh_config "Port" "$NEW_SSH_PORT" "$SSHD_CONFIG"
    echo -e "${GREEN}✓ SSH port changed to $NEW_SSH_PORT${NC}"
    PORT_CHANGED=true
else
    echo "Keeping current SSH port"
    PORT_CHANGED=false
fi
echo ""

# Apply security settings
echo "Applying security configurations..."

# Disable root login
update_ssh_config "PermitRootLogin" "no" "$SSHD_CONFIG"
echo -e "${GREEN}✓ Root login disabled${NC}"

# Disable password authentication (key-based only)
read -p "Disable password authentication (require SSH keys)? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    update_ssh_config "PasswordAuthentication" "no" "$SSHD_CONFIG"
    update_ssh_config "PubkeyAuthentication" "yes" "$SSHD_CONFIG"
    echo -e "${GREEN}✓ Password authentication disabled${NC}"
    echo -e "${YELLOW}⚠ Make sure you have SSH keys configured before closing this session!${NC}"
else
    echo "Password authentication left enabled"
fi
echo ""

# Other security settings
update_ssh_config "PermitEmptyPasswords" "no" "$SSHD_CONFIG"
update_ssh_config "X11Forwarding" "no" "$SSHD_CONFIG"
update_ssh_config "MaxAuthTries" "3" "$SSHD_CONFIG"
update_ssh_config "MaxSessions" "2" "$SSHD_CONFIG"
update_ssh_config "Protocol" "2" "$SSHD_CONFIG"
update_ssh_config "ClientAliveInterval" "300" "$SSHD_CONFIG"
update_ssh_config "ClientAliveCountMax" "2" "$SSHD_CONFIG"

echo -e "${GREEN}✓ Additional security settings applied${NC}"
echo ""

# Configure AllowUsers
read -p "Restrict SSH access to specific users? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter usernames to allow (space-separated) [$CURRENT_USER]: " USERS
    USERS=${USERS:-$CURRENT_USER}
    update_ssh_config "AllowUsers" "$USERS" "$SSHD_CONFIG"
    echo -e "${GREEN}✓ SSH access restricted to: $USERS${NC}"
fi
echo ""

# Test configuration
echo -e "${YELLOW}[3] Testing SSH configuration...${NC}"
if sshd -t 2>/dev/null; then
    echo -e "${GREEN}✓ SSH configuration is valid${NC}"
else
    echo -e "${RED}✗ SSH configuration has errors!${NC}"
    echo "Restoring backup..."
    cp "$SSHD_CONFIG_BACKUP" "$SSHD_CONFIG"
    echo -e "${YELLOW}Configuration restored from backup${NC}"
    exit 1
fi
echo ""

# Update firewall if port changed
if [ "$PORT_CHANGED" = true ]; then
    echo -e "${YELLOW}[4] Updating firewall rules...${NC}"
    
    if command -v ufw &> /dev/null; then
        # UFW (Ubuntu/Debian)
        echo "Updating UFW rules..."
        ufw allow "$NEW_SSH_PORT/tcp" comment 'SSH'
        echo -e "${GREEN}✓ UFW rule added for port $NEW_SSH_PORT${NC}"
        echo -e "${YELLOW}⚠ Remember to remove old SSH rule if port 22 is open:${NC}"
        echo "  sudo ufw delete allow 22/tcp"
    elif command -v firewall-cmd &> /dev/null; then
        # Firewalld (RHEL/CentOS/Fedora)
        echo "Updating firewalld rules..."
        firewall-cmd --permanent --add-port="$NEW_SSH_PORT/tcp"
        firewall-cmd --reload
        echo -e "${GREEN}✓ Firewalld rule added for port $NEW_SSH_PORT${NC}"
        echo -e "${YELLOW}⚠ Remember to remove old SSH rule if port 22 is open:${NC}"
        echo "  sudo firewall-cmd --permanent --remove-service=ssh"
        echo "  sudo firewall-cmd --reload"
    else
        echo -e "${YELLOW}⚠ No firewall detected. Please manually allow port $NEW_SSH_PORT${NC}"
    fi
    echo ""
fi

# Summary and next steps
echo "=========================================="
echo "         HARDENING COMPLETE"
echo "=========================================="
echo ""
echo -e "${GREEN}SSH configuration has been hardened!${NC}"
echo ""
echo "Configuration changes:"
echo "  • Root login: Disabled"
if [ "$PORT_CHANGED" = true ]; then
    echo "  • SSH port: Changed to $NEW_SSH_PORT"
fi
echo "  • Maximum auth tries: 3"
echo "  • Empty passwords: Disabled"
echo "  • X11 forwarding: Disabled"
echo ""

echo -e "${YELLOW}IMPORTANT - BEFORE RESTARTING SSH:${NC}"
echo "1. Keep this terminal open!"
echo "2. Open a NEW terminal and test SSH connection:"
if [ "$PORT_CHANGED" = true ]; then
    echo "   ssh -p $NEW_SSH_PORT $CURRENT_USER@$(hostname -I | awk '{print $1}')"
else
    echo "   ssh $CURRENT_USER@$(hostname -I | awk '{print $1}')"
fi
echo "3. If connection works, restart SSH service:"
echo "   sudo systemctl restart sshd"
echo "4. Test connection again from new terminal"
echo "5. Only close this terminal after confirming everything works"
echo ""

read -p "Restart SSH service now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Restarting SSH service..."
    systemctl restart sshd
    echo -e "${GREEN}✓ SSH service restarted${NC}"
    echo ""
    echo -e "${YELLOW}⚠ TEST YOUR CONNECTION NOW in a new terminal!${NC}"
    if [ "$PORT_CHANGED" = true ]; then
        echo "   ssh -p $NEW_SSH_PORT $CURRENT_USER@$(hostname -I | awk '{print $1}')"
    fi
else
    echo ""
    echo "SSH service NOT restarted. Restart manually when ready:"
    echo "  sudo systemctl restart sshd"
fi

echo ""
echo "Backup configuration saved at: $SSHD_CONFIG_BACKUP"
echo ""
echo "To rollback changes:"
echo "  sudo cp $SSHD_CONFIG_BACKUP $SSHD_CONFIG"
echo "  sudo systemctl restart sshd"
echo ""
echo "=========================================="
# Linux System Administrator Skill - Tamamlanmış Paket

## Skill Dizin Yapısı

```
linux-sysadmin/
├── SKILL.md                              # Ana skill dökümanı (oluşturuldu ✓)
├── scripts/
│   ├── system_health_check.sh            # Sistem sağlık kontrolü (oluşturuldu ✓)
│   ├── secure_ssh.sh                     # SSH güvenlik otomasyonu (oluşturuldu ✓)
│   ├── backup_manager.sh                 # Yedekleme yöneticisi (oluşturulacak)
│   └── port_scanner.sh                   # Port tarayıcı (oluşturulacak)
├── references/
│   ├── systemd-service-template.md       # Systemd service şablonları (oluşturuldu ✓)
│   ├── security-checklist.md             # Güvenlik kontrol listesi (oluşturuldu ✓)
│   ├── lvm-guide.md                      # LVM yönetim kılavuzu (oluşturulacak)
│   ├── performance-tuning.md             # Performans optimizasyonu (oluşturulacak)
│   ├── nginx-configs.md                  # Nginx konfigürasyonları (oluşturulacak)
│   └── docker-management.md              # Docker yönetimi (oluşturulacak)
└── assets/
    └── (Şu an boş - gerekirse eklenecek)
```

## Oluşturulan Dosyalar

### 1. ✅ SKILL.md
Ana skill dökümanı. Claude'un Linux sistem yöneticisi rolünü üstlenmesini sağlar:
- Distribution detection (Ubuntu/Debian, RHEL/Fedora, Arch, openSUSE)
- Package management (apt, dnf, pacman, zypper)
- Service management (systemd)
- Network configuration (interfaces, firewall, DNS)
- User & permission management
- Security hardening (SSH, firewall, fail2ban)
- System monitoring & logging
- Disk & storage management
- Backup & recovery
- Cron jobs
- Performance tuning
- Troubleshooting workflows

### 2. ✅ scripts/system_health_check.sh
Kapsamlı sistem sağlık kontrolü scripti:
- System information
- CPU & memory usage
- Disk usage (eşik uyarıları ile)
- Network connectivity test
- Open ports
- Service status checks
- Failed services detection
- Login attempts (successful & failed)
- Firewall status
- System updates check
- Security configuration checks
- Genel sağlık özeti

### 3. ✅ scripts/secure_ssh.sh
Otomatik SSH güvenlik sağlamlaştırma:
- Configuration backup
- Port değiştirme (varsayılan: 2222)
- Root login disable
- Password authentication disable (SSH keys only)
- Security settings (MaxAuthTries, X11Forwarding, etc.)
- AllowUsers restriction
- Configuration testing
- Firewall rules update
- Rollback options
- Güvenli restart workflow

### 4. ✅ references/systemd-service-template.md
Systemd service şablonları:
- Basic service template
- Web application (Node.js)
- Python application (Gunicorn)
- Timer services (cron alternative)
- Multi-instance services
- Docker container service
- Service types açıklamaları
- Restart options
- Security options
- Resource limits
- Installation & troubleshooting

### 5. ✅ references/security-checklist.md
Kapsamlı güvenlik sağlamlaştırma checklist:
- Initial server setup
- SSH hardening (detaylı)
- Firewall configuration (UFW & firewalld)
- Fail2Ban installation & setup
- Automatic security updates
- File system security
- Network security (sysctl)
- Service hardening
- AppArmor/SELinux
- Audit & logging
- Root account security
- Regular maintenance tasks
- Security tools (rkhunter, lynis, ClamAV)
- Emergency response procedures

### 6. ✅ scripts/init_skill.py
Yeni skill oluşturma aracı:
- Skill directory structure creation
- SKILL.md template generation
- Example files in scripts/, references/, assets/

### 7. ✅ scripts/package_skill.py
Skill paketleme ve validasyon aracı:
- Automatic validation
- YAML frontmatter checking
- Directory structure validation
- File reference verification
- Zip package creation
- Error & warning reporting

## Kullanım Senaryoları

### Senaryo 1: Paket Yönetimi
**Kullanıcı:** "nginx yükle, sudo şifrem: mypassword"

**Claude Yanıtı:**
```bash
# Distribution detection
cat /etc/os-release

# Ubuntu/Debian için:
sudo apt update && sudo apt install -y nginx

# Servisi başlat ve enable et
sudo systemctl start nginx
sudo systemctl enable nginx

# Firewall ayarla
sudo ufw allow 'Nginx Full'

# Doğrulama
sudo systemctl status nginx
curl http://localhost
```

### Senaryo 2: Sistem Sağlık Kontrolü
**Kullanıcı:** "sistem sağlığını kontrol et"

**Claude Yanıtı:**
```bash
# Hazır scripti çalıştır
sudo bash scripts/system_health_check.sh

# Veya manuel kontroller:
# CPU
top -bn1 | grep "Cpu(s)"

# Memory
free -h

# Disk
df -h

# Services
systemctl --failed
```

### Senaryo 3: SSH Güvenlik Sağlamlaştırma
**Kullanıcı:** "SSH'ı güvenli hale getir"

**Claude Yanıtı:**
```bash
# Otomatik script ile:
sudo bash scripts/secure_ssh.sh

# Veya manuel adımlar:
# 1. Configuration backup
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# 2. Güvenlik ayarları
sudo nano /etc/ssh/sshd_config
# PermitRootLogin no
# PasswordAuthentication no
# Port 2222

# 3. Test ve restart
sudo sshd -t
sudo systemctl restart sshd
```

### Senaryo 4: Systemd Service Oluşturma
**Kullanıcı:** "my-app için systemd service oluştur"

**Claude Yanıtı:**
```bash
# Service file oluştur
sudo nano /etc/systemd/system/my-app.service

# Template'i references/systemd-service-template.md'den al
# Basic template:
[Unit]
Description=My Application
After=network.target

[Service]
Type=simple
User=myapp
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/python3 /opt/myapp/app.py
Restart=on-failure

[Install]
WantedBy=multi-user.target

# Reload ve start
sudo systemctl daemon-reload
sudo systemctl enable my-app
sudo systemctl start my-app
sudo systemctl status my-app
```

## Paketleme ve Dağıtım

### Adım 1: Skill'i Paketleme
```bash
# Validation ve packaging
python scripts/package_skill.py linux-sysadmin/ ./

# Output: linux-sysadmin.zip
```

### Adım 2: Kullanıcıya Teslim
- `linux-sysadmin.zip` dosyasını kullanıcıya gönder
- Kullanıcı Claude.ai'de Skills menüsünden import edebilir
- Skill otomatik olarak ilgili sorularda aktive olur

## Gelecek Geliştirmeler (İsteğe Bağlı)

Aşağıdaki dosyalar ek functionality için eklenebilir:

### scripts/backup_manager.sh
- Automated backup solution
- Multiple backup targets
- Compression & encryption
- Backup verification
- Restore functionality

### scripts/port_scanner.sh
- Open port detection
- Service identification
- Security vulnerability check

### references/lvm-guide.md
- LVM volume creation
- Resizing operations
- Snapshot management
- Recovery procedures

### references/performance-tuning.md
- Nginx optimization
- MySQL/PostgreSQL tuning
- Kernel parameter optimization
- Application-specific guides

### references/nginx-configs.md
- Reverse proxy setup
- SSL/TLS configuration
- Load balancing
- Security headers

### references/docker-management.md
- Container lifecycle
- Docker Compose
- Network configuration
- Volume management

## Skill'in Güçlü Yönleri

1. **Multi-Distribution Support**: Ubuntu, Fedora, Arch ve openSUSE desteği
2. **Safety First**: Her işlem için doğrulama ve rollback seçenekleri
3. **Professional Workflow**: Gerçek sysadmin yaklaşımı
4. **Comprehensive Coverage**: Paket yönetiminden security'ye tam yelpaze
5. **Ready-to-Use Scripts**: Otomatik health check ve SSH hardening
6. **Detailed References**: 200+ satır security checklist ve systemd templates
7. **Error Prevention**: Test-before-apply yaklaşımı

## Notlar

- Kullanıcının sudo şifresini doğrudan komutlarda kullanmak yerine, kullanıcıya komutları vererek terminalde çalıştırmasını söylüyoruz (güvenlik)
- Tüm komutlar distribution-aware (işletim sistemine göre uyarlanır)
- Her işlem için verification steps ve rollback options var
- Professional sysadmin best practices takip ediliyor
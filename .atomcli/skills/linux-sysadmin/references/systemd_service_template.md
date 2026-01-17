# Systemd Service Templates

## Basic Service Template

```ini
[Unit]
Description=My Application Service
After=network.target
Documentation=https://example.com/docs

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/python3 /opt/myapp/app.py
Restart=on-failure
RestartSec=5s

# Environment
Environment="PORT=8000"
Environment="ENV=production"

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/myapp

[Install]
WantedBy=multi-user.target
```

## Web Application Service (Node.js Example)

```ini
[Unit]
Description=Node.js Web Application
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=webapp
Group=webapp
WorkingDirectory=/var/www/myapp
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

# Environment file
EnvironmentFile=/etc/myapp/env

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=myapp

# Resource limits
LimitNOFILE=4096
MemoryLimit=512M

[Install]
WantedBy=multi-user.target
```

## Python Application with Gunicorn

```ini
[Unit]
Description=Gunicorn daemon for Django/Flask app
After=network.target

[Service]
Type=notify
User=django
Group=www-data
WorkingDirectory=/opt/django-app
ExecStart=/opt/django-app/venv/bin/gunicorn \
    --workers 3 \
    --bind unix:/run/gunicorn.sock \
    --timeout 120 \
    wsgi:application

ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
TimeoutStopSec=5
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## Timer (Cron Alternative)

**Service file: /etc/systemd/system/backup.service**
```ini
[Unit]
Description=Database Backup Service

[Service]
Type=oneshot
User=backup
ExecStart=/usr/local/bin/backup.sh
StandardOutput=journal
```

**Timer file: /etc/systemd/system/backup.timer**
```ini
[Unit]
Description=Run backup daily at 2 AM

[Timer]
OnCalendar=daily
OnCalendar=02:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable timer: `sudo systemctl enable --now backup.timer`

## Service with Multiple Instances

```ini
[Unit]
Description=Worker instance %i
After=network.target

[Service]
Type=simple
User=worker
ExecStart=/usr/bin/worker --instance=%i
Restart=always

[Install]
WantedBy=multi-user.target
```

Start multiple instances:
```bash
sudo systemctl start worker@1.service
sudo systemctl start worker@2.service
sudo systemctl start worker@3.service
```

## Docker Container Service

```ini
[Unit]
Description=Docker Container - MyApp
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/usr/bin/docker stop myapp
ExecStartPre=-/usr/bin/docker rm myapp
ExecStart=/usr/bin/docker run \
    --name myapp \
    -p 8080:8080 \
    -v /data:/app/data \
    myapp:latest
ExecStop=/usr/bin/docker stop myapp

[Install]
WantedBy=multi-user.target
```

## Service Types

- **`Type=simple`**: Default, main process specified in ExecStart
- **`Type=forking`**: Parent process exits after forking child
- **`Type=oneshot`**: Process expected to exit before starting follow-up units
- **`Type=notify`**: Service sends notification when ready
- **`Type=dbus`**: Service acquires D-Bus name

## Restart Options

- **`Restart=no`**: Don't restart (default)
- **`Restart=on-failure`**: Restart on non-zero exit or timeout
- **`Restart=on-abnormal`**: Restart on timeout or signal
- **`Restart=always`**: Always restart regardless of exit status
- **`RestartSec=5s`**: Wait time before restarting

## Security Options

```ini
# Restrict system access
ProtectSystem=strict          # Read-only /usr, /boot, /efi
ProtectHome=true             # Deny access to home directories
PrivateTmp=true              # Private /tmp and /var/tmp
NoNewPrivileges=true         # Prevent privilege escalation

# Network restrictions
PrivateNetwork=true          # Private network namespace
RestrictAddressFamilies=AF_INET AF_INET6

# Filesystem restrictions
ReadOnlyPaths=/etc
ReadWritePaths=/var/lib/myapp
InaccessiblePaths=/home

# Capability restrictions
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
```

## Resource Limits

```ini
# Memory
MemoryLimit=512M
MemoryMax=1G

# CPU
CPUQuota=50%
CPUWeight=100

# Files
LimitNOFILE=4096
LimitNPROC=512

# Timeouts
TimeoutStartSec=90
TimeoutStopSec=30
```

## Installation Steps

1. Create service file:
```bash
sudo nano /etc/systemd/system/myapp.service
```

2. Reload systemd:
```bash
sudo systemctl daemon-reload
```

3. Enable and start service:
```bash
sudo systemctl enable myapp.service
sudo systemctl start myapp.service
```

4. Check status:
```bash
sudo systemctl status myapp.service
sudo journalctl -u myapp.service -f
```

## Common Troubleshooting

**Service won't start:**
```bash
sudo systemctl status myapp.service
sudo journalctl -u myapp.service -xe
```

**Test service file syntax:**
```bash
sudo systemd-analyze verify myapp.service
```

**Reload after changes:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart myapp.service
```

**View service dependencies:**
```bash
systemctl list-dependencies myapp.service
```
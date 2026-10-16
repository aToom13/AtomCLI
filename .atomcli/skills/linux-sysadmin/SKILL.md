---
name: linux-sysadmin
description: Plan and verify Linux server service, SSH, backup, and hardening work. Use for server administration beyond ordinary package or command questions; use linux-admin for general Linux tasks.
trigger_words: [linux server hardening, linux server administration, ssh hardening, systemd service setup, sunucu güvenliği, sunucu yönetimi]
---

# Linux server administration

Confirm target host, distribution, service manager, and current service state before changing it. Review commands and their effect on remote access. For SSH or firewall changes, keep a recovery path and verify a second connection before closing the existing one.

Use normal interactive privilege escalation when authorized. Never read or store a sudo password in a file, ask the user to paste one into chat, or place one in shell commands. A skill never grants permission to change the host; follow the user's request and tool approval policy.

For recurring service setup, consult [systemd service template](references/systemd_service_template.md). For security review, consult [security checklist](references/security_checklist.md). Read only the relevant section. Review any script before running it; prefer direct, minimal commands for one-off work.

After changes, inspect service status and logs and test the affected user path. Report commands run, observed results, and rollback steps for risky changes.

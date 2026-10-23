#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install --yes bubblewrap

# Ubuntu restricts unconfined user namespaces. Permit only the sandbox launcher,
# retaining the host-wide restriction and the product's fail-closed behavior.
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] &&
   [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1" ]; then
  sudo tee /etc/apparmor.d/atomcli-ci-bwrap >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile atomcli-ci-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
PROFILE
  sudo apparmor_parser -r /etc/apparmor.d/atomcli-ci-bwrap
fi

# Exercise the same unprivileged UID/PID namespace path as the real tests.
bwrap --unshare-user --unshare-pid --ro-bind / / --proc /proc --dev /dev -- /bin/true

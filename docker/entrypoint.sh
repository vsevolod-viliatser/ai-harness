#!/bin/bash
# Runs as root only long enough to install the firewall, then drops to an unprivileged user with
# every capability removed, so nothing the agent runs can undo the firewall (iptables needs NET_ADMIN).
set -euo pipefail

/usr/local/bin/init-firewall.sh

# Run as the owner of the mounted clone so files the agent writes stay editable on the Mac.
uid=$(stat -c %u /work)
gid=$(stat -c %g /work)
if [ "$uid" = 0 ]; then uid=1000; gid=1000; fi

export HOME=/tmp/agent-home
mkdir -p "$HOME"
chown "$uid:$gid" "$HOME"

exec setpriv --reuid="$uid" --regid="$gid" --clear-groups \
  --inh-caps=-all --bounding-set=-all --no-new-privs -- "$@"

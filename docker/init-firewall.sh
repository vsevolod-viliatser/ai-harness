#!/bin/bash
# Deny-by-default egress for the agent box (idea from Anthropic's devcontainer init-firewall.sh).
# Allowed: HTTPS to the hosts below, DNS to the container's own resolver. Everything else is rejected,
# so a prompt-injected agent can't reach a vendor API, GitHub, your cloud or anything else, even with a key.
set -euo pipefail

ALLOWED_DOMAINS=(
  api.anthropic.com    # the model
  registry.npmjs.org   # npm ci
  binaries.prisma.sh   # prisma generate (postinstall) may fetch engines
)

ipset create allowed hash:net
for domain in "${ALLOWED_DOMAINS[@]}"; do
  ips=$(dig +short A "$domain" | grep -E '^[0-9.]+$' || true)
  if [ -z "$ips" ]; then echo "firewall: cannot resolve $domain" >&2; exit 1; fi
  for ip in $ips; do ipset add -exist allowed "$ip"; done
done

iptables -A OUTPUT -o lo -j ACCEPT
for ns in $(awk '/^nameserver/ {print $2}' /etc/resolv.conf); do
  iptables -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set allowed dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited
iptables -P OUTPUT DROP

# IPv6 is not in the allowlist at all: close it rather than leave a second, unfiltered door.
if ip6tables -L >/dev/null 2>&1; then
  ip6tables -A OUTPUT -o lo -j ACCEPT
  ip6tables -A OUTPUT -j REJECT
  ip6tables -P OUTPUT DROP
fi

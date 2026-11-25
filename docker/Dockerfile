# The agent box: everything the role agents run happens in here, never on the Mac.
# The Mac holds .env files with live keys and cloud credentials; this image holds none of that.
FROM node:22-bookworm-slim

# Pinned so a CLI release can't change flags or behaviour under a running harness. Bump on purpose.
ARG CLAUDE_CODE_VERSION=2.1.329

RUN apt-get update \
 && apt-get install -y --no-install-recommends git iptables ipset dnsutils ca-certificates curl ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && git config --system --add safe.directory '*'

COPY init-firewall.sh entrypoint.sh /usr/local/bin/
COPY checks.sh /usr/local/bin/harness-checks
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/entrypoint.sh /usr/local/bin/harness-checks

# No auto-update, telemetry or error reporting: each would need another allowed host.
# HUSKY=0: `npm ci` runs `prepare: husky`, which writes .git/config; .git is mounted read-only here.
ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    HUSKY=0 \
    CI=1

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# OpenClaw assistant gateway (Telegram entry point) for Railway.
FROM node:20-slim

# Tools some OpenClaw skills shell out to; keep the image small otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pin the OpenClaw version we developed against.
RUN npm install -g openclaw@2026.4.9

# Seed config + workspace (skill scripts, persona). Copied into the runtime
# state dir on first boot by the entrypoint; the skill is refreshed every boot.
COPY seed /seed
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/root
# Telegram uses outbound long polling, so no inbound port is required; the
# gateway's local control port is internal only.
ENTRYPOINT ["/entrypoint.sh"]

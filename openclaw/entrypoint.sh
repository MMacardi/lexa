#!/bin/sh
set -e

OC=/root/.openclaw

# On first boot (empty volume) seed the config + workspace from the image.
mkdir -p "$OC/credentials" "$OC/workspace/skills"
[ -f "$OC/openclaw.json" ] || cp /seed/.openclaw/openclaw.json "$OC/openclaw.json"

# Always refresh the workspace persona + skill so code updates take effect.
cp /seed/.openclaw/workspace/SOUL.md "$OC/workspace/SOUL.md"
rm -rf "$OC/workspace/skills/vocab-assistant"
cp -r /seed/.openclaw/workspace/skills/vocab-assistant "$OC/workspace/skills/vocab-assistant"

# Inject secrets / settings from environment.
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  openclaw config set channels.telegram.botToken "$TELEGRAM_BOT_TOKEN" || true
fi
if [ -n "$BAILIAN_API_KEY" ]; then
  # Trailing newline submits the interactive paste-token prompt (no TTY here).
  printf '%s\n' "$BAILIAN_API_KEY" | openclaw models auth paste-token --provider qwen --profile-id qwen:default || true
fi

# Telegram allow-list (who may DM the bot). Comma-separated ids in TELEGRAM_ALLOW_FROM.
ALLOW="${TELEGRAM_ALLOW_FROM:-865277762}"
JSON_IDS=$(printf '%s' "$ALLOW" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"",(i>1?",":""),$i}}')
printf '{"version":1,"allowFrom":[%s]}' "$JSON_IDS" > "$OC/credentials/telegram-default-allowFrom.json"

echo "[entrypoint] starting OpenClaw gateway; VOCAB_API_URL=$VOCAB_API_URL"
exec openclaw gateway

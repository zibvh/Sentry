# VaultBot 🔓

WhatsApp view-once saver. Reply to any view-once → saved silently to Discord.

## Deploy to Render

1. Push this folder to a **GitHub repo**
2. Go to [render.com](https://render.com) → New → Web Service → connect repo
3. Render reads `render.yaml` automatically
4. Set `PHONE_NUMBER` in Environment tab (e.g. `+27821234567`)
5. Open your Render URL → **Connect** → enter number → get pairing code
6. After linking, **copy the SESSION_ID** shown and paste it into the `SESSION_ID` env var on Render
7. That's it — bot survives restarts without re-pairing

## Environment Variables

| Variable | Description |
|---|---|
| `DISCORD_WEBHOOK` | Already set — your Discord channel |
| `PHONE_NUMBER` | Your WhatsApp number e.g. `+27821234567` |
| `SESSION_ID` | Auto-generated after first pairing — copy from dashboard |

## How to save a view-once

1. Someone sends you a view-once image/video
2. **Reply** to it (any text — "ok", "🔥", anything)
3. Bot saves it + uploads to Discord silently
4. Zero read receipts. Zero notifications to sender.

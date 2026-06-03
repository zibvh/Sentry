# 👁️ ViewOnce Vault v2

Silently saves WhatsApp view-once images/videos when you reply to them — uploads straight to Discord.

## Setup

```bash
npm install
npm start
# → http://localhost:3000
```

## Connect (Pairing Code — no QR needed)

1. Open dashboard → **Connect** tab
2. Enter your phone number with country code (e.g. `+27821234567`)
3. Click **Get Pairing Code**
4. On your phone: WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number
5. Enter the 8-digit code shown in the dashboard

## Discord Setup

1. In Discord: right-click a channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL
2. Open dashboard → **Settings** tab
3. Paste webhook URL → Save

## How to save a view-once

1. Someone sends you a view-once image/video
2. Simply **reply** to that message (any text, even "ok")
3. The bot intercepts it, saves it to the vault, and uploads to Discord — **silently**, zero notifications sent

## Files

```
whatsapp-bot/
├── index.js          # Server
├── src/bot.js        # WhatsApp logic
├── src/discord.js    # Discord webhook uploader
├── public/index.html # Dashboard
├── config.json       # Auto-created, stores phone + webhook
├── auth_info/        # Session files — keep private!
└── saved_media/      # Saved files
```

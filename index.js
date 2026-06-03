const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const VaultBot = require("./src/bot");
const { loadSessionFromEnv } = require("./src/session");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const SAVE_PATH = path.join(os.tmpdir(), "vaultbot_media");

const config = {
  discordWebhook: process.env.DISCORD_WEBHOOK || "https://discord.com/api/webhooks/1505502048945180683/gs0uzeVd4XBSlUBxoEIzdsVJStQcab1wWqQ5L0uLhBbjn7sdK-9b6Tu9iZ0K7t2R9V70",
  phoneNumber: process.env.PHONE_NUMBER || "",
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/media", express.static(SAVE_PATH));

const bot = new VaultBot(io, config);

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json(bot.getStatus()));
app.get("/api/media",  (req, res) => res.json(bot.getSavedMedia()));
app.get("/api/config", (req, res) => res.json(bot.getConfig()));

app.post("/api/connect", async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });
  bot.updateConfig({ phoneNumber });
  res.json({ success: true });
  bot.start().catch(console.error);
});

app.post("/api/config", (req, res) => {
  bot.updateConfig(req.body);
  res.json({ success: true });
});

app.delete("/api/media/:id", (req, res) => {
  const idx = bot.savedMedia.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const [entry] = bot.savedMedia.splice(idx, 1);
  fs.remove(entry.filepath).catch(() => {});
  bot._saveIndex();
  io.emit("media_deleted", { id: req.params.id });
  res.json({ success: true });
});

app.post("/api/logout", async (req, res) => {
  await bot.logout().catch(() => {});
  res.json({ success: true });
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.emit("status", bot.getStatus());
  socket.emit("media_list", bot.getSavedMedia());
});

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  server.listen(PORT, async () => {
    console.log(`🚀 VaultBot running on port ${PORT}`);

    // Try loading session from env var first (Render restarts)
    const loaded = await loadSessionFromEnv();

    if (loaded || config.phoneNumber) {
      console.log("⏳ Starting WhatsApp connection...");
      bot.start().catch(console.error);
    } else {
      console.log("💡 No session or phone number set. Open the dashboard to connect.");
      bot.setStatus("waiting");
    }
  });
})();

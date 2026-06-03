const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs-extra");
const WhatsAppBot = require("./src/bot");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SAVE_PATH = path.join(__dirname, "saved_media");
const CONFIG_PATH = path.join(__dirname, "config.json");
const PORT = process.env.PORT || 3000;

// Load or create config
let config = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch {}
}
if (!config.discordWebhook && process.env.DISCORD_WEBHOOK) {
  config.discordWebhook = process.env.DISCORD_WEBHOOK;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/media", express.static(SAVE_PATH));

const bot = new WhatsAppBot(SAVE_PATH, io, config);

// ── API Routes ──────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json(bot.getStatus()));
app.get("/api/media", (req, res) => res.json(bot.getSavedMedia()));
app.get("/api/config", (req, res) => res.json(bot.getConfig()));

// Save config (discord webhook + phone number)
app.post("/api/config", (req, res) => {
  const { discordWebhook, phoneNumber } = req.body;
  bot.updateConfig({ discordWebhook, phoneNumber });
  res.json({ success: true });
});

// Start bot with phone number → returns pairing code
app.post("/api/connect", async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });

  bot.updateConfig({ phoneNumber });
  res.json({ success: true, message: "Starting connection, pairing code incoming..." });

  // Start bot in background
  bot.start().catch(console.error);
});

// Connect using session ID string
app.post("/api/connect-session", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Session ID required" });

  try {
    const loaded = await bot.loadSessionAuth(sessionId);
    if (!loaded) return res.status(400).json({ error: "Invalid session ID" });

    // Save session ID to config for future restarts
    bot.updateConfig({ sessionId });
    res.json({ success: true });

    // Start bot in background
    bot.start().catch(console.error);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/media/:id", (req, res) => {
  const idx = bot.savedMedia.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const [entry] = bot.savedMedia.splice(idx, 1);
  fs.remove(entry.filepath).catch(() => {});
  bot.saveMediaIndex();
  res.json({ success: true });
  io.emit("media_deleted", { id: req.params.id });
});

app.post("/api/logout", async (req, res) => {
  try { await bot.logout(); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── Socket.IO ───────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🖥️  Dashboard connected");
  socket.emit("status", bot.getStatus());
  socket.emit("media_list", bot.getSavedMedia());
});

// ── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Dashboard → http://localhost:${PORT}\n`);
  // Auto-start if phone number already configured
  if (config.phoneNumber) {
    console.log(`📱 Auto-connecting with saved phone: ${config.phoneNumber}`);
    bot.start().catch(console.error);
  }
});

const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  isJidGroup,
  Browsers,
  // proto is NOT needed — removed dead import
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs-extra");
const EventEmitter = require("events");
const { sendToDiscord } = require("./discord");

class WhatsAppBot extends EventEmitter {
  constructor(savePath, io, config = {}) {
    super();
    this.savePath = savePath;
    this.io = io;
    this.config = config;
    this.sock = null;
    this.savedMedia = [];
    this.status = "disconnected";
    this.pairingCode = null;
    this.connectionInfo = null;
    this.isStarting = false; // guard against concurrent start() calls

    // key: message id → stored view-once data, waiting for a reply
    this.pendingViewOnce = new Map();

    fs.ensureDirSync(savePath);
    this.loadSavedMedia();
  }

  loadSavedMedia() {
    const indexFile = path.join(this.savePath, "index.json");
    if (fs.existsSync(indexFile)) {
      try {
        this.savedMedia = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      } catch {
        this.savedMedia = [];
      }
    }
  }

  saveMediaIndex() {
    const indexFile = path.join(this.savePath, "index.json");
    fs.writeFileSync(indexFile, JSON.stringify(this.savedMedia, null, 2));
  }

  setStatus(status, extra = {}) {
    this.status = status;
    this.io.emit("status", { status, ...extra });
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    const cfgPath = path.join(__dirname, "../config.json");
    fs.writeFileSync(cfgPath, JSON.stringify(this.config, null, 2));
  }

  async start() {
    // Prevent concurrent starts (e.g. auto-start + /api/connect racing)
    if (this.isStarting) return;
    this.isStarting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(__dirname, "../auth_info")
      );
      // DO NOT use fetchLatestBaileysVersion — causes incompatibility per docs
      const logger = pino({ level: "silent" });

      const phoneNumber = this.config.phoneNumber;

      this.sock = makeWASocket({
        logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        // Browsers.macOS("Google Chrome") is REQUIRED for pairing code per docs
        browser: Browsers.macOS("Google Chrome"),
        markOnlineOnConnect: false,
        getMessage: async (key) => {
          const stored = this.pendingViewOnce.get(key.id);
          if (stored) return stored.viewOnceMsg;
          return { conversation: "" };
        },
      });

      // Track if pairing code has been requested to avoid duplicate requests
      let pairingRequested = false;

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Request pairing code when QR is available — means handshake is complete
        if (phoneNumber && !state.creds.registered && !pairingRequested && !!qr) {
          pairingRequested = true;
          // Small buffer to ensure socket is fully ready
          await new Promise(r => setTimeout(r, 500));
          try {
            const digits = phoneNumber.replace(/\D/g, "");
            const rawCode = await this.sock.requestPairingCode(digits);
            const formatted = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
            this.pairingCode = formatted;
            this.setStatus("pairing", { code: formatted });
            console.log(`\n📱 Pairing Code: ${formatted}`);
            console.log("WhatsApp → Settings → Linked Devices → Link with phone number\n");
          } catch (e) {
            console.error("Pairing code error:", e.message);
            this.setStatus("error", { message: e.message });
          }
        }

        if (connection === "close") {
          this.isStarting = false; // allow restart
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            this.setStatus("logged_out");
            await fs.remove(path.join(__dirname, "../auth_info"));
            console.log("🚪 Logged out — auth cleared.");
          } else {
            // Any other close (428, Connection Closed, etc) — just reconnect, never wipe auth
            pairingRequested = false;
            this.setStatus("reconnecting");
            console.log(`🔄 Reconnecting (reason: ${statusCode})...`);
            setTimeout(() => this.start(), 3000);
          }
        }

        if (connection === "open") {
          this.isStarting = false;
          this.pairingCode = null;
          const user = this.sock.user;
          this.connectionInfo = user;
          this.setStatus("connected", { user });
          console.log(`✅ Connected as ${user?.name} (${user?.id})`);
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
          await this.handleMessage(msg);
        }
      });

    } catch (err) {
      this.isStarting = false;
      console.error("start() error:", err.message);
      this.setStatus("error", { message: err.message });
    }
  }

  async handleMessage(msg) {
    if (!msg.message) return;

    const msgContent = msg.message;
    const from = msg.key.remoteJid;
    const pushName = msg.pushName || "Unknown";
    const isGroup = isJidGroup(from);
    const timestamp = new Date(msg.messageTimestamp * 1000);
    const msgId = msg.key.id;

    // ── 1. Detect incoming view-once messages ─────────────────────────────
    // WhatsApp uses three different wrapper types depending on client version
    const viewOnceMsg =
      msgContent?.viewOnceMessageV2?.message ||
      msgContent?.viewOnceMessageV2Extension?.message ||
      msgContent?.viewOnceMessage?.message;

    if (viewOnceMsg) {
      const imageMsg = viewOnceMsg.imageMessage;
      const videoMsg = viewOnceMsg.videoMessage;

      if (imageMsg || videoMsg) {
        console.log(`👁️  View-once ${imageMsg ? "image" : "video"} from ${pushName} — waiting for reply`);

        this.pendingViewOnce.set(msgId, {
          msg,
          viewOnceMsg,
          imageMsg,
          videoMsg,
          from,
          pushName,
          isGroup,
          timestamp,
        });

        // WhatsApp view-once media expires — clean up after 5 minutes
        setTimeout(() => this.pendingViewOnce.delete(msgId), 5 * 60 * 1000);

        this.io.emit("viewonce_received", {
          id: msgId,
          from,
          pushName,
          mediaType: imageMsg ? "image" : "video",
          timestamp: timestamp.toISOString(),
        });
        return;
      }
    }

    // ── 2. Detect replies — check all message types that can carry contextInfo ──
    const contextInfo =
      msgContent?.extendedTextMessage?.contextInfo ||
      msgContent?.imageMessage?.contextInfo ||
      msgContent?.videoMessage?.contextInfo ||
      msgContent?.stickerMessage?.contextInfo ||
      msgContent?.audioMessage?.contextInfo ||
      // Fallback: scan all top-level message fields for contextInfo
      Object.values(msgContent || {}).find((v) => v?.contextInfo)?.contextInfo;

    const quotedId = contextInfo?.stanzaId;

    if (quotedId && this.pendingViewOnce.has(quotedId)) {
      console.log(`💬 Reply to view-once detected — saving silently...`);
      const stored = this.pendingViewOnce.get(quotedId);
      this.pendingViewOnce.delete(quotedId); // consume it — don't save twice
      await this.saveViewOnce(stored);
    }
  }

  async saveViewOnce({ msg, viewOnceMsg, imageMsg, videoMsg, from, pushName, isGroup, timestamp }) {
    const mediaType = imageMsg ? "image" : "video";
    const ext = imageMsg ? "jpg" : "mp4";

    try {
      // downloadMediaMessage needs the message field to be the unwrapped content
      const reconstructedMsg = { ...msg, message: viewOnceMsg };

      const buffer = await downloadMediaMessage(
        reconstructedMsg,
        "buffer",
        {},
        {
          // ctx param — logger + reuploadRequest for expired media
          logger: pino({ level: "silent" }),
          reuploadRequest: this.sock.updateMediaMessage,
        }
      );

      if (!buffer || buffer.length === 0) {
        throw new Error("Downloaded buffer is empty — media may have expired");
      }

      const filename = `${Date.now()}_${mediaType}.${ext}`;
      const filepath = path.join(this.savePath, filename);
      await fs.writeFile(filepath, buffer);

      const entry = {
        id: Date.now().toString(),
        filename,
        filepath,
        mediaType,
        from,
        pushName,
        isGroup,
        timestamp: timestamp.toISOString(),
        size: buffer.length,
        caption: imageMsg?.caption || videoMsg?.caption || "",
        discordSent: false,
      };

      // ── Discord upload ─────────────────────────────────────────────────
      if (this.config.discordWebhook) {
        try {
          await sendToDiscord(this.config.discordWebhook, {
            buffer,
            filename,
            mediaType,
            sender: pushName,
            from,
            caption: entry.caption,
            timestamp: entry.timestamp,
          });
          entry.discordSent = true;
          console.log(`📤 Sent to Discord`);
        } catch (discordErr) {
          console.error(`⚠️  Discord upload failed: ${discordErr.message}`);
          this.io.emit("discord_error", { message: discordErr.message });
        }
      }

      this.savedMedia.unshift(entry);
      this.saveMediaIndex();
      this.io.emit("new_media", entry);
      console.log(`✅ Saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

    } catch (err) {
      console.error(`❌ Failed to save:`, err.message);
      this.io.emit("error", { message: `Save failed: ${err.message}` });
    }
  }

  getSavedMedia() { return this.savedMedia; }
  getStatus() { return { status: this.status, code: this.pairingCode, user: this.connectionInfo }; }
  getConfig() { return { discordWebhook: this.config.discordWebhook ? "••••••••" : "", phoneNumber: this.config.phoneNumber || "" }; }

  async logout() {
    if (this.sock) await this.sock.logout();
  }
}

module.exports = WhatsAppBot;

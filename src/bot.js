const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const EventEmitter = require("events");
const { sendToDiscord } = require("./discord");
const { getAuthDir, exportSessionId } = require("./session");

const SAVE_PATH = path.join(os.tmpdir(), "vaultbot_media");

class VaultBot extends EventEmitter {
  constructor(io, config = {}) {
    super();
    this.io = io;
    this.config = config;
    this.sock = null;
    this.savedMedia = [];
    this.status = "disconnected";
    this.pairingCode = null;
    this.user = null;
    this.isStarting = false;
    this.pendingViewOnce = new Map(); // msgId → media data

    fs.ensureDirSync(SAVE_PATH);
    this._loadIndex();
  }

  _loadIndex() {
    const f = path.join(SAVE_PATH, "index.json");
    try { this.savedMedia = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []; }
    catch { this.savedMedia = []; }
  }

  _saveIndex() {
    fs.writeFileSync(path.join(SAVE_PATH, "index.json"), JSON.stringify(this.savedMedia, null, 2));
  }

  setStatus(status, extra = {}) {
    this.status = status;
    this.io.emit("status", { status, ...extra });
  }

  updateConfig(cfg) {
    this.config = { ...this.config, ...cfg };
  }

  async start() {
    if (this.isStarting) return;
    this.isStarting = true;

    try {
      const authDir = getAuthDir();
      await fs.ensureDir(authDir);

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();
      const logger = pino({ level: "silent" });

      const phoneNumber = this.config.phoneNumber;
      const needsPairing = phoneNumber && !state.creds.registered;

      this.sock = makeWASocket({
        version,
        logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        // Use the correct Browsers helper - this sets the right platform ID
        // that WhatsApp uses to decide how to handle the pairing request
        browser: Browsers.ubuntu("Chrome"),
        getMessage: async (key) => {
          const stored = this.pendingViewOnce.get(key.id);
          if (stored) return stored.viewOnceMsg;
          return { conversation: "" };
        },
      });

      // Request pairing code ONLY after the noise WebSocket handshake completes.
      // "connecting" fires via process.nextTick BEFORE the WS even opens — too early.
      // We must wait for the server to send its first binary node (the noise handshake IQ).
      // The safest signal is a fixed delay after makeWASocket returns, giving the WS
      // time to open and exchange the hello frames (~2-3s on good connections).
      if (needsPairing) {
        // Wait for WS to physically open - socket.js fires 'connecting' synchronously
        // but the actual TCP+noise handshake takes ~2s
        await new Promise((r) => setTimeout(r, 3000));

        try {
          const digits = phoneNumber.replace(/\D/g, "");
          const rawCode = await this.sock.requestPairingCode(digits);
          const formatted = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
          this.pairingCode = formatted;
          this.setStatus("pairing", { code: formatted });
          console.log(`\n📱 Pairing Code: ${formatted}\n`);
        } catch (e) {
          console.error("Pairing code error:", e.message);
          this.setStatus("error", { message: e.message });
        }
      }

      this.sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "close") {
          this.isStarting = false;
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            this.setStatus("logged_out");
            await fs.remove(getAuthDir());
          } else {
            this.setStatus("reconnecting");
            setTimeout(() => this.start(), 4000);
          }
        }

        if (connection === "open") {
          this.isStarting = false;
          this.pairingCode = null;
          this.user = this.sock.user;
          this.setStatus("connected", { user: this.user });
          console.log(`✅ Connected as ${this.user?.name}`);

          // Export and log the session ID so user can save it
          const sid = await exportSessionId();
          if (sid) {
            console.log("\n╔══════════════════════════════════════════╗");
            console.log("║  COPY YOUR SESSION_ID (save in Render)   ║");
            console.log("╠══════════════════════════════════════════╣");
            console.log(`║  ${sid.substring(0, 40)}...  ║`);
            console.log("╚══════════════════════════════════════════╝");
            console.log("\nFull SESSION_ID:");
            console.log(sid);
            console.log("\nPaste this as SESSION_ID env var in Render.\n");
            this.io.emit("session_id", { sessionId: sid });
          }
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) await this._handleMessage(msg);
      });

    } catch (err) {
      this.isStarting = false;
      console.error("Bot start error:", err.message);
      this.setStatus("error", { message: err.message });
    }
  }

  async _handleMessage(msg) {
    if (!msg.message) return;

    const content = msg.message;
    const from = msg.key.remoteJid;
    const pushName = msg.pushName || "Unknown";
    const isGroup = isJidGroup(from);
    const timestamp = new Date(msg.messageTimestamp * 1000);
    const msgId = msg.key.id;

    // ── Detect view-once messages ─────────────────────────────────────────
    const viewOnceMsg =
      content?.viewOnceMessageV2?.message ||
      content?.viewOnceMessageV2Extension?.message ||
      content?.viewOnceMessage?.message;

    if (viewOnceMsg) {
      const imageMsg = viewOnceMsg.imageMessage;
      const videoMsg = viewOnceMsg.videoMessage;
      if (imageMsg || videoMsg) {
        console.log(`👁️  View-once ${imageMsg ? "image" : "video"} from ${pushName}`);
        this.pendingViewOnce.set(msgId, { msg, viewOnceMsg, imageMsg, videoMsg, from, pushName, isGroup, timestamp });
        setTimeout(() => this.pendingViewOnce.delete(msgId), 5 * 60 * 1000);
        this.io.emit("viewonce_pending", { id: msgId, pushName, mediaType: imageMsg ? "image" : "video", timestamp: timestamp.toISOString() });
        return;
      }
    }

    // ── Detect reply to view-once → trigger save ──────────────────────────
    const ctxInfo =
      content?.extendedTextMessage?.contextInfo ||
      content?.imageMessage?.contextInfo ||
      content?.videoMessage?.contextInfo ||
      content?.stickerMessage?.contextInfo ||
      content?.audioMessage?.contextInfo ||
      Object.values(content || {}).find((v) => v?.contextInfo)?.contextInfo;

    const quotedId = ctxInfo?.stanzaId;
    if (quotedId && this.pendingViewOnce.has(quotedId)) {
      const stored = this.pendingViewOnce.get(quotedId);
      this.pendingViewOnce.delete(quotedId);
      await this._saveViewOnce(stored);
    }
  }

  async _saveViewOnce({ msg, viewOnceMsg, imageMsg, videoMsg, from, pushName, isGroup, timestamp }) {
    const mediaType = imageMsg ? "image" : "video";
    const ext = imageMsg ? "jpg" : "mp4";

    try {
      const reconstructed = { ...msg, message: viewOnceMsg };
      const buffer = await downloadMediaMessage(
        reconstructed, "buffer", {},
        { logger: pino({ level: "silent" }), reuploadRequest: this.sock.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) throw new Error("Empty buffer — media may have expired");

      const filename = `${Date.now()}_${mediaType}.${ext}`;
      const filepath = path.join(SAVE_PATH, filename);
      await fs.writeFile(filepath, buffer);

      const entry = {
        id: Date.now().toString(),
        filename, filepath, mediaType, from, pushName, isGroup,
        timestamp: timestamp.toISOString(),
        size: buffer.length,
        caption: imageMsg?.caption || videoMsg?.caption || "",
        discordSent: false,
      };

      if (this.config.discordWebhook) {
        try {
          await sendToDiscord(this.config.discordWebhook, {
            buffer, filename, mediaType,
            sender: pushName, from,
            caption: entry.caption,
            timestamp: entry.timestamp,
          });
          entry.discordSent = true;
          console.log(`📤 Sent to Discord`);
        } catch (e) {
          console.error(`⚠️  Discord failed: ${e.message}`);
          this.io.emit("discord_error", { message: e.message });
        }
      }

      this.savedMedia.unshift(entry);
      this._saveIndex();
      this.io.emit("new_media", entry);
      console.log(`✅ Saved: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);

    } catch (err) {
      console.error(`❌ Save failed: ${err.message}`);
      this.io.emit("error", { message: err.message });
    }
  }

  getStatus() { return { status: this.status, code: this.pairingCode, user: this.user }; }
  getSavedMedia() { return this.savedMedia; }
  getConfig() { return { discordWebhook: this.config.discordWebhook ? "set" : "", phoneNumber: this.config.phoneNumber || "" }; }

  async logout() {
    if (this.sock) {
      await this.sock.logout().catch(() => {});
      await fs.remove(getAuthDir()).catch(() => {});
    }
  }
}

module.exports = VaultBot;

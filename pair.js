/**
 * ViewOnce Vault — Session Pairing Tool
 * Run this ONCE on your phone (Termux) or local machine to get a session ID.
 * Then paste the session ID into your bot's Connect page on Render.
 *
 * Usage:
 *   node pair.js
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  BufferJSON,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs-extra");
const readline = require("readline");

const AUTH_PATH = path.join(__dirname, "pair_auth");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function pair() {
  await fs.ensureDir(AUTH_PATH);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
  const logger = pino({ level: "silent" });

  const phoneNumber = await ask("📱 Enter your WhatsApp number (with country code, no + or spaces)\n> ");
  const digits = phoneNumber.replace(/\D/g, "");

  console.log("\n🔌 Connecting to WhatsApp...");

  const sock = makeWASocket({
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    browser: Browsers.macOS("Google Chrome"),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  let pairingDone = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (!pairingDone && (connection === "connecting" || !!qr)) {
      pairingDone = true;
      try {
        await new Promise(r => setTimeout(r, 1000));
        const code = await sock.requestPairingCode(digits);
        const formatted = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log(`\n✅ Your pairing code: \x1b[32m\x1b[1m${formatted}\x1b[0m`);
        console.log("👉 Open WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number");
        console.log("   Enter this code. Waiting for you to confirm...\n");
      } catch (e) {
        console.error("❌ Pairing code error:", e.message);
        process.exit(1);
      }
    }

    if (connection === "open") {
      console.log("🎉 Linked! Generating your session ID...\n");

      // Read all auth files and encode them into a single base64 session string
      const authFiles = await fs.readdir(AUTH_PATH);
      const sessionData = {};

      for (const file of authFiles) {
        const filePath = path.join(AUTH_PATH, file);
        const content = await fs.readFile(filePath, "utf8");
        try {
          sessionData[file] = JSON.parse(content, BufferJSON.reviver);
        } catch {
          sessionData[file] = content;
        }
      }

      const sessionString = Buffer.from(
        JSON.stringify(sessionData, BufferJSON.replacer)
      ).toString("base64");

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("🔑 YOUR SESSION ID (copy everything below this line):\n");
      console.log(sessionString);
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ Paste this into your bot's Connect page → Session ID field");
      console.log("   You can now close this and run your bot on Render.\n");

      // Clean up pair_auth folder
      await fs.remove(AUTH_PATH);
      await sock.end();
      rl.close();
      process.exit(0);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnecting...");
        setTimeout(pair, 3000);
      } else {
        console.log("❌ Logged out");
        process.exit(1);
      }
    }
  });
}

pair().catch(console.error);

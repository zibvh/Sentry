const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const AUTH_DIR = path.join(os.tmpdir(), "vaultbot_auth");

/**
 * Load session from SESSION_ID env var (base64 encoded JSON of creds dir)
 * This is how the bot survives Render restarts — creds live in an env var
 */
async function loadSessionFromEnv() {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) return false;

  try {
    await fs.ensureDir(AUTH_DIR);
    // SESSION_ID is base64(JSON({ filename: base64content, ... }))
    const decoded = Buffer.from(sessionId, "base64").toString("utf8");
    const files = JSON.parse(decoded);

    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(AUTH_DIR, filename);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, Buffer.from(content, "base64"));
    }
    console.log("✅ Session loaded from SESSION_ID env var");
    return true;
  } catch (e) {
    console.error("⚠️  Failed to load session from env:", e.message);
    return false;
  }
}

/**
 * Encode current auth dir to base64 SESSION_ID string
 * Print it to console so user can copy to Render env vars
 */
async function exportSessionId() {
  try {
    if (!await fs.pathExists(AUTH_DIR)) return null;
    const files = {};
    const allFiles = await getAllFiles(AUTH_DIR);

    for (const filePath of allFiles) {
      const content = await fs.readFile(filePath);
      const relativePath = path.relative(AUTH_DIR, filePath);
      files[relativePath] = content.toString("base64");
    }

    const sessionId = Buffer.from(JSON.stringify(files)).toString("base64");
    return sessionId;
  } catch (e) {
    console.error("Export session error:", e.message);
    return null;
  }
}

async function getAllFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await getAllFiles(fullPath)));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function getAuthDir() {
  return AUTH_DIR;
}

module.exports = { loadSessionFromEnv, exportSessionId, getAuthDir };

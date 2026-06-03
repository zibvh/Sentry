const fetch = require("node-fetch");
const FormData = require("form-data");

async function sendToDiscord(webhookUrl, { buffer, filename, mediaType, sender, from, caption, timestamp }) {
  if (!webhookUrl) throw new Error("No Discord webhook URL configured");

  const form = new FormData();

  const embed = {
    title: `👁️ View-Once ${mediaType === "image" ? "Image" : "Video"}`,
    color: mediaType === "image" ? 0x00e5a0 : 0x3b82f6,
    fields: [
      { name: "From", value: `${sender || "Unknown"}`, inline: true },
      { name: "Chat", value: `${from || "Unknown"}`, inline: true },
      { name: "Time", value: new Date(timestamp).toLocaleString(), inline: false },
    ],
    footer: { text: "VaultBot • Silent Save" },
    timestamp: new Date(timestamp).toISOString(),
  };

  if (caption) embed.fields.push({ name: "Caption", value: caption });

  form.append("payload_json", JSON.stringify({
    username: "VaultBot",
    embeds: [embed],
  }));

  form.append("file", buffer, {
    filename,
    contentType: mediaType === "image" ? "image/jpeg" : "video/mp4",
  });

  // node-fetch v2 requires explicit headers — without this Discord returns 400
  const res = await fetch(webhookUrl, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord ${res.status}: ${text}`);
  }

  return true;
}

module.exports = { sendToDiscord };

const fetch = require("node-fetch");
const FormData = require("form-data");

async function sendToDiscord(webhookUrl, { buffer, filename, mediaType, sender, from, caption, timestamp }) {
  if (!webhookUrl) throw new Error("No Discord webhook URL configured");

  const form = new FormData();

  const embed = {
    title: `👁️ View-Once ${mediaType === "image" ? "Image" : "Video"} Intercepted`,
    color: mediaType === "image" ? 0x00e5a0 : 0x00b8ff,
    fields: [
      { name: "From", value: sender || "Unknown", inline: true },
      { name: "Chat", value: from || "Unknown", inline: true },
      { name: "Time", value: new Date(timestamp).toLocaleString(), inline: false },
    ],
    footer: { text: "ViewOnce Vault • Silent Save" },
  };

  if (caption) embed.fields.push({ name: "Caption", value: caption, inline: false });

  const payload = {
    username: "ViewOnce Vault",
    avatar_url: "https://cdn-icons-png.flaticon.com/512/733/733585.png",
    embeds: [embed],
  };

  form.append("payload_json", JSON.stringify(payload));
  form.append("file", buffer, {
    filename,
    contentType: mediaType === "image" ? "image/jpeg" : "video/mp4",
  });

  // FIX: node-fetch v2 requires headers passed explicitly — without this
  // the multipart boundary is missing and Discord returns HTTP 400
  const res = await fetch(webhookUrl, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed (${res.status}): ${text}`);
  }

  return true;
}

module.exports = { sendToDiscord };

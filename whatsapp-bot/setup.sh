#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "📦 ViewOnce Vault — Termux Setup"
echo "================================"
echo ""

# Ensure we're in the right place
cd "$(dirname "$0")"

echo "Installing packages one by one (safer for Termux)..."
echo ""

packages=(
  "express@5.2.1"
  "socket.io@4.8.3"
  "fs-extra@11.3.5"
  "pino@9.6.0"
  "node-fetch@2.7.0"
  "form-data@4.0.5"
  "pino-pretty@13.1.3"
  "@whiskeysockets/baileys@6.17.16"
)

for pkg in "${packages[@]}"; do
  echo -n "  → $pkg ... "
  npm install "$pkg" --save --ignore-scripts 2>/dev/null && echo "✅" || echo "❌ FAILED"
done

echo ""
echo "✅ Setup complete! Run: npm start"

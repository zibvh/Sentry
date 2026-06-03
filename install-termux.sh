#!/bin/bash
echo "📦 Installing for Termux..."

# Termux needs these system packages first
pkg install -y nodejs python make

# Install npm deps (skip optional/native modules)
npm install --ignore-scripts --no-optional

echo ""
echo "✅ Done! Run: npm start"
echo "   Then open: http://localhost:3000"

#!/bin/bash

echo "🚀 Installing dependencies..."
bun install

echo "🌍 Installing Playwright browsers (Firefox & Chromium)..."
bunx playwright install firefox chromium

echo "✅ Setup complete! You can now run 'bun run dev'."

#!/bin/bash

echo "🚀 Installing dependencies..."
bun install

echo "🌍 Installing Playwright Chromium..."
bunx playwright install chromium

echo "✅ Setup complete! You can now run 'bun run dev'."

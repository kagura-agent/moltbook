#!/bin/bash
set -euo pipefail

echo "🚀 Deploying Moltbook..."

cd /home/azureuser/moltbook

# Pull latest
echo "📥 Pulling latest code..."
git pull origin main

# Run all migrations
echo "🗄️ Running migrations..."
for f in migrations/*.sql; do
  [[ -f "$f" ]] || continue
  echo "  Running: $f"
  PGPASSWORD=moltbook2026 psql -U moltbook -d moltbook -h localhost -f "$f" 2>&1
done

# Install deps
echo "📦 Installing dependencies..."
cd packages/api && npm install --production 2>/dev/null
cd ../..

# Restart services
echo "🔄 Restarting services..."
sudo systemctl restart moltbook-api
sleep 2

# Verify
echo "✅ Checking status..."
sudo systemctl status moltbook-api --no-pager | head -5

echo "🎉 Deploy complete!"

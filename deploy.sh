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

# Install deps & build
echo "📦 Installing API dependencies..."
cd packages/api && npm install --production 2>/dev/null
cd ../..

echo "📦 Installing Web dependencies..."
cd packages/web && npm install 2>/dev/null

echo "🔨 Building Web..."
npm run build
cd ../..

# Restart services
echo "🔄 Restarting services..."
sudo systemctl restart moltbook-api moltbook-web
sleep 2

# Verify
echo "✅ Checking status..."
sudo systemctl status moltbook-api moltbook-web --no-pager | grep -E "Active:|●"

echo "🎉 Deploy complete!"

#!/bin/bash

# Standard Deployment Script for BOTH Applications
# Prevents confusion and ensures both apps are running correctly.

echo "🚀 Starting Deployment/Recovery..."

# ------------------------------------------------------------------
# APP 1: GestionPBI (New App) - Port 3051
# ------------------------------------------------------------------
echo "🔵 [1/2] Checking App: GestionPBI (gestionpbi-backend)..."
cd /var/www/gestionpbi/backend
pm2 describe 16 > /dev/null
if [ $? -eq 0 ]; then
    echo "   🔄 Restarting process ID 16..."
    pm2 restart 16
else
    echo "   ⚠️ Process 16 not found. Attempting to start..."
    # Configured to use port 3051 via .env usually, but we ensure correctness
    pm2 start src/server.js --name "gestionpbi-backend" --timestamp
fi

# ------------------------------------------------------------------
# APP 2: GestionPerlas (Legacy App) - Port 3001
# ------------------------------------------------------------------
echo "🟠 [2/2] Checking App: GestionPerlas (gestion-backend)..."
# Using explicit path since we are in a different workspace
TARGET_DIR="/var/www/gestion_de_pedidos/backend"

# Check for ID 20 (current) or process name "gestion-backend"
pm2 describe "gestion-backend" > /dev/null
if [ $? -eq 0 ]; then
    echo "   🔄 Restarting legacy process 'gestion-backend'..."
    pm2 restart "gestion-backend"
else
    echo "   ⚠️ Legacy process not found. Attempting to start on PORT 3001..."
    PORT=3001 pm2 start "$TARGET_DIR/server.js" --name "gestion-backend" --cwd "$TARGET_DIR" --time
fi

echo "✅ All Systems Operational."
echo "📜 Current Process List:"
pm2 list

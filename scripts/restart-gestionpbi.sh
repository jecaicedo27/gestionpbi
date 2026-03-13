#!/bin/bash
# Script de reinicio seguro para GestionPBI Backend
# Uso: ./scripts/restart-gestionpbi.sh

set -e  # Exit on error

echo "🔄 Reiniciando GestionPBI Backend..."
echo "============================================"

# 1. Validar que estamos en el directorio correcto
CURRENT_DIR=$(pwd)
if [[ ! "$CURRENT_DIR" == *"gestionpbi"* ]]; then
    echo "❌ ERROR: No estás en el directorio de GestionPBI"
    echo "   Directorio actual: $CURRENT_DIR"
    echo "   Directorio esperado: /var/www/gestionpbi"
    exit 1
fi

# 2. Verificar que el proceso existe
if ! pm2 list | grep -q "gestionpbi-backend"; then
    echo "⚠️  El proceso gestionpbi-backend no existe. Creándolo..."
    cd /var/www/gestionpbi/backend
    pm2 start ecosystem.config.js
else
    echo "✅ Proceso encontrado. Reiniciando..."
    pm2 restart gestionpbi-backend
fi

# 3. Esperar y verificar que inició correctamente
sleep 2
if pm2 list | grep "gestionpbi-backend" | grep -q "online"; then
    echo "✅ GestionPBI Backend reiniciado correctamente"
    
    # Verificar puerto correcto
    PORT_INFO=$(pm2 info gestionpbi-backend | grep "exec cwd" | grep "gestionpbi")
    if [[ -n "$PORT_INFO" ]]; then
        echo "✅ Ejecutándose desde el directorio correcto"
    else
        echo "❌ ADVERTENCIA: El proceso podría estar ejecutando el código equivocado"
    fi
    
    echo ""
    echo "📊 Estado del proceso:"
    pm2 list | grep -E "(name|gestionpbi-backend)"
else
    echo "❌ ERROR: El proceso no inició correctamente"
    echo "   Revisa los logs con: pm2 logs gestionpbi-backend --lines 20"
    exit 1
fi

echo "============================================"
echo "🎯 URL: https://gestionpbi.lat"
echo "📝 Logs: pm2 logs gestionpbi-backend"

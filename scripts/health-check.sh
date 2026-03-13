#!/bin/bash
# Script para validar que todos los servicios están corriendo correctamente
# Uso: ./scripts/health-check.sh

echo "🏥 Health Check - Verificación de Servicios"
echo "============================================"
echo ""

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

echo "📦 PM2 Processes:"
echo "----------------"

# Verificar GestionPBI Backend
if pm2 list | grep "gestionpbi-backend" | grep -q "online"; then
    GESTIONPBI_CWD=$(pm2 info gestionpbi-backend 2>/dev/null | grep "exec cwd" | awk '{print $NF}')
    if [[ "$GESTIONPBI_CWD" == *"gestionpbi"* ]]; then
        echo -e "${GREEN}✅ GestionPBI Backend${NC} - Online en directorio correcto"
        echo "   Dir: $GESTIONPBI_CWD"
        echo "   Puerto esperado: 3051"
    else
        echo -e "${RED}❌ GestionPBI Backend${NC} - DIRECTORIO INCORRECTO"
        echo "   Dir actual: $GESTIONPBI_CWD"
        echo "   Dir esperado: /var/www/gestionpbi/backend"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}❌ GestionPBI Backend${NC} - NO ESTÁ CORRIENDO"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# Verificar Gestion de Pedidos Backend  
if pm2 list | grep "gestion-backend" | grep -q "online"; then
    PEDIDOS_CWD=$(pm2 info gestion-backend 2>/dev/null | grep "exec cwd" | awk '{print $NF}')
    if [[ "$PEDIDOS_CWD" == *"gestion_de_pedidos"* ]]; then
        echo -e "${GREEN}✅ Gestion de Pedidos Backend${NC} - Online en directorio correcto"
        echo "   Dir: $PEDIDOS_CWD"
        echo "   Puerto esperado: 3001"
    else
        echo -e "${RED}❌ Gestion de Pedidos Backend${NC} - DIRECTORIO INCORRECTO"
        echo "   Dir actual: $PEDIDOS_CWD"
        echo "   Dir esperado: /var/www/gestion_de_pedidos/backend"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${YELLOW}⚠️  Gestion de Pedidos Backend${NC} - No está corriendo (puede ser intencional)"
fi

echo ""
echo "🌐 Verificación de Puertos:"
echo "----------------"

# Verificar puerto 3051 (GestionPBI)
if lsof -i:3051 > /dev/null 2>&1; then
    PROCESS_3051=$(lsof -i:3051 | grep LISTEN | awk '{print $1}' | head -1)
    echo -e "${GREEN}✅ Puerto 3051${NC} - En uso por: $PROCESS_3051"
else
    echo -e "${RED}❌ Puerto 3051${NC} - NO ESTÁ EN USO (GestionPBI debería estar aquí)"
    ERRORS=$((ERRORS + 1))
fi

# Verificar puerto 3001 (Gestion de Pedidos)
if lsof -i:3001 > /dev/null 2>&1; then
    PROCESS_3001=$(lsof -i:3001 | grep LISTEN | awk '{print $1}' | head -1)
    echo -e "${GREEN}✅ Puerto 3001${NC} - En uso por: $PROCESS_3001"
else
    echo -e "${YELLOW}⚠️  Puerto 3001${NC} - No está en uso"
fi

echo ""
echo "============================================"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ Todo está funcionando correctamente${NC}"
    exit 0
else
    echo -e "${RED}❌ Se encontraron $ERRORS error(es)${NC}"
    echo ""
    echo "Comandos para arreglar:"
    echo "  - GestionPBI: ./scripts/restart-gestionpbi.sh"
    echo "  - Ver logs: pm2 logs gestionpbi-backend --lines 50"
    exit 1
fi

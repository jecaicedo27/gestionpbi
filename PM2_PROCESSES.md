# ⚠️ CONFIGURACIÓN PM2 - NOMBRES CLAROS

## 🎯 REGLA #1: Nombres Completamente Diferentes

✅ **`popping-backend`** = MRP Popping Boba (Este workspace)  
✅ **`perlas-backend`** = Gestión de Perlas (NO TOCAR)

**IMPOSIBLE confundirlos ahora.** 🎉

---

## 🍿 MRP Popping Boba (ESTE WORKSPACE)

- **Proceso PM2**: `popping-backend`
- **URL**: https://gestionpbi.lat  
- **Directorio**: `/var/www/gestionpbi`
- **Puerto**: `3051`
- **DB**: PostgreSQL `gestionpbi`

### Comandos (en nuevas terminales):

```bash
popping-restart    # Reiniciar backend
popping-logs       # Ver logs
popping-health     # Verificar salud
popping-build      # Construir frontend
popping-status     # Info PM2
```

### Scripts (siempre funcionan):

```bash
bash scripts/restart-gestionpbi.sh
bash scripts/health-check.sh
```

---

## 💎 Gestión de Perlas (NO TOCAR)

- **Proceso PM2**: `perlas-backend`
- **URL**: https://gestionperlas.app
- **Directorio**: `/var/www/gestion_de_pedidos`
- **Puerto**: `3001`
- **DB**: MySQL

### Si necesitas (raro):

```bash
perlas-restart
perlas-logs
```

---

## 🚨 NUNCA USES ESTOS COMANDOS

❌ `pm2 restart gestion-backend` (ya no existe)  
❌ `pm2 restart gestionpbi-backend` (ya no existe)  
❌ `pm2 restart 28` o `pm2 restart 29` (los IDs cambian)

**USA**: `popping-restart` o `perlas-restart`

---

## 📋 Checklist Rápido

1. ✅ ¿Necesitas reiniciar Popping Boba? → `popping-restart`
2. ✅ ¿Ver logs? → `popping-logs`
3. ✅ ¿Verificar todo? → `popping-health`
4. ✅ ¿Build frontend? → `popping-build`

---

## 🔧 Instalar Aliases (Primera Vez)

```bash
cat /var/www/gestionpbi/.bashrc_aliases >> ~/.bashrc
source ~/.bashrc
```

---

## 🆘 Troubleshooting

### Puerto 3051 ocupado
```bash
lsof -i:3051
# Si dice "popping", está bien
popping-restart
```

### Directorio incorrecto
```bash
pm2 info popping-backend | grep "exec cwd"
# Debe decir: /var/www/gestionpbi/backend
```

### Proceso caído
```bash
cd /var/www/gestionpbi/backend
pm2 start ecosystem.config.js
pm2 save
```

---

## 📊 Verificación Rápida

```bash
pm2 list
# Deberías ver:
# - popping-backend (online)
# - perlas-backend (online)
# - rpa-worker (online)
```

---

**Última actualización**: 2025-12-25 - Renombrados a `popping` y `perlas` para claridad total

# 🎯 Solución Profesional: Gestión de Múltiples Backends

## Problema ResuelTo
- ✅ Scripts automatizados con validaciones
- ✅ Aliases para evitar confusiones  
- ✅ Health checks automáticos
- ✅ Documentación clara y concisa

## 🚀 Uso Rápido

### Para GestionPBI (ESTE proyecto):

En una nueva terminal, los alias estarán disponibles:
```bash
pbi-restart    # Reiniciar backend
pbi-logs       # Ver logs
pbi-health     # Verificar salud
pbi-build      # Construir frontend
```

### Alternativa (sin aliases):

```bash
# Reiniciar de forma segura
bash /var/www/gestionpbi/scripts/restart-gestionpbi.sh

# Health check
bash /var/www/gestionpbi/scripts/health-check.sh
```

## 📁 Archivos Creados

1. **`scripts/restart-gestionpbi.sh`** - Reinicio seguro con validaciones
2. **`scripts/health-check.sh`** - Verificación completa del sistema
3. **`.bashrc_aliases`** - Aliases para comandos rápidos
4. **`PM2_PROCESSES.md`** - Documentación actualizada

## ✅ Beneficios

- **Sin confusión**: Los comandos tienen prefijos claros (`pbi-` vs `pedidos-`)
- **Validaciones automáticas**: Los scripts verifican el directorio antes de ejecutar
- **Rollback rápido**: Si algo falla, los scripts lo detectan
- **Portable**: Los scripts funcionan sin importar dónde los ejecutes

## 🔄 Workflow Recomendado

```bash
# 1. Antes de trabajar
bash scripts/health-check.sh

# 2. Hacer cambios en código

# 3. Si modificaste backend
bash scripts/restart-gestionpbi.sh

# 4. Si modificaste frontend  
cd frontend && npm run build

# 5. Verificar que todo funciona
bash scripts/health-check.sh
```

## 📝 Notas Importantes

- Los aliases solo funcionan en **nuevas sesiones** de terminal
- Los scripts funcionan **siempre**, sin necesidad de aliases
- Guarda `PM2_PROCESSES.md` abierto como referencia

---

**Última actualización**: 2025-12-25

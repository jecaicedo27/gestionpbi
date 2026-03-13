# 🚨 APP CONTEXT - READ THIS FIRST 🚨

## THIS WORKSPACE: **GestionPBI**
- **Domain**: `https://gestionpbi.lat`
- **Path**: `/var/www/gestionpbi`
- **Backend Port**: `3051`
- **PM2 Process**: `popping-backend`
- **Repo/Folder**: `gestionpbi`

---

## ⛔ IGNORE / DO NOT TOUCH ⛔
- **Other App**: `gestionperlas.app` (`appperlas.online`)
- **Other Path**: `/var/www/gestion_de_pedidos`
- **Other Port**: `3050`, `3001`
- **Other Process**: `gestion-backend` (ID: 17)

**CRITICAL RULE**: If a user provides logs or URLs for `gestionperlas.app`, **STOP** and verify if you are in the correct workspace. Do not apply fixes here for that application.

---

## 🏭 Production Module

### Data Model Relationships
```
Formula (baseQuantity, baseUnit)
  └── FormulaItem (quantity per baseQuantity batch)

AssemblyTemplate → stages
  └── AssemblyNote (targetQuantity)
       └── AssemblyNoteItem (plannedQuantity per 1 unit)

ProductionBatch
  └── AssemblyNote[]
```

### ⚠️ CRITICAL: Ingredient Scaling Formula
The `plannedQuantity` in `AssemblyNoteItem` represents the amount needed for **1 production unit** (which equals the formula's `baseQuantity`).

**Correct scaling:**
```
scaledQuantity = plannedQuantity × (targetGrams / formula.baseQuantity)
```

**Example** — BASE LIQUIPOPS (formula base = 120,000g):
- AZUCAR `plannedQuantity` = 4,002g (for 120,000g of product)
- To produce 240,000g → `4002 × (240,000 / 120,000)` = **8,004g**
- To produce 1,200,000g → `4002 × (1,200,000 / 120,000)` = **40,020g**

**DO NOT** multiply `plannedQuantity × targetQuantity` directly — this ignores the base formula size.

### RPA Queue (Siigo Assembly Bot)
- **Singleton**: `siigoBrowserManager.js` — keeps 1 browser open with Siigo session
- **Queue**: FIFO, sequential processing (never parallel)
- **Auto-login**: Re-authenticates if session expires
- **Controller**: `rpaController.js` enqueues tasks, retry updates same DB record
- **Endpoint**: `GET /api/rpa/queue-status` for monitoring


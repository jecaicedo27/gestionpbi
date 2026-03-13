# Convenciones del Sistema de Ensamble de Producción

> ⚠️ **Leer antes de modificar `assemblyService.js`, `assemblyNoteController.js` o cualquier script que cree/modifique templates.**

---

## Cómo se almacenan los ingredientes de una plantilla

### Regla: `quantityPerUnit` = gramos ABSOLUTOS por lote

Cada input de una etapa (`assemblyTemplateStageInput.quantityPerUnit`) almacena la **cantidad absoluta del ingrediente necesaria para producir UN lote completo**.

| Ingrediente | `quantityPerUnit` | Significado |
|---|---|---|
| AGUA | `48000` | 48,000 gramos por 1 lote BASE LIQUIPOPS |
| AZUCAR | `4002` | 4,002 gramos por 1 lote |
| ALGINATO PREPARADO | `736` | 736 gramos por 1 lote de 2,500g esferas |
| COMPUESTO FRESA | `2250` | 2,250 gramos por 1 lote de 2,500g esferas |

### ❌ Lo que NO se debe hacer

**NUNCA** guardar ratios (fracciones entre 0 y 1) en `quantityPerUnit`, por ejemplo:
```
// MAL — ratio que depende de targetQuantity en gramos
quantityPerUnit: 48000 / 120000  // = 0.4
```
Esto obliga a que `targetQuantity` sea el peso en gramos del batch (ej. 120,000g), 
y la multiplicación `0.4 × 120000 = 48000` parece correcta en ese contexto, 
pero rompe todo cuando `targetQuantity` viene de otro campo (como `batch.expectedOutput × 1000`).

---

## Cómo se calcula `plannedQuantity`

```js
// assemblyService.js (y assemblyNoteController.js quickStart)
const targetQuantity = 1;  // 1 lote de producción
const plannedQuantity = input.quantityPerUnit * targetQuantity;
// = 48000 × 1 = 48,000g ✓
```

**`targetQuantity` SIEMPRE debe ser `1`** (un lote). Si el operario quiere 2 lotes, el sistema multiplica automáticamente.

### ❌ El bug que se introdujo (y se corrigió el 2026-03-01)

```js
// ANTES (INCORRECTO) — assemblyService.js línea 85:
const targetQuantity = (batch.expectedOutput || batch.baseWeight || 0) * 1000;
// batch.expectedOutput = 14,160.24 kg → targetQuantity = 14,160,240g
// plannedQuantity = 48000 × 14,160,240 = 679,691,520,000g ← TOTALMENTE MAL
```

Este código existía en el sistema desde el inicio y convirtió el peso del batch en gramos como `targetQuantity`. Al combinarlo con `quantityPerUnit` en gramos absolutos, el resultado fue billones de gramos.

---

## Diagrama del flujo correcto

```
Template Stage Input
  quantityPerUnit = 48000 (gramos absolutos por 1 lote)
        ↓
assemblyService.generateNotesForBatch()
  targetQuantity = 1 (un lote)
  plannedQuantity = 48000 × 1 = 48,000g
        ↓
AssemblyNoteItem
  plannedQuantity = 48000 ✓
        ↓
Wizard UI
  AGUA: 48,000 gramo ✓
```

---

## Recalculación en vivo para baches PENDIENTES

`assemblyNoteController.getNoteById()` recalcula `plannedQuantity` en tiempo real para notas con `status = 'PENDING'`:

```js
// Si la nota está pendiente, usa los valores ACTUALES del template
plannedQuantity = currentTemplate.quantityPerUnit × note.targetQuantity
```

Esto permite que cambios en una plantilla se propaguen automáticamente a baches programados no ejecutados todavía.

**Las notas COMPLETADAS o EN EJECUCIÓN** conservan sus valores históricos para trazabilidad de auditoría.

---

## Resumen de archivos críticos

| Archivo | Rol | Riesgo de cambio |
|---|---|---|
| `assemblyService.js` línea ~85 | Define `targetQuantity = 1` | 🔴 Alto — no cambiar a gramos de batch |
| `assemblyNoteController.js` `quickStart` | Misma lógica | 🔴 Alto |
| `assemblyTemplateStageInput.quantityPerUnit` | Gramos absolutos por lote | 🟡 Medio — no convertir a ratios |
| `assemblyNoteController.js` `getNoteById` | Recalculo en vivo PENDING | 🟢 Bajo |

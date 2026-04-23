# Cambios Pendientes para Migrar a Nueva Version
**Fecha:** 2026-04-18  
**Rama git de respaldo:** `changes-2026-04-18` (commit `140ae9f`)  
**Base:** commit `926eaf3` en main

---

## PROMPT PARA REAPLICAR CAMBIOS

Cuando recibas la nueva version del equipo de desarrollo el lunes, usa el siguiente prompt con Claude Code:

---

```
Necesito reaplicar los siguientes cambios criticos que se hicieron entre el 14 y 18 de abril de 2026 y que se perdieron al recibir una nueva version del codigo. La rama `changes-2026-04-18` tiene el commit completo como referencia. Aplicar cada cambio verificando que los archivos destino aun existen y adaptando si la estructura cambio.

## CAMBIO 1: IntroStep — PROGRAMADO muestra valor original, no el sobreescrito

**Archivo:** `frontend/src/components/AssemblyRunner/steps/IntroStep.jsx`

**Problema:** Despues del CONTEO, `batch_output_targets.plannedUnits` se sobreescribe con `actualUnits` (en assemblyService.js:905). Esto hacia que PROGRAMADO mostrara el valor real (ej: 66) en vez del planificado original (ej: 60).

**Fix:** Cambiar la prioridad para preferir `conteoEntry?.planned` sobre `target.plannedUnits`:

Buscar donde se calcula `planned` para cada target (cerca de linea 370-380):
- ANTES: `const planned = (target.plannedUnits > 0 ? target.plannedUnits : undefined) ?? conteoEntry?.planned ?? ...`
- DESPUES: `const planned = conteoEntry?.planned ?? empRef.planned_qty ?? empData.planned_qty ?? (target.plannedUnits > 0 ? target.plannedUnits : undefined) ?? null;`

Tambien donde se muestra en la tabla resumen (cerca de linea 598):
- ANTES: `t.plannedUnits ?? ce?.planned`
- DESPUES: `ce?.planned ?? t.plannedUnits`


## CAMBIO 2: MarcadoCajasStep — Rediseno completo de Caja Pendiente

**Archivo:** `frontend/src/components/AssemblyRunner/steps/MarcadoCajasStep.jsx`

**Problema:** El operario no validaba si habia cajas pendientes por completar antes de imprimir etiquetas.

**Cambios clave:**

### 2a. Nuevos estados (reemplazar los anteriores de pendingBox):
```javascript
const [pendingAnswer, setPendingAnswer] = useState(null); // null | 'yes' | 'no'
const [pendingCurrentUnits, setPendingCurrentUnits] = useState(''); // uds encontradas en la caja
const [pendingConfirmed, setPendingConfirmed] = useState(false);
```

### 2b. Tamano de caja pendiente dinamico segun destino:
```javascript
const pendingBoxSize = destino === 'maquila' ? MAQUILA_UNITS_PER_BOX : defaultUnitsPerBox;
```

### 2c. Calculo de unidades a llenar en caja pendiente:
```javascript
const pendingNeeds = (pendingAnswer === 'yes' && pendingConfirmed && pendingCurrentUnits !== '')
    ? Math.max(0, pendingBoxSize - Number(pendingCurrentUnits)) : 0;
const pendingFillQty = (!isWeightBased && destino && pendingNeeds > 0)
    ? Math.min(pendingNeeds, destino === 'maquila' ? maquilaNum : packableUnits) : 0;
```

### 2d. IMPORTANTE — Orden de declaracion:
`pendingFillQty` DEBE declararse ANTES de la distribucion de maquila que lo usa:
```javascript
const maquilaNewUnits = destino === 'maquila' ? Math.max(0, maquilaNum - pendingFillQty) : maquilaNum;
```
Si `pendingFillQty` se declara despues, causa crash: `ReferenceError: Cannot access 'X' before initialization`

### 2e. Validacion dividida:
```javascript
const distributionValid = destinoSelected && (...); // para mostrar resumen de impresion
const pendingBoxResolved = isWeightBased || !destino || pendingAnswer === 'no' || (pendingAnswer === 'yes' && pendingConfirmed);
const isValid = distributionValid && pendingBoxResolved; // para habilitar boton imprimir
```

### 2f. Reset al cambiar destino:
```javascript
// Dentro del useEffect de destino:
setPendingAnswer(null);
setPendingCurrentUnits('');
setPendingConfirmed(false);
```

### 2g. Flujo UI — pregunta primero:
1. Pregunta con 2 botones grandes: "Ves alguna caja abierta/incompleta?" SI / NO
2. Si SI: input grande (w-32 text-2xl font-black) para cuantas uds tiene, con boton Confirmar
3. Si NO: resumen verde de que no hay pendientes
4. Solo despues aparece la configuracion de impresion
5. El resumen de impresion usa `distributionValid` (no `isValid`)

### 2h. Maquila print summary:
En el resumen de impresion de maquila, usar `maquilaBoxSize` (no `unitsPerBox`) para mostrar "CANT: NxM uds":
```javascript
// ANTES: `${maquilaFullBoxes}x${unitsPerBox}`
// DESPUES: `${maquilaFullBoxes}x${maquilaBoxSize}`
```

### 2i. Input sin bug del "022":
El input de unidades pendientes debe manejar string vacio correctamente:
- onChange: guardar el valor como string, no convertir a 0
- onFocus: `e.target.select()` para seleccionar todo al tocar
- Validar `pendingCurrentUnits !== ''` antes de calcular


## CAMBIO 3: AssemblyExecutionWizard — Bloqueo obligatorio de impresion

**Archivo:** `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx`

**Problema:** El operario podia saltarse la impresion de etiquetas con un Modal.confirm.

**Fix:** Cambiar Modal.confirm por Modal.warning que bloquea el avance:
```javascript
if (!marcadoCajas.printed && marcadoCajas.totalCajas > 0) {
    Modal.warning({
        title: 'Debes imprimir las etiquetas',
        content: 'No puedes avanzar sin imprimir las etiquetas primero. Presiona el boton de imprimir antes de continuar.',
        okText: 'Entendido',
    });
    return;
}
```

### 3b. Estado `printed` expuesto via onMarcadoChange:
MarcadoCajasStep debe pasar `printed` en el callback onMarcadoChange para que el wizard lo lea:
```javascript
onMarcadoChange({ ..., printed: printed })
```


## CAMBIO 4: FinishedProductZonePage — Fix "0 rotulo" y fecha vencimiento

**Archivo:** `frontend/src/pages/FinishedProductZonePage.jsx`

### 4a. Bug "0 rotulo":
El nullish coalescing `??` no trata `0` como null, entonces cuando el API devuelve `approved: 0`, las etiquetas calculan 0 unidades aprobadas.

Buscar TODAS las ocurrencias de:
```javascript
printModal.approved ?? totalUnits
```
Y reemplazar por:
```javascript
(printModal.approved > 0) ? printModal.approved : totalUnits
```
Hay 3 ocurrencias: en el onOk handler, en el render body, y en el texto de aprobadas/defectuosas.

### 4b. Fecha de vencimiento en etiquetas:
Agregar `expiresAt: lot?.expiresAt || ''` a TODOS los llamados de `buildLotLabel()` y `buildLotLabelZPL()` dentro del modal de impresion (4 llamados: 2 para labels normales, 2 para NC labels, tanto en modo network como bluetooth).


## CAMBIO 5: Geniality pre-CONTEO RPA fix (CRITICO para Siigo)

**Archivos:**
- `frontend/src/components/AssemblyRunner/hooks/useAssemblyNote.js`
- `frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx`

**Problema:** Productos intermedios de Geniality (SABORIZACION, BASE SIROPE) con nota "Ensamble Siigo" antes del CONTEO eran tratados igual que las notas post-CONTEO: se les ponia `skipRpa: true` y se deferían al CONTEO. Resultado: el RPA nunca disparaba y el producto intermedio no se registraba en Siigo, causando balances negativos.

### 5a. useAssemblyNote.js (cerca de linea 80-115):
Cuando se detecta `isEnsambleSiigo` y hay `productionBatchId`, buscar la nota CONTEO y verificar si esta nota es pre-CONTEO:

```javascript
const isPreConteo = conteoNote && (data.stageOrder || 0) < (conteoNote.stageOrder || 0);
```

Si `isPreConteo === true`: la nota se completa inmediatamente SIN `skipRpa` (el RPA dispara normalmente).
Si `isPreConteo === false`: comportamiento original (defer al CONTEO, poner skipRpa).

IMPORTANTE: Este check solo aplica a `G_ENSAMBLE` (Geniality), no a `ENSAMBLE` (Liquipops). El hook es compartido por ambos wizards.

### 5b. GenialityExecutionWizard.jsx (cerca de linea 1095-1125):
En el auto-completado post-CONTEO, cuando se completan las notas "Ensamble Siigo" pendientes:
- Solo poner `skipRpa: true` en notas con `stageOrder > CONTEO.stageOrder`
- Notas con `stageOrder < CONTEO.stageOrder` (pre-CONTEO) se completan SIN skipRpa

```javascript
const isPreConteo = esNote.stageOrder < currentNote.stageOrder;
if (!isPreConteo) {
    // Solo post-CONTEO recibe skipRpa
    await api.patch(`/assembly-notes/${esNote.id}`, {
        processParameters: { ...existing, skipRpa: true }
    });
}
```

**Logica clave:** Liquipops (ENSAMBLE) y Geniality (G_ENSAMBLE) son lineas separadas. Los fixes de Geniality NUNCA deben afectar Liquipops.


## CAMBIO 6: ConteoStep — Targets extra del operario

**Archivo:** `frontend/src/components/AssemblyRunner/steps/ConteoStep.jsx`

Los operarios pueden agregar presentaciones extra (tamanos no programados) durante el conteo. Se gestionan con `extraConteoTargets` state en el wizard, y se persisten en `processParameters.extra_conteo_targets`.


## OTROS CAMBIOS IMPORTANTES (backend y frontend)

Estos cambios son mas amplios y pueden requerir merge manual. Revisar la rama `changes-2026-04-18` para los diffs exactos:

### Backend:
- **Prisma schema:** Nuevas migraciones para attendance y shift handover modules
- **Controllers actualizados:** analytics, assemblyNote, auth, formula, geniality, inventory, lot, order, productionScheduler, purchaseOrder, rpa, shift, shiftHandoff, user, zoneTransfer
- **Nuevos controllers:** attendance, forensicRecovery, shiftHandover
- **Nuevos services:** packageLabel, pinValidation, productPackOption, shiftEmployeeSync, shiftHandover
- **Rutas nuevas:** attendance, forensicRecovery, shiftHandover + cambios en existentes
- **Siigo browser manager:** cambios significativos en la automatizacion

### Frontend:
- **Nuevas paginas:** AttendancePage, ForensicRecoveryPage
- **Nuevos componentes:** ShiftHandover/ (7 componentes), UnassignedBulkIngressModal
- **Componentes actualizados:** ShiftBlockScreen, GlobalTimerAlert, BottomNavBar, Sidebar, Layout
- **Paginas actualizadas:** HandoffsPage, Inventory, InventoryCountPage, OrderManagement, ProductionOperatorPage, ProductionScheduler, PurchaseOrdersPage, ShiftSchedulePage, admin/Users
- **Inventory modals:** LotManagementModal y ProductAnalysisModal con cambios grandes
- **ZebraContext:** mejoras en el contexto de impresora
- **Scanner:** scannerParser y scannerSounds actualizados
- **QR/Labels:** qrService y zplLabelBuilder actualizados
```

---

## ESTRATEGIA DE MERGE

1. Recibir la nueva version el lunes
2. Comparar archivos clave usando `git diff changes-2026-04-18 -- <archivo>`
3. Para los 5 cambios criticos (IntroStep, MarcadoCajas, Wizard, FinishedZone, Geniality RPA): aplicar manualmente revisando que la estructura no haya cambiado
4. Para los cambios de backend/nuevos modulos: verificar si el otro equipo toco los mismos archivos
5. Build y probar cada feature

## PRIORIDAD DE APLICACION

1. **CRITICO:** Cambio 5 (Geniality RPA) — sin esto, productos intermedios no se registran en Siigo
2. **ALTO:** Cambio 3 (bloqueo impresion) — operarios saltan impresion
3. **ALTO:** Cambio 2 (caja pendiente) — operarios no validan cajas abiertas
4. **MEDIO:** Cambio 4 (fix 0 rotulo) — reimpresion en zona terminado no funciona
5. **MEDIO:** Cambio 1 (PROGRAMADO) — valor confuso pero no critico
6. **BAJO:** Cambio 6 (targets extra conteo) — nice to have
7. **ALTO:** Cambio 7 (admin ve tabla empaque) — admin puede editar cantidades aunque empaque ya inicio
8. **ALTO:** Cambio 8 (todos los tamanos en batch) — al crear batch, generar output targets para TODOS los tamanos del sabor


## CAMBIO 7: IntroStep — Admin siempre ve tabla de recepcion

**Archivo:** `frontend/src/components/AssemblyRunner/steps/IntroStep.jsx`

**Problema:** Cuando las notas EMPAQUE ya estan COMPLETED/EXECUTING, la tabla de recepcion se oculta. El admin no puede editar cantidades reales.

**Fix:** Cambiar la condicion `showReception` para permitir admin:
```javascript
// ANTES:
const showReception = !empaqueReceptionConfirmed && !anyEmpaqueStarted && !hasCarriotsSystem;
// DESPUES:
const showReception = !empaqueReceptionConfirmed && (!anyEmpaqueStarted || isAdmin) && !hasCarriotsSystem;
```


## CAMBIO 8: Crear TODOS los tamanos al crear batch (PENDIENTE — backend)

**Archivo:** `backend/src/controllers/productionSchedulerController.js` (funcion `createBatch`)

**Problema:** Al crear un batch, solo se generan outputTargets para los tamanos programados (ej: 350g y 3400g). Si el operario produce un tamano extra (ej: 1100g), no hay nota EMPAQUE para ese tamano y no se puede registrar.

**Solucion requerida:**
1. En `createBatch`, despues de crear los outputTargets del mix programado, buscar TODOS los productos del mismo sabor/grupo que no esten en el mix
2. Crear outputTargets adicionales con `plannedUnits: 0` para esos tamanos
3. El template de assembly notes debe generar notas EMPAQUE para TODOS los outputTargets (incluidos los de qty 0)
4. En la UI de IntroStep, esos tamanos aparecen con PROGRAMADO=0 y el operario solo edita REAL

**Ejemplo:** Batch MANZANA VERDE programado con 350g(250) y 3400g(100). El sistema debe tambien crear outputTargets para 1100g(0), 500g(0), etc. — todos los tamanos de MANZANA VERDE que existan como productos.

**Beneficio:** El operario nunca necesita "agregar" una presentacion — solo edita la cantidad de 0 al valor real.


---

## CAMBIOS 19-20 DE ABRIL 2026 (post-documento original)

Los siguientes cambios se hicieron después del corte del 18 de abril y también deben reaplicarse sobre la nueva versión.


## CAMBIO 9: Guía de transporte — respetar packingMode EVEREST

**Archivo:** `backend/src/controllers/orderControllerExtensions.js` (función `getTransportGuide`)

**Problema:** La guía de transporte siempre calculaba cajas usando `packSize` del producto, ignorando que pedidos EVEREST (maquila) usan cajas de 6 unidades. El picking calculaba bien pero la guía impresa mostraba un número incorrecto de cajas.

**Fix:** Agregar helper `getUnitsPerBox(item)` que retorna 6 si `order.packingMode === 'EVEREST'`, o el `packSize` normal si no. Reemplazar las 3 ocurrencias donde se calculaba `unitsPerBox` manualmente (rows, totalBoxes, catSummary):
```javascript
const getUnitsPerBox = (item) => {
    if (order.packingMode === 'EVEREST') return 6;
    return (item.product?.packSize && item.product.packSize > 1) ? item.product.packSize : 1;
};
```


## CAMBIO 10: Sidebar — CONTABILIDAD puede ver Inventario

**Archivo:** `frontend/src/components/common/Sidebar.jsx`

**Fix:** Agregar `'CONTABILIDAD'` al array de roles de la entrada de Inventario:
```javascript
// ANTES:
roles: ['ADMIN', 'PRODUCCION', 'CARTERA', 'LOGISTICA', 'OPERARIO_PICKING', 'QUIMICO']
// DESPUES:
roles: ['ADMIN', 'PRODUCCION', 'CARTERA', 'LOGISTICA', 'OPERARIO_PICKING', 'QUIMICO', 'CONTABILIDAD']
```


## CAMBIO 11: Config — batchDuration y geniality_batchDuration separados

**Archivos:**
- `backend/src/controllers/configController.js`
- `frontend/src/pages/AdminConfig.jsx`

**Problema:** Liquipops y Geniality compartían `batchDuration`. Ahora cada línea tiene su valor por defecto.

**Fix backend (configController.js):** Defaults cambiados:
- `batchDuration`: 140 → **90** (Liquipops)
- Nuevo campo: `geniality_batchDuration: 240` (Geniality)

**Fix frontend (AdminConfig.jsx):** Default en `getDefaultVal`:
```javascript
// ANTES: batchDuration default = geniality ? 160 : 140
// DESPUES: batchDuration default = geniality ? 240 : 90
```


## CAMBIO 12: ProductionScheduler — Cambio de agua automático cada 2 batches

**Archivos:**
- `frontend/src/pages/ProductionScheduler.jsx`
- `backend/src/controllers/productionSchedulerController.js`

### 12a. Frontend — Duración por línea:
```javascript
// ANTES:
const DURATION = config.batchDuration || (activeLine === 'geniality' ? 160 : 140);
// DESPUES:
const DURATION = activeLine === 'geniality' ? (config.geniality_batchDuration || 240) : (config.batchDuration || 90);
```

### 12b. Frontend — Auto water change:
Al crear batches de Liquipops, insertar automáticamente un evento "CAMBIO DE AGUA" (30 min) cada 2 batches de producción. Cuenta batches previos en el calendario (misma sesión, max 3h gap) para saber cuándo toca.

### 12c. Frontend — Bloque duplicado suggestedBatches:
Hay un bloque `if (res.data.suggestedBatches...)` duplicado. El primero incluye demandData y scheduledPendingKg, el segundo es el original. El primero es el correcto.

### 12d. Backend — Cálculo de batches mejorado (calculateBatchMix):
- **Déficit usa effectiveStock:** `effectiveStock = totalStock - orderDemand + inProgress` (antes no restaba orders ni sumaba inProgress)
- **Batches siempre par:** `if (batchesNeeded > 1 && batchesNeeded % 2 !== 0) batchesNeeded++` (optimizar ciclos de agua)
- **Distribución proporcional de extras:** Batches extras entre grupo A y B se distribuyen proporcionalmente al déficit (antes todos iban a B)
- **Grupo A/B basados en déficit:** `groupADeficitKg` / `groupBDeficitKg` reemplazan cálculos basados en `minUnits`
- **Track remaining deficit:** `mediumDeficitLeft` para distribuir producción acorde al déficit restante por batch


## CAMBIO 13: InventoryCountPage — Alineación de inventario con Siigo

**Archivos:**
- `frontend/src/pages/InventoryCountPage.jsx`
- `backend/src/controllers/inventoryCountController.js`
- `backend/src/routes/inventoryCountRoutes.js`

### 13a. Backend — Nuevos endpoints:
- `POST /api/inventory-count/sessions/:id/reconcile-product` — Alinea stock en BD con conteo físico (solo ADMIN)
- `GET /api/inventory-count/account-codes` — Lista códigos contables de Siigo

### 13b. Backend — reconcileProduct:
Compara líneas de conteo físico vs `FinishedLotStock`, resta unidades ya en picking, y genera ajuste RPA en Siigo si hay diferencia.

### 13c. Frontend — Nuevos estados y funcionalidades:
- `accountCodes`, `adjustmentState`, `siigoModal`, `otherZoneCounts`
- Polling automático de estado RPA para ajustes en curso
- Carga de conteos de otras zonas del mismo mes (cross-zone counts)
- Carga de RPAs de ajuste existentes al abrir sesión (evita duplicados)
- Mapa `REQUIRED_ZONES` por código de cuenta Siigo (qué zonas deben contarse)


## CAMBIO 14: assemblyService + genialityAssemblyService — CONTEO no sobreescribe plannedUnits

**Archivos:**
- `backend/src/services/assemblyService.js`
- `backend/src/services/genialityAssemblyService.js`

**Problema:** Al completar CONTEO, `plannedUnits` se sobreescribía con `actualUnits`, perdiendo el valor original programado.

**Fix:** Solo actualizar `actualUnits`, no `plannedUnits`. Para targets nuevos (no planificados), crear con `plannedUnits: 0`:
```javascript
// ANTES: data: { plannedUnits: actualUnits, actualUnits: actualUnits }
// DESPUES: data: { actualUnits: actualUnits }
// Para nuevos: plannedUnits: 0 (no actualUnits)
```

### 14b. Cantidad del RPA usa actualQuantity primero:
```javascript
// ANTES: const qty = result.targetQuantity || actualQuantity;
// DESPUES: const qty = actualQuantity || result.targetQuantity;
```

### 14c. Duplicate RPA guard mejorado (assemblyService):
Buscar RPA existente por `assemblyNoteId` en vez de buscar por substring en `observations` y `productName` (más preciso, menos falsos positivos).


## CAMBIO 15: rpaController — Mejoras en ajustes y notas huérfanas

**Archivo:** `backend/src/controllers/rpaController.js`

### 15a. Sync Siigo post-ajuste:
Después de un ajuste exitoso, ejecutar `siigoService.syncAllProducts()` para sincronizar inventario.

### 15b. Orphan notes — filtrar notas EMPAQUE cubiertas:
En `getOrphanNotes`, excluir notas EMPAQUE que ya tienen un sibling ENSAMBLE con RPA exitoso (evita mostrar falsos huérfanos).


## CAMBIO 16: GenialityExecutionWizard — Datos extra en MARCADO_CAJAS

**Archivo:** `frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx`

**Fix:** Al guardar datos de marcado de cajas, incluir campos adicionales:
- `maquila_qty`, `destino`, `etiquetas_impresas` en processParameters
- Mensaje de error dinámico: `marcadoCajas.invalidReason` en vez de mensaje fijo


## CAMBIO 17: index.css — Calendar visual improvements

**Archivo:** `frontend/src/index.css`

Mejoras visuales para el calendario de producción en tablets:
- `min-width: 1400px` para scroll horizontal
- Time gutter: 60px, font 12px bold
- Time slots: `min-height: 80px` (más alto para touch)
- Events: `min-height: 28px`, font 12px, sin sombra, texto visible completo


## PRIORIDAD DE CAMBIOS 19-20 ABRIL

1. **CRITICO:** Cambio 14 (CONTEO no sobreescribe plannedUnits) — afecta reportes y Siigo
2. **CRITICO:** Cambio 12 (scheduler + water change) — toda la programación de producción
3. **ALTO:** Cambio 13 (alineación inventario) — funcionalidad nueva completa
4. **ALTO:** Cambio 15 (RPA orphan fix + sync) — evita duplicados y mantiene Siigo al día
5. **MEDIO:** Cambio 9 (guía EVEREST) — cajas incorrectas en guías de maquila
6. **MEDIO:** Cambio 11 (config duración) — valores default correctos
7. **BAJO:** Cambio 10 (Sidebar CONTABILIDAD) — permiso de vista
8. **BAJO:** Cambio 16 (Geniality marcado extra data) — trazabilidad
9. **BAJO:** Cambio 17 (CSS calendar) — visual only


## CAMBIO 18: Bloqueo de loteo sin factura Siigo (CRITICO)

**Archivos:**
- `frontend/src/pages/PurchaseOrdersPage.jsx`
- `backend/src/controllers/receptionController.js`

**Problema:** Logística podía crear lotes de materia prima sin que contabilidad hubiera registrado la factura del proveedor en Siigo. Esto genera descuadre: lotes en BD local que no existen en Siigo, y al consumirlos Siigo queda en negativo.

### 18a. Frontend — Banner de alerta en pestaña Lotes:
Si la OC tiene recepciones pero sin `siigoRef`, mostrar banner rojo:
> ⛔ Loteo bloqueado — Factura pendiente en Siigo
> Solicita al área de Contabilidad que registre la factura del proveedor en Siigo antes de crear lotes.

Si no tiene recepciones, mostrar banner naranja: "Sin recepción registrada".

### 18b. Frontend — Botón "Registrar Lotes" deshabilitado:
En la sección de productos pendientes de loteo, el botón cambia a "⏳ Pendiente Siigo" (disabled) con tooltip explicativo cuando no hay `siigoRef`.

### 18c. Frontend — Validación en submitLots:
Variable `orderHasSiigo` verifica que todas las recepciones tengan `siigoRef`. Si no, `submitLots` muestra error y no envía.

### 18d. Backend — Validación en createLots (receptionController.js):
Antes de crear lotes, consulta las recepciones de la OC. Si alguna no tiene `siigoRef`, retorna 400:
```javascript
const receptions = orderItem.purchaseOrder?.receptions || [];
if (receptions.length === 0 || receptions.some(r => !r.siigoRef)) {
    return res.status(400).json({ error: 'No se puede lotear sin factura registrada en Siigo...' });
}
```
Requiere include adicional en el findUnique del orderItem:
```javascript
purchaseOrder: { select: { receptions: { select: { siigoRef: true } } } }
```


## CAMBIO 19: IP Zebra centralizada en BD + Auto-Discovery

**Archivos:**
- `backend/src/routes/zebraRoutes.js`
- `frontend/src/context/ZebraContext.jsx`
- `frontend/src/components/common/Layout.jsx`
- `frontend/public/zebra-relay.js`

**Problema:** La IP de la Zebra estaba hardcodeada (`192.168.0.126`) y cada dispositivo la guardaba en localStorage. Cambiar la IP requería actualizarla manualmente en cada tablet/PC.

### 19a. Backend — IP almacenada en SystemSettings (zebraRoutes.js):
- Key `ZEBRA_PRINTER_IP` en tabla `system_settings` (JSON: `{ ip, source, lastSeenAt }`)
- Cache en memoria (60s TTL) para no consultar BD en cada impresión
- `getConfiguredIp()` resuelve: cache → BD → env → fallback hardcoded
- Nuevos endpoints:
  - `GET /api/zebra/config` — retorna IP configurada
  - `PUT /api/zebra/config` — admin cambia IP (una vez, aplica a todos)
  - `POST /api/zebra/report-ip` — relay reporta IP descubierta automáticamente
- Endpoints existentes (`/status`, `/print`) ahora usan `getConfiguredIp()` en vez de constante

### 19b. Frontend — Fetch IP centralizada (ZebraContext.jsx):
- `ZEBRA_IP` renombrado a `FALLBACK_IP` (solo último recurso)
- Al iniciar, si no hay `zebra_manual_ip` en localStorage, fetch `GET /api/zebra/config` y usar esa IP
- Override por dispositivo (`forceIp`) sigue funcionando para casos especiales

### 19c. Frontend — UI Admin (Layout.jsx):
- Nueva sección violeta en el popover de Zebra (solo ADMIN): "IP centralizada (todos los dispositivos)"
- Input + botón "Aplicar" → `PUT /api/zebra/config`
- Cambiar una vez, aplica a todas las tablets al recargar

### 19d. Relay — Reporta IP descubierta (zebra-relay.js):
- Después de auto-discovery TCP:9100, reporta al backend vía `POST /api/zebra/report-ip`
- Si admin fijó IP manualmente (source: "admin"), el reporte se ignora
- Solo se actualiza si source es "discovered" o no existe


## CAMBIO 20: Forecast — Todos los grupos visibles por defecto

**Archivo:** `frontend/src/pages/ForecastPage.jsx`

**Fix:** `defaultActiveKey={groupNames}` en vez de `groupNames.slice(0, 3)`.


## CAMBIO 21: KPI Adherencia al Cronograma (Produccion)

**Archivos:**
- `backend/src/controllers/kpiController.js` — nuevo endpoint `getScheduleAdherence`
- `backend/src/routes/kpiRoutes.js` — nueva ruta `GET /schedule-adherence`
- `backend/src/controllers/assemblyNoteController.js` — agrega `scheduledEnd` al select de getAllNotes
- `frontend/src/pages/ProductionOperatorPage.jsx` — semaforo adherencia en BatchCard
- `frontend/src/pages/ProductionKpiPage.jsx` — seccion dashboard con tabla detallada

### 21a. Backend — Endpoint de adherencia:
`GET /api/production-kpis/schedule-adherence?days=7&line=liquipops|geniality|all`

Calcula por cada bache:
- `adherenceScore = max(0, 100 - (retraso / duracionProgramada) * 100)`
- Tiempo de produccion = `scheduledStart` → `CONTEO.completedAt`
- Para baches en progreso: `projectedAdherence` basado en avance de etapas vs tiempo usado
- Semaforo (trafficLight): green/yellow/red

### 21b. Frontend — Semaforo en tarjeta del operario:
Nuevo componente `AdherenceBadge` calcula en tiempo real (sin API extra):
- Verde "A tiempo": avance >= tiempo usado
- Amarillo "Ajustado": avance cerca del tiempo (dentro de 15%)
- Rojo "Retrasado": avance < tiempo usado - 15%
- Score final al completar CONTEO (ej: "92%")

### 21c. Frontend — Dashboard KPI:
Nueva seccion "Adherencia al Cronograma" al inicio de ProductionKpiPage con:
- Cards: promedio, total baches, a tiempo, retrasados, en curso
- Tabla detallada: bache, linea, programado, real, retraso, score, estado

### 21d. Filtro de visibilidad por rol en ProductionOperatorPage:
OPERARIO_PICKING/EMPAQUE solo ve baches con etapa EMPAQUE/G_EMPAQUE. Procesos auxiliares (Azucar Invertida, Fuente de Calcio, etc.) solo visibles para PRODUCCION.


## CAMBIO 22: Recorrido automatico de baches al cambio de turno

**Archivos:**
- `backend/src/controllers/productionSchedulerController.js` — `reschedulePendingForShift()` + `rescheduleShift()`
- `backend/src/routes/productionSchedulerRoutes.js` — `POST /:line/reschedule-shift`
- `backend/src/server.js` — cron job con `node-cron` a las 6:00, 14:00, 22:00 COT
- `frontend/src/pages/ProductionScheduler.jsx` — boton manual "Recorrer Turno"
- `package.json` — nueva dependencia `node-cron`

### 22a. Backend — Logica de recorrido:
1. Detecta baches no iniciados (sin AssemblyNote.startedAt) de la linea
2. Detecta bache en curso del turno anterior (AssemblyNote.status = EXECUTING)
3. Calcula `inicioReal = max(horaTurno, finBacheEnCurso)` — nunca penaliza al turno nuevo
4. Recorre baches secuencialmente manteniendo duracion original
5. Guarda guardia en SystemSettings para no repetir por turno

### 22b. Cron — Ejecucion automatica:
`node-cron` schedule `'0 6,14,22 * * *'` timezone `America/Bogota`
Ejecuta para ambas lineas (liquipops + geniality).

### 22c. Frontend — Boton manual:
Boton amber "Recorrer Turno" en el toolbar del Programador de Produccion.
Pide hora (prompt) y llama al endpoint. Muestra resultado con baches recorridos e inicio efectivo.

**Archivo:** `frontend/src/pages/ForecastPage.jsx`

**Problema:** El `<Collapse>` de Ant Design usaba `defaultActiveKey={groupNames.slice(0, 3)}`, abriendo solo los 3 primeros grupos. Los demás (MATERIA PRIMA FABRICACION 5%, Productos, MATERIA PRIMA ETIQUETAS Y SELLOS) aparecían cerrados.

**Fix:**
```javascript
// ANTES:
defaultActiveKey={groupNames.slice(0, 3)}
// DESPUES:
defaultActiveKey={groupNames}
```


---

## CAMBIOS 21 DE ABRIL 2026


## CAMBIO 23: Inventory unassignedQty desde MaterialLot/FinishedLotStock (CRITICO)

**Archivos:**
- `backend/src/controllers/inventoryController.js`
- `frontend/src/pages/Inventory.jsx`

**Problema:** El filtro "Sin lote asignado" en inventario validaba contra el JSON `warehouses` que viene de Siigo (una sola bodega). En la aplicación manejamos bodegas y lotes propios en las tablas `MaterialLot` y `FinishedLotStock`, entonces el cálculo no reflejaba la realidad.

### 23a. Backend — Agregación de lotes en getAllProducts (inventoryController.js):
Agregar dos `groupBy` en el `Promise.all` existente:
```javascript
const [replenishmentData, mlAgg, flsAgg] = await Promise.all([
    dataMiningService.getReplenishmentProjection(),
    prisma.materialLot.groupBy({
        by: ['productId'],
        where: { status: { in: ['AVAILABLE', 'LOW_STOCK'] }, productId: { not: null } },
        _sum: { currentQuantity: true },
    }),
    prisma.finishedLotStock.groupBy({
        by: ['productId'],
        where: { status: { in: ['AVAILABLE', 'LOW'] } },
        _sum: { currentQuantity: true },
    }),
]);
```

**OJO con los enums:** MaterialLot usa `LOW_STOCK`, FinishedLotStock usa `LOW`.

Construir `lotStockMap` sumando ambas tablas:
```javascript
const lotStockMap = new Map();
for (const row of mlAgg) {
    lotStockMap.set(row.productId, (lotStockMap.get(row.productId) || 0) + (row._sum.currentQuantity || 0));
}
for (const row of flsAgg) {
    lotStockMap.set(row.productId, (lotStockMap.get(row.productId) || 0) + (row._sum.currentQuantity || 0));
}
```

Agregar campo en el response:
```javascript
unassignedQty: Math.max(0, (p.currentStock || 0) - (lotStockMap.get(p.id) || 0))
```

### 23b. Frontend — Simplificar Inventory.jsx:
Reemplazar el cálculo local (que usaba `warehouses` JSON) por el valor del backend:
```javascript
const getUnassignedQty = (p) => p.unassignedQty || 0;
const unassignedCount = products.filter(p => getUnassignedQty(p) > 0).length;
```


## CAMBIO 24: RPA auto-retry cada 5 minutos con anti-duplicación (CRITICO)

**Archivos:**
- `backend/prisma/schema.prisma` — nuevo campo `autoRetryCount` en RpaExecution
- `backend/src/services/siigoBrowserManager.js` — scheduler de auto-retry
- `backend/src/controllers/rpaController.js` — guardas de estado y filtro de huérfanas

### 24a. Schema — Nuevo campo:
```prisma
model RpaExecution {
    // ... campos existentes ...
    autoRetryCount Int @default(0) @map("auto_retry_count")
}
```
Requiere migración: `npx prisma migrate dev --name add_auto_retry_count`

### 24b. siigoBrowserManager.js — Método `startAutoRetryScheduler()`:
Constantes: `MAX_AUTO_RETRIES = 3`, `INTERVAL_MS = 5 * 60 * 1000`, `LOOKBACK_MS = 30 * 60 * 1000`

Cada 5 minutos:
1. Skip si queue ocupada (`isProcessing || queue.length > 0`)
2. Busca RPAs FAILED de los últimos 30 min con `autoRetryCount < 3`
3. Deduplica por `productName` (Set) — nunca re-lanza dos RPAs del mismo producto
4. Para cada candidato, verifica que no exista ya un SUCCESS o RUNNING para ese producto
5. Re-lee el registro de BD fresco antes de encolar (anti race condition)
6. Crea nuevo RpaExecution con `autoRetryCount: original.autoRetryCount + 1` y `observations: "Auto-retry #N"`
7. Encola en la queue singleton existente

Iniciar al cargar módulo: `manager.startAutoRetryScheduler()`

### 24c. rpaController.js — Guardas de estado:

**retryExecution:** Rechaza si status es RUNNING (409) o SUCCESS (409)

**dispatchOrphan:** Verifica que no haya RUNNING para el mismo `productName` antes de despachar

**getOrphanNotes:** Filtra notas huérfanas donde el producto ya tiene un RPA RUNNING:
```javascript
const runningRpas = await prisma.rpaExecution.findMany({
    where: { status: 'RUNNING' }, select: { productName: true }
});
const runningProducts = new Set(runningRpas.map(r => r.productName));
// En el filter: if (runningProducts.has(n.product?.name)) return false;
```


## CAMBIO 25: ProductionOperatorPage — Fix isProductionDone (CHICLE invisible)

**Archivo:** `frontend/src/pages/ProductionOperatorPage.jsx`

**Problema:** La función `isProductionDone()` retornaba `true` cuando empaque había empezado (`empaqueStarted`) aunque CONTEO aún estuviera EXECUTING. Esto hacía que el batch desapareciera de la vista del operario de producción y no pudiera agregar más carritos.

**Fix:** Simplificar la condición — un batch solo está "done" para producción cuando la nota CONTEO está COMPLETED:
```javascript
// ANTES (buggy):
const isProductionDone = (b) => {
    if (user?.role !== 'PRODUCCION' || !b.hasConteo) return false;
    const conteoNote = b.notes.find(n => n.processType?.code === 'CONTEO');
    if (!conteoNote) return false;
    if (conteoNote.status === 'COMPLETED') return true;
    const allPreConteoDone = preConteoNotes.every(n => n.status === 'COMPLETED');
    const empaqueStarted = b.notes.some(n => ['EMPAQUE', 'G_EMPAQUE'].includes(n.processType?.code) && n.status !== 'PENDING');
    return allPreConteoDone && empaqueStarted; // ← BUG
};

// DESPUES (correcto):
const isProductionDone = (b) => {
    if (user?.role !== 'PRODUCCION' || !b.hasConteo) return false;
    const conteoNote = b.notes.find(n => n.processType?.code === 'CONTEO');
    if (!conteoNote) return false;
    return conteoNote.status === 'COMPLETED';
};
```


## CAMBIO 26: Geniality scheduler — Safety stock (Seg.) en sidebar

**Archivo:** `backend/src/controllers/genialitySchedulerController.js`

**Problema:** Las tarjetas de sabor en la programación de Geniality no mostraban las columnas "Prog." ni "Seg." (stock de seguridad). El frontend usa `d.dailyVelocity` y `d.scheduledUnits` de `stockDetails`, pero el backend de Geniality no los incluía.

**Fix:** Agregar los dos campos faltantes al `stockDetails.push()` (línea ~202):
```javascript
// ANTES:
stockDetails.push({
    label,
    units: totalProductStock,
    kg: stockKg,
    sizeWeight: kgFactor,
    deficitUnits
});

// DESPUES:
stockDetails.push({
    label,
    units: totalProductStock,
    kg: stockKg,
    sizeWeight: kgFactor,
    deficitUnits,
    scheduledUnits: ipUnits,
    dailyVelocity: Math.round((p.dailyVelocity || 0) * 10) / 10
});
```

`ipUnits` ya existe en línea 197 (`inProgressMap[p.id] || 0`). No requiere queries adicionales.


## CAMBIO 27: Alertas de Órdenes de Compra — Notificaciones a Cartera y Contabilidad

**Archivos:**
- `backend/src/services/purchaseOrderAlertService.js` (NUEVO)
- `backend/src/controllers/purchaseOrderController.js` — nuevo endpoint + triggers en endpoints existentes
- `backend/src/controllers/receptionController.js` — triggers al crear/validar recepción
- `backend/src/routes/procurementRoutes.js` — nueva ruta
- `frontend/src/components/common/PurchaseOrderAlert.jsx` (NUEVO)
- `frontend/src/components/common/Layout.jsx` — integración del componente
- `backend/src/routes/testRoute.js` — endpoint de prueba

**Propósito:** Notificaciones en tiempo real (Socket.IO + polling API) cuando órdenes de compra requieren acción de Cartera o Contabilidad.

### 27a. Tipos de alerta (3):

| Tipo | Rol destino | Trigger | Icono |
|------|-------------|---------|-------|
| `PAYMENT_PENDING` | CARTERA | OC enviada a cartera (status → PAYMENT_PENDING) | 💳 naranja |
| `ACCOUNTING_PENDING` | CONTABILIDAD | Recepción creada, OC lista para contabilizar | 📊 azul |
| `CREDIT_PAYMENT_PENDING` | CARTERA | OC crédito completada pero sin pagar | 🗓️ púrpura |

### 27b. Backend — Service (purchaseOrderAlertService.js):
```javascript
// Constantes
const PROCUREMENT_ALERT_EVENT = 'purchase_order:workflow-alert';

// Funciones principales:
canReceivePurchaseOrderAlert(role, alert)  // Solo CARTERA y CONTABILIDAD
buildPurchaseOrderWorkflowAlert(type, order, extra)  // Construye payload con id, message, icon, color, targetRoles
emitPurchaseOrderWorkflowAlert(req, alert)  // io.emit() broadcast

// ID de alerta: `{type}:{orderId}:{receptionId|'ORDER'}`
```

### 27c. Backend — Endpoint de consulta:
`GET /procurement/purchase-order-alerts/pending` (auth, roles CARTERA/CONTABILIDAD)
- CARTERA: busca OCs con status `PAYMENT_PENDING` + OCs `COMPLETED` con `paymentMethod='CREDITO'` y `creditPaid=false`
- CONTABILIDAD: busca recepciones pendientes de contabilizar
- Retorna max 30 alertas ordenadas por fecha

### 27d. Backend — Triggers en endpoints existentes:
- `PUT /purchase-orders/:id/send-to-cartera` → emite `PAYMENT_PENDING`
- `POST /receptions` (crear recepción) → emite `ACCOUNTING_PENDING`
- `PUT /receptions/:id/validate` (validar recepción) → si OC completada y crédito sin pagar → emite `CREDIT_PAYMENT_PENDING`

### 27e. Frontend — PurchaseOrderAlert.jsx:
- Posición fija esquina inferior derecha (z-index 99999)
- Max 5 alertas simultáneas, tarjetas con borde izquierdo de color
- **Socket.IO:** escucha evento `purchase_order:workflow-alert` en tiempo real
- **Polling API:** carga alertas pendientes al montar el componente
- **Deduplicación:** por alert ID (previene duplicados entre socket y polling)
- **Audio:** 3 notas ascendentes (440Hz, 587Hz, 740Hz) con Web Audio API
- **Notificación nativa:** `Notification` del navegador con `requireInteraction: true`
- **Filtro por rol:** solo muestra alertas si el usuario es CARTERA o CONTABILIDAD
- Botón de acción navega a `/procurement/purchase-orders`

### 27f. Integración en Layout.jsx:
```jsx
<PurchaseOrderAlert />  // Renderizado a nivel raíz, disponible en toda la app
```

### 27g. Endpoint de prueba (testRoute.js):
`GET /test-po-alert` — emite alerta de prueba via Socket.IO (solo desarrollo)


## CAMBIO 28: Sistema de Relevo de Turnos (Shift Handover)

**Archivos backend:**
- `backend/prisma/schema.prisma` — modelos ShiftHandoverRecord, ShiftHandoverSignature, ShiftHandoverChecklist, enum HandoverStatus
- `backend/src/controllers/shiftHandoverController.js` (NUEVO) — ~640 líneas
- `backend/src/services/shiftHandoverService.js` (NUEVO) — ~509 líneas
- `backend/src/services/shiftProductionSummaryService.js` (NUEVO) — resumen de producción por turno
- `backend/src/services/pinValidationService.js` (NUEVO) — validación de PIN para firmas
- `backend/src/routes/shiftHandoverRoutes.js` (NUEVO)
- `backend/src/controllers/shiftHandoffController.js` — cambios para integración

**Archivos frontend:**
- `frontend/src/components/ShiftHandover/ShiftHandoverTab.jsx` (NUEVO) — contenedor principal
- `frontend/src/components/ShiftHandover/OperatorSignaturePanel.jsx` (NUEVO) — firmas de operarios
- `frontend/src/components/ShiftHandover/LeaderAuthorizationPanel.jsx` (NUEVO) — autorización líder saliente
- `frontend/src/components/ShiftHandover/IncomingLeaderPanel.jsx` (NUEVO) — aceptación líder entrante
- `frontend/src/components/ShiftHandover/HandoverBlockScreen.jsx` (NUEVO) — pantalla de bloqueo
- `frontend/src/components/ShiftHandover/HandoverAlarm.jsx` (NUEVO) — alarma pre-turno
- `frontend/src/components/ShiftHandover/HandoverTimeline.jsx` (NUEVO) — timeline visual
- `frontend/src/components/ShiftHandover/HandoverHistory.jsx` (NUEVO) — historial
- `frontend/src/pages/ShiftSchedulePage.jsx` — integración tab handover

**Propósito:** Gestión formal de entrega de turno entre operarios y líderes de 3 áreas (Producción, Siropes, Empaque). Bloquea al turno entrante hasta completar la entrega.

### 28a. Modelos de BD:

**ShiftHandoverRecord:**
- `id`, `weekId`, `area` (PRODUCCION|SIROPES|EMPAQUE), `operationalDate`
- `outgoingShift`, `incomingShift` (MANANA|TARDE|NOCHE)
- `outgoingParticipants`, `incomingParticipants` (JSON arrays)
- `outgoingLeaderId`, `outgoingLeaderAt`, `incomingLeaderId`, `incomingLeaderAt`
- `checklist` (JSON — items tipo boolean, text, production_summary, novelty)
- `pendingTasks`, `incidents`, `observations`
- `status` (HandoverStatus enum)
- `graceDeadline`, `allSignedAt`
- `forcedCompleteBy`, `forcedCompleteAt`, `forcedReason` (emergencia admin)
- `auditLog` (JSON array de eventos)
- Unique: `[weekId, operationalDate, area, outgoingShift]`

**HandoverStatus enum:** `PENDING → IN_PROGRESS → DELIVERED → RECEIVED → WITH_INCIDENT → VALIDATED`

**ShiftHandoverSignature:** firma individual por operario (handoverId + userId + employeeId + signedAt + IP + userAgent)

**ShiftHandoverChecklist:** templates por área (label, fieldType, sortOrder, active)

### 28b. Flujo de estados:
```
PENDING
  → [Operarios firman con PIN] →
IN_PROGRESS
  → [Todos firmaron + líder saliente autoriza con checklist + PIN] →
DELIVERED
  → [Líder entrante acepta con PIN] →
RECEIVED (bloqueo removido, turno entrante puede trabajar)
  → [Supervisor valida (opcional)] →
VALIDATED
```

### 28c. Constantes de tiempo:
```javascript
PRE_ALERT_MINUTES = 15   // Alarma suave 15 min antes del fin de turno
PRE_BLOCK_MINUTES = 10   // Bloqueo obligatorio 10 min antes
GRACE_MINUTES = 10       // Gracia 10 min después del fin
SHIFT_TRANSITIONS = [
  { outgoing: 'MANANA', incoming: 'TARDE',  endHour: 14 },
  { outgoing: 'TARDE',  incoming: 'NOCHE',  endHour: 22 },
  { outgoing: 'NOCHE',  incoming: 'MANANA', endHour: 6  },
]
```

### 28d. Backend — Endpoints principales:

**Consulta:**
| Endpoint | Propósito |
|----------|-----------|
| `GET /shift-handover/current` | Handover actual por área |
| `GET /shift-handover/current-all` | Las 3 áreas (dashboard) |
| `GET /shift-handover/history` | Historial con filtros |
| `GET /shift-handover/alarm-status` | ¿Debe ver alarma el usuario? |
| `GET /shift-handover/block-status` | ¿Está bloqueado el usuario? |
| `GET /shift-handover/:id/production-summary` | Resumen de producción del turno |

**Acciones (todas requieren PIN):**
| Endpoint | Actor | Acción |
|----------|-------|--------|
| `POST /:id/sign` | Operario | Firma con PIN |
| `POST /:id/authorize-outgoing` | Líder saliente | Revisa checklist + autoriza |
| `POST /:id/accept-incoming` | Líder entrante | Acepta relevo |
| `POST /:id/validate` | Supervisor | Validación final (opcional) |
| `POST /:id/force-complete` | Admin | Cierre de emergencia (con razón) |

### 28e. Backend — Generación automática:
`generateHandoversForWeek(weekId)` se llama al publicar una semana de turnos:
- Crea records para cada área × transición × día de la semana
- Filtra empleados ausentes
- Salta domingos diurnos (MANANA→TARDE, TARDE→NOCHE)
- Upsert: corrige participantes sin perder progreso

### 28f. Backend — Lógica de bloqueo (getBlockInfo):
Retorna `blocked: true` si:
1. Usuario asignado a área de handover
2. No es admin
3. Dentro de ventana de transición (10 min antes → 10 min gracia)
4. Handover NO en estado RECEIVED/WITH_INCIDENT/VALIDATED
5. Incluye: `blockPhase` (PRE_HANDOVER|GRACE|POST_GRACE), `pendingSteps`, `missingSigners`, `requiresAdminRelease`

### 28g. Frontend — Componentes:

**HandoverBlockScreen:** Overlay pantalla completa cuando `blocked=true`. Sirena cada 60s. Solo permite navegar a `/shift-schedule`. Polling cada 5s.

**HandoverAlarm:** Banner superior 15 min antes del fin de turno. Tono suave cada 30s. Rojo si ≤5 min, naranja si >5 min. Dismissible pero reaparece.

**OperatorSignaturePanel:** Lista operarios salientes con barra de progreso. Input PIN para cada uno. Muestra hora de firma.

**LeaderAuthorizationPanel:** Aparece cuando todos firmaron. Checklist interactivo + resumen de producción (baches en curso, completados, pendientes). Pregunta "¿Hubo novedades?" con textarea. PIN para autorizar.

**IncomingLeaderPanel:** Aparece cuando status=DELIVERED. Muestra resumen del checklist + incidentes. PIN para aceptar y desbloquear turno entrante.

**HandoverTimeline:** Barra visual: Inicio → Firmas → Entregado → Recibido.

**HandoverHistory:** Historial filtrable por área y fechas. Filas expandibles con detalle completo.

**ShiftHandoverTab:** Contenedor que orquesta los paneles. Refresh cada 15s. Integrado en ShiftSchedulePage como tab por defecto para producción.

### 28h. Caso especial — Áreas cruzadas:
SIROPES y EMPAQUE validan contra el líder de PRODUCCIÓN (no tienen líder propio). El sistema cruza la validación automáticamente.

### 28i. Feature flag:
`systemSettings.key = 'SHIFT_HANDOVER_ENABLED'` — debe estar en `true` para activar todo el sistema.

### 28j. Commits específicos ya en main:
- `cf8a40d` — excluir operarios sin cuenta de usuario del bloqueo
- `5480fe1` — botón de verificación de horario para líder entrante en block screen


## CAMBIO 29: KPI Adherencia Esferificación + Banner motivacional por turno

**Archivos:**
- `backend/src/controllers/kpiController.js` — endpoint `getScheduleAdherence` reescrito
- `frontend/src/pages/ProductionOperatorPage.jsx` — `getAdherenceData`, `AdherenceBadge`, banner de turno, barra por batch
- `frontend/src/pages/ProductionKpiPage.jsx` — tabla y sección de cumplimiento por turno

**Problema:** El KPI anterior medía desde `scheduledStart` hasta `CONTEO.completedAt`, pero los batches se solapan (uno puede estar en esferificación mientras otro está en dosificación). El `scheduledStart` se recorre con reschedule, así que no es buen indicador. El recurso cuello de botella real es la **máquina esferificadora** (paso FORMACION) — solo un batch a la vez.

### 29a. Backend — getScheduleAdherence reescrito:

**Antes:** Medía `scheduledStart → CONTEO.completedAt` para Liquipops y Geniality.

**Ahora:** Solo mide `FORMACION.startedAt → FORMACION.completedAt` vs `batchDuration` (90 min). Solo Liquipops (Geniality no tiene esferificación).

```javascript
// Fórmula:
const actualMin = (formacionEnd - formacionStart) / 60000;
const delayMin = Math.max(0, actualMin - targetDuration);
const adherenceScore = Math.max(0, Math.round(100 - (delayMin / targetDuration) * 100));
```

Agrega `shiftCompletion`: agrupa batches por turno (MANANA/TARDE/NOCHE) y calcula scheduled vs completed FORMACION por turno.

### 29b. Frontend — Banner motivacional por turno (ProductionOperatorPage):

Solo visible para rol PRODUCCION en tab Perlas. Calcula desde datos ya cargados (sin API extra).

- **Barra de 5 segmentos:** cada batch esferificado llena un segmento verde (como vidas de videojuego)
- **Meta:** `TARGET_BATCHES = 5` (actualmente, luego 6-7 cuando lleguen más personas)
- **Mensajes motivacionales:**
  - 0/5: 🎯 "Meta del turno: 5 baches"
  - 1-2/5: 💪 "Faltan X — ¡A darle!"
  - 3/5: ⚡ "¡Van por buen camino!"
  - 4/5: 🔥 "¡Uno más y lo logran!"
  - 5/5: 🏆 "¡Meta cumplida! ¡Turno élite!" (fondo verde, borde verde)
- Muestra promedio de esferificación en minutos

### 29c. Frontend — Barra de progreso por batch (BatchCard):

Dentro de cada tarjeta de batch, debajo del nombre del sabor:

**Durante FORMACION (en curso):**
- Barra azul que llena de 0% a 100% según avanza hacia 90 min
- 🟢 "¡Vas volando!" (0-50%) → 🔵 "¡Buen ritmo!" (50-75%) → 🟡 "Quedan X min" (75-95%) → "¡Último minuto!" (95-100%) → 🔴 "+X min extra" (>100%)
- Se actualiza cada 30 segundos

**Después de FORMACION (completada):**
- 🏆 "¡Máquina imparable!" (≥95%) — barra verde
- ⚡ "¡Gran trabajo!" (≥80%) — barra verde
- 👍 "Aceptable" (≥60%) — barra amarilla
- ⏱️ "A mejorar" (<60%) — barra roja
- Muestra minutos reales (ej: "115 min")

### 29d. Frontend — AdherenceBadge actualizado:

Badge junto al status del batch, ahora muestra medallas y mensajes cortos:
- `🏆 89min · Excelente` / `⚡ 108min · Buen ritmo` / `👍 120min · Aceptable` / `⏱️ 150min · Lento`
- En curso: muestra elapsed/target con mensaje en vivo

### 29e. Frontend — ProductionKpiPage tabla actualizada:

- Título: "Adherencia Esferificación" (era "Adherencia al Cronograma")
- Columnas: Bache, Objetivo, Esferificación, Exceso, Score, Estado (quitada columna Línea)
- Nueva sección "Cumplimiento por Turno": tarjetas por fecha/turno con barra y porcentaje

### 29f. Constante configurable:
```javascript
// Frontend — ProductionOperatorPage.jsx
const TARGET_FORMACION_MIN = 90;  // Objetivo de duración esferificación
const TARGET_BATCHES = 5;         // Meta de batches por turno (luego 6, máx 7)
```


## PRIORIDAD DE CAMBIOS 21 ABRIL

1. **CRITICO:** Cambio 24 (RPA auto-retry) — sin esto, RPAs fallidos quedan abandonados y Siigo no se actualiza
2. **CRITICO:** Cambio 23 (unassignedQty) — filtro de inventario sin lotes mostraba datos incorrectos
3. **CRITICO:** Cambio 28 (Shift Handover) — módulo completo nuevo, bloquea operarios sin relevo formal
4. **ALTO:** Cambio 27 (Alertas compras) — Cartera/Contabilidad no reciben notificaciones de OC
5. **ALTO:** Cambio 25 (isProductionDone) — operarios perdían batches activos del panel
6. **ALTO:** Cambio 29 (KPI esferificación + banner) — medición correcta de producción + motivación operarios
7. **MEDIO:** Cambio 26 (Geniality safety stock) — columna informativa faltante en programación


---

## CAMBIOS 22 DE ABRIL 2026


## CAMBIO 30: Fix FK constraint en transferencia de lotes terminados

**Archivo:** `backend/src/controllers/lotController.js` (~línea 1746-1793)

**Problema:** Al transferir la cantidad completa de un lote a una zona donde ya existía un registro del mismo lote, el original se eliminaba (merge) pero el `finishedLotTransfer.create` seguía usando el ID del lote eliminado → FK constraint violation.

**Fix:** Patrón `survivingLotId`:
```javascript
let survivingLotId = lotId;
if (roundedQty >= lot.currentQuantity) {
    const existing = await tx.finishedLotStock.findUnique({
        where: { lotNumber_zone: { lotNumber: lot.lotNumber, zone: targetZone } }
    });
    if (existing) {
        await tx.finishedLotStock.update({ where: { id: existing.id }, data: { currentQuantity: { increment: roundedQty } } });
        await tx.finishedLotStock.delete({ where: { id: lotId } });
        survivingLotId = existing.id;
    } else {
        await tx.finishedLotStock.update({ where: { id: lotId }, data: { zone: targetZone } });
    }
}
// Usar survivingLotId en vez de lotId para finishedLotTransfer.create
await tx.finishedLotTransfer.create({
    data: { finishedLotStockId: survivingLotId, ... }
});
```


## CAMBIO 31: LOGISTICA puede usar pedido rápido sin restricción de packSize

**Archivo:** `backend/src/controllers/orderController.js` (líneas 7-11, 41-42)

**Problema:** Solo ADMIN podía crear pedidos rápidos con unidades sueltas (bypass packSize). LOGISTICA también necesita esta funcionalidad.

**Fix:**
```javascript
// ANTES:
const canBypass = req.user.role === 'ADMIN';
// DESPUES:
const canBypass = ['ADMIN', 'LOGISTICA'].includes(req.user.role);
```

**NOTA:** Hay un `console.log` de debug en línea 9 que debe eliminarse:
```javascript
console.log(`[createOrder] user: ${req.user?.name} role: ${req.user?.role} allowLooseUnits: ${allowLooseUnits} (type: ${typeof allowLooseUnits})`);
```


## CAMBIO 32: Vista de operario — filtro por rol (CONTEO/EMPAQUE paralelo)

**Archivo:** `frontend/src/pages/ProductionOperatorPage.jsx`

**Problema:** Operarios de producción no podían acceder al CONTEO cuando G_EMPAQUE ya estaba EXECUTING, porque el sistema mostraba la etapa EMPAQUE como la activa.

**Fix:** Role-aware stage display y navegación:
```javascript
const EMPAQUE_CODES = ['EMPAQUE', 'G_EMPAQUE', 'ETIQUETADO'];
const isProduccionUser = userRole === 'PRODUCCION';
const isPickingUser = ['OPERARIO_PICKING', 'EMPAQUE'].includes(userRole);
const roleFilter = (n) => {
    const code = n.processType?.code || '';
    if (isProduccionUser) return !EMPAQUE_CODES.includes(code);
    if (isPickingUser) return EMPAQUE_CODES.includes(code) || code === 'CONTEO';
    return true;
};
const currentStage = batch.notes.find(n => n.status === 'EXECUTING' && roleFilter(n))
    || batch.notes.find(n => n.status === 'EXECUTING');
const nextStage = currentStage || batch.notes.find(n => n.status === 'PENDING' && roleFilter(n))
    || batch.notes.find(n => n.status === 'PENDING');
```

Navegación en `handleStart` también filtrada por rol: producción va a nota no-EMPAQUE, picking va a nota EMPAQUE/CONTEO.


## CAMBIO 33: Botón "Reabrir Conteo" para admin

**Archivo:** `frontend/src/pages/ProductionOperatorPage.jsx`

**Problema:** Operarios presionan "TERMINAR CONTEO" prematuramente. Backend ya tenía `POST /assembly-notes/:id/reopen`, faltaba el botón en frontend.

**Fix:** Componente `ReopenConteoButton`:
- Solo visible para ADMIN
- Solo en BatchCard cuando hay nota CONTEO/G_CONTEO con status COMPLETED
- Pide confirmación antes de reabrir
- Llama `api.post(/assembly-notes/${noteId}/reopen)`
- Icono RotateCcw de lucide-react


## CAMBIO 34: Guard anti-duplicado de RPA para carritos

**Archivo:** `frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx` (~línea 803)

**Problema:** Al resetear estado de notas, se podía disparar un RPA duplicado para un carrito que ya tenía RPA exitoso.

**Fix:**
```javascript
const alreadyHasRpa = activeCarrito.rpaExecutionId && activeCarrito.labeledAt;
if (isRpaEnabledCarrito && !alreadyHasRpa) {
    // fire RPA normalmente
} else if (alreadyHasRpa) {
    rpaExecId = activeCarrito.rpaExecutionId;
    console.log(`[MarcadoCajas] Carrito ${activeCarritoId} ya tiene RPA ${rpaExecId} — skip duplicado`);
}
```


## CAMBIO 35: RpaStatusTag — Stop polling en 404

**Archivo:** `frontend/src/components/GenialityRunner/steps/GConteoCarritosStep.jsx` (líneas 27-29)

**Problema:** Cuando un RPA se eliminaba o no existía, el componente RpaStatusTag hacía polling infinito al endpoint que devolvía 404.

**Fix:**
```javascript
} catch (e) {
    if (e.response?.status === 404) {
        setStatus('FAILED');
        return; // stop polling
    }
    console.warn('RPA poll err:', e.message);
}
```


## CAMBIO 36: AZUCAR INVERTER GLUCOSA — accountGroup corregido

**Cambio de datos (no de código):** El producto PROCELIQUIPOPS26 (AZUCAR INVERTER GLUCOSA) tenía `accountGroup: 1405` (grupo Geniality) pero es un producto en proceso de Liquipops. Corregido a `accountGroup: 1404`.

Sin este cambio, la plantilla y fórmula de glucosa no aparecen en las páginas de Plantillas y Fórmulas (filtro `notIn: [1402, 1405]` las excluye).


## PRIORIDAD DE CAMBIOS 22 ABRIL

1. **CRITICO:** Cambio 30 (FK transfer) — crash al transferir lotes completos entre zonas
2. **CRITICO:** Cambio 32 (role-aware stages) — producción no podía acceder a CONTEO en paralelo con EMPAQUE
3. **ALTO:** Cambio 34 (RPA duplicado) — doble registro en Siigo
4. **ALTO:** Cambio 35 (404 polling) — loop infinito consume recursos
5. **ALTO:** Cambio 31 (LOGISTICA packSize) — logística no podía crear pedidos rápidos
6. **MEDIO:** Cambio 33 (Reabrir Conteo) — botón admin para recuperar conteos cerrados prematuramente
7. **BAJO:** Cambio 36 (accountGroup glucosa) — dato mal clasificado, solo afecta visibilidad en admin


---

## PROTECCION DE MERGE — REVISION 22 ABRIL 2026

**Contexto detectado:** hay un merge en curso en la rama `main` (`.git/AUTO_MERGE`) y este documento esta sin tracking (`?? CAMBIOS_PENDIENTES_2026-04-18.md`). Antes de recibir o aceptar la version del otro equipo, este archivo debe agregarse/commitearse o copiarse fuera del repo para no perder la bitacora.

### Archivos actualmente en conflicto (`UU`)

Resolver manualmente conservando ambos lados cuando aplique:

- `backend/prisma/schema.prisma`
- `backend/src/controllers/rpaController.js`
- `backend/src/controllers/shiftHandoffController.js`
- `backend/src/services/siigoBrowserManager.js`
- `frontend/src/components/AssemblyRunner/steps/IntroStep.jsx`
- `frontend/src/components/inventory/InventoryMatrix.jsx`
- `frontend/src/pages/Inventory.jsx`
- `frontend/src/pages/RpaHistoryPage.jsx`

### Cambios nuevos no versionados que NO se deben perder

Estos archivos aparecen como `??` y deben incluirse explicitamente en el merge/commit si siguen siendo necesarios:

**Documentos WhatsApp ERP:**
- `frontend/public/downloads/ficha-operativa-whatsapp-erp.html`
- `frontend/public/downloads/ficha-operativa-whatsapp-erp.pdf`
- `frontend/public/downloads/informe-gerencial-whatsapp-erp.html`
- `frontend/public/downloads/informe-gerencial-whatsapp-erp.pdf`

**Componentes/servicios nuevos:**
- `backend/src/services/purchaseOrderAlertService.js`
- `backend/src/services/shiftProductionSummaryService.js`
- `backend/src/scripts/migrateLiquimonFlow.js`
- `frontend/src/components/ShiftHandover/HandoverSimulationPanel.jsx`

**Archivos sueltos detectados en raiz — NO incluir sin confirmar origen:**

Estos archivos aparecen dentro de `/var/www/gestionpbi`, pero por nombre/contexto pueden pertenecer a otra app comercial, posiblemente `popdrinks`. No deben agregarse al merge de GestionPBI hasta confirmar su origen.

- `bebida-uso1.png`
- `bebida-uso2.png`
- `chamoy-uso.png`
- `cocktail.png`
- `geniality-sirope.png`
- `kit-starter.png`
- `logo.png`
- `michelada.png`
- `perlas-1200.webp`
- `perlas-3400.webp`
- `perlas-350.webp`
- `perlas-coco.png`
- `perlas-manzana.png`
- `perlas-maracuya.png`
- `perlas-mora.png`
- `perlas-sandia.png`
- `perlas-showcase.webp`
- `skarcha-1.png`
- `skarcha-2.png`
- `skarcha-3.png`
- `skarcha-4.png`
- `skarcha-5.png`
- `skarcha-blue.png`
- `yexis-cafe.png`
- `yexis-coco.png`
- `yexis-gelatin.png`
- `yexis-main.png`
- `yexis-topping.png`


## CAMBIO 37: Documentos gerenciales WhatsApp ERP

**Archivos:**
- `frontend/public/downloads/ficha-operativa-whatsapp-erp.html`
- `frontend/public/downloads/ficha-operativa-whatsapp-erp.pdf`
- `frontend/public/downloads/informe-gerencial-whatsapp-erp.html`
- `frontend/public/downloads/informe-gerencial-whatsapp-erp.pdf`

**Proposito:** Documentos de aprobacion y ficha operativa para el futuro centro de resumenes por WhatsApp del ERP.

**Contenido clave a conservar:**
- Modelo de tres mensajes: `Resumen Ejecutivo`, `Resumen Operativo por Turno`, `Alertas Criticas`.
- Fuentes ERP: produccion, inventario, compras, cartera, turnos/relevo, pedidos y ventas.
- Reglas de destinatarios por capa.
- Recomendacion de implementar primero vista previa interna e historial en ERP, luego conexion WhatsApp.
- Riesgos y controles para evitar dependencia total del canal WhatsApp.

**Riesgo de merge:** estos archivos estan nuevos/no versionados. Si se limpia el worktree o se cambia de rama sin guardarlos, se pierden.


## CAMBIO 38: Alertas de compras — service y UI completa

**Archivos a proteger:**
- `backend/src/services/purchaseOrderAlertService.js`
- `frontend/src/components/common/PurchaseOrderAlert.jsx`
- `frontend/src/components/common/Layout.jsx`
- `backend/src/controllers/purchaseOrderController.js`
- `backend/src/controllers/receptionController.js`
- `backend/src/routes/procurementRoutes.js`
- `backend/src/routes/testRoute.js`

**Notas de merge:**
- `PurchaseOrderAlert.jsx` ya existia y fue reescrito para usar evento `purchase_order:workflow-alert`, polling de `/procurement/purchase-order-alerts/pending`, deduplicacion por ID, audio y notificacion nativa.
- El service `purchaseOrderAlertService.js` aparece como nuevo (`??`), asi que debe agregarse al commit.
- Verificar que `Layout.jsx` conserve `<PurchaseOrderAlert />` renderizado en nivel raiz.


## CAMBIO 39: Shift Handover — simulador y resumen de produccion por turno

**Archivos a proteger:**
- `frontend/src/components/ShiftHandover/HandoverSimulationPanel.jsx`
- `backend/src/services/shiftProductionSummaryService.js`
- `frontend/src/components/ShiftHandover/ShiftHandoverTab.jsx`
- `frontend/src/components/ShiftHandover/LeaderAuthorizationPanel.jsx`
- `backend/src/controllers/shiftHandoverController.js`
- `backend/src/services/shiftHandoverService.js`

**Proposito:** Completar el modulo de relevo con simulacion, resumen productivo por turno, validacion de lideres y vista multi-area.

**Notas de merge:**
- `HandoverSimulationPanel.jsx` y `shiftProductionSummaryService.js` estan nuevos/no versionados.
- `ShiftHandoverTab.jsx` debe conservar la vista de las 3 areas (`current-all`) para que todos puedan ver el tablero vivo.
- `LeaderAuthorizationPanel.jsx` debe conservar el resumen de produccion y seleccion/revision de baches.


## CAMBIO 40: Archivos sueltos posiblemente ajenos a GestionPBI

**Archivos:** imagenes nuevas en raiz listadas en "Archivos sueltos detectados en raiz".

**Estado:** no confirmado como parte del ERP.

**Nota de merge:** no versionar estos archivos dentro de GestionPBI sin validar primero si pertenecen a otra app. Si son de `popdrinks` u otro proyecto, deben moverse o ignorarse fuera del merge del ERP. Si algun archivo realmente pertenece a GestionPBI, documentar su pantalla/uso antes de incluirlo.


## CAMBIO 41: Programar GLUCOSA y FRUCTOSA desde calendario Geniality

**Archivos:**
- `backend/src/controllers/genialitySchedulerController.js`
- `frontend/src/pages/ProductionScheduler.jsx`

**Proposito:** Permitir programar y ejecutar AZUCAR INVERTER GLUCOSA (PROCELIQUIPOPS26) y AZUCAR INVERTIDA FRUCTOSA (PROCELIQUIPOPS43) desde el calendario de Geniality (Siropes). Estos insumos intermedios antes se fabricaban sin programacion, causando paros de produccion por falta de stock.

**Cambios backend (`genialitySchedulerController.js`):**
- Constante `INGREDIENT_SKUS` con los dos SKUs para queries de getSchedule
- `getSchedule`: query ampliada con OR para incluir batches cuyos outputTargets referencien estos SKUs
- `getSuggestions`: agrega dos items con `isIngredient: true`, `templateCode` (TMPL-AZINV-001 / TMPL-FRUCT-001), `templateName`, stock actual y semaforo
- `calculateBatchMix`: shortcut para GLUCOSA/FRUCTOSA — retorna info de template y producto

**Cambios frontend (`ProductionScheduler.jsx`):**
- State `ingredientLots` para controlar cantidad de lotes por ingrediente
- Seccion "Insumos Intermedios" en sidebar Geniality con:
  - Nombre de plantilla y codigo
  - Selector de lotes (+/- buttons, input numerico, max 10)
  - Stock actual con semaforo de colores
  - Tarjetas arrastrables al calendario
- `openConfigModal`: bypass completo del fetch de mix — usa datos del draggedFlavor directamente, crea modalData con `isIngredient: true`, `templateCode`, `baseWeight = lotes × 100`
- `handleSaveBatch`: path especifico para ingredientes que crea batch simple con titulo mostrando nombre de plantilla y lotes
- `handleLaunchBatch` (CRITICO): mapeo INGREDIENT_TEMPLATES que detecta GLUCOSA→TMPL-AZINV-001 y FRUCTOSA→TMPL-FRUCT-001, y llama quickStart con el template especifico SIN flavorKey ni outputTargets (igual que PremixQuickPanel). Esto ANTES del bloque BATCH-GENIALITY.
- Colores de calendario: GLUCOSA=#F59E0B (amber), FRUCTOSA=#D97706 (amber oscuro)
- Duracion default de 120min para ingredientes (vs 240min de siropes)

**Notas de merge:**
- Solo afecta calendario Geniality. Liquipops queda sin cambios.
- Los filtros de sugerencias usan `isIngredient` flag para separar ingredientes de sabores.
- El lanzamiento usa la plantilla directa (TMPL-AZINV-001 / TMPL-FRUCT-001), NO BATCH-GENIALITY.


## CHECKLIST ANTES DE ACEPTAR EL MERGE DEL OTRO EQUIPO

1. Guardar este documento (`CAMBIOS_PENDIENTES_2026-04-18.md`) en git o respaldo externo.
2. Resolver los 8 archivos `UU` uno por uno, revisando los cambios descritos en este documento.
3. Agregar al commit los archivos nuevos `??` que correspondan, especialmente documentos WhatsApp ERP y services/componentes nuevos.
4. No agregar imagenes sueltas de raiz sin confirmar si pertenecen a GestionPBI o a otra app.
5. Ejecutar `git diff --check` y corregir whitespace/conflict markers.
6. Verificar que no queden marcadores `<<<<<<<`, `=======`, `>>>>>>>`.
7. Probar como minimo: build frontend, arranque backend, flujo RPA, inventario, relevo de turno, reporte WhatsApp/documentos.

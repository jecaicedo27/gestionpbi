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


## CAMBIOS 27 DE ABRIL 2026

## CAMBIO 42: MRP Forecast — modal de materia prima requerida con filtros

**Archivos:**
- `frontend/src/pages/ProductionScheduler.jsx` — agregado modal MRP con buscador, filtros (Todos/Por Pedir/Suficiente), tabla con conteos y botón "Solicitar" en todos los items
- `backend/src/controllers/mrpForecastController.js` — usa Siigo `warehouses` como fuente principal de stock, fallback a `currentStock + productionZoneStock`
- `backend/src/routes/index.js` línea 263 — ruta `GET /mrp-forecast?line=<liquipops|geniality>`

**Detalles:**
- MRP expande recursivamente fórmulas (COMPUESTO → BASE → AZUCAR INVERTIDA → AZUCAR)
- Filtra productos intermedios PROCELIQUIPOPS / PROCEGENIALITY del resultado final (solo MP raw)
- Stock display: Siigo first, app stock fallback
- Modal con 3 estados visuales (Todos / Por Pedir / Suficiente) y conteos por estado
- Botón "Solicitar" crea purchase order en `/procurement/purchase-orders`

## CAMBIO 43: ProductionScheduler — fix pérdida de eventos al cambiar semana

**Problema:** `handleRangeChange` recargaba eventos cada vez que el usuario navegaba el calendario, reemplazando el state. Si el fetch nuevo era más pequeño o tardaba, los eventos viejos desaparecían.

**Fix en `frontend/src/pages/ProductionScheduler.jsx`:**
- Carga inicial con rango grande (30 días atrás, 60 adelante) — todos los baches programados disponibles desde primer render
- `handleRangeChange`: skip refetch si el nuevo rango está cubierto por el actual
- Padding de ±7 días (antes ±3) para evitar refetches innecesarios
- Validación de array vacío al inicializar

**Cambios calendario:**
- `dayLayoutAlgorithm`: probado "overlap" pero regresado a "no-overlap" para mantener escalera visual
- `min` / `max` cambiados a `new Date(2020, 0, 1, ...)` con solo componente de tiempo (antes usaba `new Date()` que mezclaba fecha de hoy)
- Log de eventos por día agregado para debugging

## CAMBIO 44: BASE LIQUIPOPS DIOXIDO — color y dióxido integrados en la BASE

**Cambio de proceso productivo (no código):**
- Fórmula `FORM074` (BASE LIQUIPOPS DIOXIDO) ahora incluye COLOR EN POLVO VERDE LIMON NOVA COLOR (64.2g) — antes solo lo tenía el COMPUESTO
- Fórmula `FORM085` (COMPUESTO MANGO BICHE CON SAL) eliminado el COLOR (ya viene en BASE)
- Plantilla `TMPL063` (COMPUESTO MANGO BICHE CON SAL) actualizada: usa BASE LIQUIPOPS DIOXIDO (97kg) en lugar de BASE LIQUIPOPS (118kg) + DIOXIDO + COLOR sueltos
- Fórmula `FORM084` (ESFERAS MANGO BICHE CON SAL) — actualizada cantidad: COMPUESTO 96000g (antes 120385g), ALGINATO 44160g, baseQty 130000g

**Solo aplica a MANGO BICHE CON SAL** (es el único sabor que usa BASE LIQUIPOPS DIOXIDO).

**Implicación de merge:**
- No hay cambios de código, solo data (formulas, templates) en BD
- Backups de fórmulas FORM074, FORM085, FORM084 y plantilla TMPL063 antes del merge si se va a sobreescribir BD

## CAMBIO 45: Shift de timezone batches programados

**Acción puntual (no código):** se desplazaron +4 horas los 149 batches PENDING del 27 abr al 3 may por bug previo de timezone que dejaba el primer batch de MANGO BICHE CON SAL a las 22:00 dom en lugar de 02:00 lun.

**Sospecha de bug:** el handler `onDropFromOutside` en `ProductionScheduler.jsx` posiblemente guarda Date sin convertir correctamente local→UTC. No se identificó el lugar exacto, pendiente de investigar si vuelve a ocurrir.

## CAMBIO 46: PREMEZCLA GOMAS ESPECIAL — fix unit, AZUCAR ensamble y BASE LIQUIPOPS DIOXIDO

**Cambios de data (BD), no código:**

1. Producto **PREMEZCLA GOMAS ESPECIAL** (sku PROCELIQUIPOPS55) — `unit: gramo` → `unit: unidad`
   - Razón: todas las otras premezclas tienen unit "unidad" (CALCIO DIOXIDO, GOMAS PARA PERLAS, CONSERVANTES PERLAS, FUENTE DE CALCIO PERLAS)
   - El runner usa el unit del producto para decidir si muestra opción de impresión Zebra del lote

2. **TMPL048** (Producción PREMEZCLA GOMAS ESPECIAL) — Stage 2 Ensamble Siigo: AZUCAR 6,000g → 1,500g
   - Estaba inconsistente con Stage 1 y con FORM073 (que dice 1,500g)

3. **FORM074** (BASE LIQUIPOPS DIOXIDO) — item PREMEZCLA GOMAS ESPECIAL: `1 gramo` → `1 unidad`
   - Coherente con el cambio de unit del producto

**Implicación de merge:**
- No hay cambios de código, solo data en BD
- Si el equipo externo trae cambios sobre estos mismos products/templates/formulas, validar después del merge

## CAMBIO 47: TMPL049 (BASE LIQUIPOPS DIOXIDO) sincronizada con FORM074

**Cambio de data (BD):** TMPL049 stages 1 y 2 actualizadas con:
- Agregado COLOR EN POLVO VERDE LIMON NOVA COLOR (64.2g)
- PREMEZCLA GOMAS ESPECIAL: gramo → unidad

**Razón:** El sistema crea baches a partir de la **PLANTILLA**, no de la fórmula. Cambiar la fórmula sin presionar "Guardar Plantilla" en el editor causa que los baches nuevos sigan tomando la versión vieja.

**Comportamiento del sistema:**
- Editor de plantillas: hace auto-sync visual de inputs desde la fórmula activa al cargar
- Pero los inputs NO se persisten hasta presionar "Guardar Plantilla"
- Al iniciar un batch (`assemblyNote`), el sistema lee de `AssemblyTemplateStageInput`, NO de `FormulaItem`

**Recomendación post-merge:** Si el equipo externo cambió fórmulas, validar que las plantillas correspondientes estén sincronizadas.

## CAMBIO 48: Nuevo proceso IMPRESION_LOTE para premezclas e intermedios

**Backend (BD):**
- Nuevo `ProcessType` con code `IMPRESION_LOTE`, name "Impresión Etiqueta Lote", category "TRANSFORMATION", icon 🖨️, color #6366f1, active true

**Frontend (archivos nuevos/modificados):**

1. **NUEVO** `frontend/src/components/AssemblyRunner/steps/PrintLotStep.jsx`
   - Componente simple que muestra info del lote producido (producto, sku, lote, cantidad)
   - Selector de copias (1-10)
   - Estado Zebra (conectado/desconectado)
   - Botón grande "Imprimir Etiqueta" usando `printZPL` + `buildLotLabelZPL`
   - Persiste `lot_label_printed: true`, `lot_label_printed_at`, `lot_label_copies` en `processParameters`
   - Marca `MaterialLot.labelPrinted: true` via `/finished-lots/mark-printed` (busca el lot por `/finished-lots/lot-summary/:lotNumber`)

2. **MODIFICADO** `StepDisplay.jsx` — agregado import + `if (stepType === 'IMPRESION_LOTE') return <PrintLotStep />`

3. **MODIFICADO** `hooks/useAssemblyNote.js` — agregado:
   - `isImpresionLote = processCode === 'IMPRESION_LOTE'`
   - Skip INTRO para IMPRESION_LOTE
   - `else if (isImpresionLote) { steps.push({ type: 'IMPRESION_LOTE', data: noteData }); skipOutput = true; }`
   - Excluye IMPRESION_LOTE del fallback OUTPUT

4. **MODIFICADO** `AssemblyExecutionWizard.jsx` — agregado:
   - State `printLotData = { printed: false, copies: 1 }`
   - Guard en `handleNext`: si step es `IMPRESION_LOTE` y `!printLotData.printed`, modal "Debes imprimir la etiqueta" bloquea avance
   - `onPrintChange={setPrintLotData}` pasado al StepDisplay

**Uso:**
- En el editor de plantillas, el proceso "Impresión Etiqueta Lote" aparece automáticamente en la biblioteca
- Arrastrar como Stage final después del Ensamble Siigo en TMPL048, TMPL111, TMPL003, TMPL002, etc.
- El operador completa Ensamble → ve pantalla de impresión → no puede avanzar sin imprimir

## CAMBIO 49: PrintLotStep — numeración X/Y de grupo en etiqueta

**Cambios:**

1. **`frontend/src/services/zplLabelBuilder.js`** — `renderLabel`: si `totalBoxes > 1`, agrega ` (X/Y)` al final de la línea "Lote: ..." en la etiqueta ZPL.

2. **`frontend/src/components/AssemblyRunner/steps/PrintLotStep.jsx`** — agregado:
   - Estado `groupInfo: { index, total }`
   - useEffect que llama `GET /production-batches?productId=X&active=true`, filtra siblings creados ±24h del batch actual, calcula posición e índice
   - Pasa `boxNumber: groupInfo.index, totalBoxes: groupInfo.total` al `buildLotLabelZPL`
   - UI: muestra "Lote del grupo: N de M" en el card de info cuando total > 1

**Comportamiento:** Cuando el operador programa N baches del mismo flavor desde PremixQuickPanel, cada uno imprime su propia etiqueta con la numeración correspondiente (1/N, 2/N, ..., N/N). Pesaje sigue siendo individual por batch.

## CAMBIO 50: rescheduleAfterBatchStart — sistema FIFO push para Liquipops

**Problema:** Cuando un batch se iniciaba fuera de hora (ej. el 1/12 programado a las 04:00 se iniciaba a las 08:29), la lógica anterior solo comprimía hacia atrás los baches con `scheduledStart > realStart`. Los baches con `scheduledStart < realStart` (anteriores) quedaban flotando, causando solapamientos. Los CAMBIO DE AGUA viejos no se eliminaban, acumulándose mal posicionados.

**Fix en `backend/src/controllers/productionSchedulerController.js` (rescheduleAfterBatchStart, bloque Liquipops):**

Reemplazada la compresión simple por re-queue completo FIFO:

1. Toma TODOS los baches PENDING (anteriores + posteriores al iniciado)
2. Borra todos los CAMBIO DE AGUA PENDING (se re-crearán según regla)
3. Ordena los baches de producción por `originalScheduledStart || scheduledStart`
4. Cursor empieza al final del batch iniciado (`startedAt + 90min`)
5. Para cada batch en cola:
   - Si lleva 2 baches consecutivos, inserta nuevo CAMBIO DE AGUA (30 min)
   - Asigna `scheduledStart = cursor`, avanza cursor
6. AUX no-CAMBIO-DE-AGUA (LAVADO, MANTENIMIENTO) se reagendan al final

**Constantes:**
- `WATER_CHANGE_DURATION_MS = 30 * 60000`
- `WATER_CHANGE_EVERY = 2` (cada 2 baches de producción)

**Resultado:** Sistema FIFO con empuje. Cuando se inicia un batch fuera de hora, todos los demás se reorganizan en cola preservando el orden original (la "escalera"), con CAMBIOS DE AGUA correctamente intercalados sin duplicados.

## CAMBIO 51: Eliminar CAMBIO DE AGUA final automático en programación Liquipops

**Cambio en `frontend/src/pages/ProductionScheduler.jsx`** (línea ~1062):
- Removido el bloque que creaba un CAMBIO DE AGUA al final de cada sesión de programación con nota "Cambio de agua final (limpieza)"
- El operador ahora agrega el cambio de agua de cierre manualmente como evento auxiliar (arrastra desde sidebar "Eventos Auxiliares")
- Los CAMBIOS DE AGUA automáticos cada 2 baches durante la programación se mantienen

**Razón:** El cambio final causaba problemas — quedaba "suelto" sin batch siguiente y el reschedule debía limpiarlo. Mejor que el operario decida cuándo y dónde colocarlo.

## CAMBIO 52: Eliminar TODOS los CAMBIOS DE AGUA automáticos + botón rápido en Panel de Producción

**Frontend:**

1. **`ProductionScheduler.jsx`** — eliminada la creación automática de CAMBIO DE AGUA cada 2 baches Y el cambio final. Ya no se programa NINGÚN cambio de agua automático.

2. **`ProductionOperatorPage.jsx`** — agregado:
   - Handler `handleQuickWaterChange()` que llama `POST /production/{line}/schedule` con flavor "CAMBIO DE AGUA", duración 30 min, scheduledStart=now
   - Botón 💧 (icono Droplets) en el header móvil del Panel de Producción, junto a Warehouse y RefreshCw
   - Pide confirmación antes de crear el evento

**Razón:** Los cambios de agua automáticos causaban inconvenientes (aparecían sueltos, en horarios incorrectos, no respetaban cuándo el operario realmente lavaba). Mejor que el operario los registre cuando los hace en planta.

**Reschedule preservado**: el global shift sigue desplazando los CAMBIOS DE AGUA junto con los baches sin duplicarlos.

## CAMBIO 53: Sistema de FALLAS con desplazamiento automático del cronograma

**Backend:**

1. **`productionSchedulerController.js` `auxAction`**:
   - `action: 'start'` ahora detecta `flavor === 'FALLA'` y usa duración placeholder de 1 min (no la fija de AUX_DUR)
   - `action: 'finish'` para FALLA: calcula `realDurationMs = now - startedAt`, desplaza TODOS los PENDING posteriores (Liquipops o Geniality) `+realDurationMs`. Notas registran "Falla resuelta en X min — cronograma desplazado"

2. **Nuevo endpoint `failureStats`**:
   - `GET /production/{line}/failure-stats?from=...&to=...`
   - Retorna `{ totalFailures, totalMinutesLost, totalHoursLost, avgDurationMin, longest, byDay, activeFailure }`
   - Útil para KPIs y detectar fallas activas no resueltas

3. **Ruta** en `productionSchedulerRoutes.js`: `router.get('/failure-stats', auth, ...)`

**Frontend `ProductionOperatorPage.jsx`:**

1. **Modal eventos auxiliares** (header móvil) — agregada opción "FALLA" (icono ⚠️ rojo)
2. **Flujo FALLA distinto de otros AUX**:
   - Pide nota descriptiva opcional (no duración)
   - POST schedule con scheduledEnd placeholder + PATCH aux-action 'start'
3. **Banner rojo persistente "FALLA ACTIVA"** — arriba del Panel de Producción cuando hay falla sin resolver. Muestra tiempo transcurrido y nota. Botón "Resolver Falla ✓"
4. **Función `resolveFailure`** — pide nota de resolución, llama PATCH aux-action 'finish', muestra confirmación de minutos perdidos + cronograma desplazado
5. **KPI de fallas hoy** — card roja con conteo + minutos perdidos, polling cada 30s
6. **State `activeFailure`, `failureStats`, `fetchFailureStats`** con useEffect + interval

**Razón:** Permite registrar paradas no planificadas con duración variable, desplaza automáticamente el cronograma al cerrarlas y genera estadística de tiempo perdido por fallas.

## CAMBIO 54: MRP Forecast — incluir materiales de empaque

**`backend/src/controllers/mrpForecastController.js`** — agregado bloque que itera sobre `batch.outputTargets`, busca el AssemblyTemplate del producto final y suma los inputs que matchean `/TARRO|TAPA|ETIQUETA|SELLO|LINER|CAJA/i` multiplicados por `target.plannedUnits`.

Antes solo expandía COMPUESTO/PROTECCION/ESFERAS (raw materials). Ahora también incluye materiales de empaque por cada presentación (350g, 1150g, 3400g) de cada sabor.

Resultado: el modal "Materia Prima Requerida" ahora muestra completas las necesidades para producir, incluidos packaging materials.

## CAMBIO 55: Custom dayLayoutAlgorithm `equalWidthLayout` para calendario

**`frontend/src/pages/ProductionScheduler.jsx`** — agregada función `equalWidthLayout` que reemplaza `dayLayoutAlgorithm="no-overlap"` en ambos calendarios.

**Comportamiento:**
1. Sort eventos por start time
2. Asigna cada evento a un "lane" (carril) basado en overlap (algoritmo greedy first-fit)
3. Calcula `maxLanes` del día
4. Aplica `width = 100/maxLanes` a TODOS los eventos del día (incluso los que solo overlap con 1)

**Razón:** El algoritmo "no-overlap" daba anchos variables — eventos con 2 simultáneos tomaban 50%, con 3 tomaban 33%. Ahora todos tienen el MISMO ancho consistente (basado en el peor caso del día).

## CAMBIO 56: Guard CONTEO sin operario + fix olla grande PROTECCIONES

**1. Guard CONTEO sin operatorId:**
- `backend/src/services/genialityAssemblyService.js` línea ~870 — agregado: `if (note.processType?.code === 'CONTEO' && !operatorId) throw new Error(...)`
- Igual en `backend/src/services/assemblyService.js` línea ~876
- Razón: notas de CONTEO se cerraban automáticamente sin operario (startedAt:null, operatorId:null) por algún proceso automático no identificado

**2. Olla Grande (aggregateOnRepeat) en PROTECCIONES:**
- 286 inputs corregidos en 13 plantillas PROTECCION (todas: CHICLE, FRESA, CEREZA, MANZANA VERDE, CAFÉ, MARACUYA, LYCHE, SANDIA, ICE PINK, MANGO BICHE, CHAMOY, BLUEBERRY, MANGO BICHE CON SAL)
- `aggregateOnRepeat: true` → cuando se programan N baches, se crea 1 sola nota con cantidad × N (no N notas separadas)
- Modelo: SIROPES y PROTECCIONES van en olla grande (juntos), ALGINATO/BASE/PREMEZCLAS en olla chica (bache por bache)

## CAMBIO 57: Eliminar MARCADO_CAJAS duplicado en flujo ENSAMBLE Siigo

**Problema:** En BATCH-LIQUIPOPS hay etapas separadas EMPAQUE (6-8) y ENSAMBLE Siigo (9-11), una por cada tamaño (3400g, 1150g, 350g). Cuando el operario completaba el EMPAQUE (que ya marca cajas) y pasaba al ENSAMBLE Siigo, el wizard le pedía marcar las cajas de NUEVO. Resultado: 3 impresiones extras innecesarias por batch.

**Fix en `frontend/src/components/AssemblyRunner/hooks/useAssemblyNote.js` (línea 251):**

ANTES:
```js
} else if (isEnsamble) {
    steps.push({ type: 'MARCADO_CAJAS', data: noteData });
    steps.push({ type: 'OUTPUT', data: noteData });
    steps.push({ type: 'ENSAMBLE', data: noteData });
}
```

DESPUÉS:
```js
} else if (isEnsamble) {
    // ENSAMBLE Siigo: solo registrar cantidad real y cerrar en Siigo (RPA).
    // El marcado de cajas es responsabilidad del EMPAQUE, no del ENSAMBLE.
    steps.push({ type: 'OUTPUT', data: noteData });
    steps.push({ type: 'ENSAMBLE', data: noteData });
}
```

**Resultado para BATCH-LIQUIPOPS con 3 tamaños:**
- Etapas 6-8 (EMPAQUE de cada tamaño): inputs → empaque → **MARCADO_CAJAS (imprime)** → ensamble local
- Etapas 9-11 (ENSAMBLE Siigo de cada tamaño): **OUTPUT + ENSAMBLE (RPA Siigo)** — sin re-imprimir
- Total: **3 impresiones (no 6)** + 3 cierres en Siigo

## CAMBIO 58: Maquila box size variable según línea (Liquipops 6, Geniality 12)

**Problema:** En el step de MARCADO_CAJAS, `MAQUILA_UNITS_PER_BOX = 6` estaba hardcoded. Eso es correcto para Liquipops (cajas maquila de 6), pero **incorrecto para Geniality** donde toda la producción (incluida maquila) va en cajas de 12.

**Fix en `frontend/src/components/AssemblyRunner/steps/MarcadoCajasStep.jsx` (línea 153):**

```js
// ANTES
const MAQUILA_UNITS_PER_BOX = 6;

// DESPUÉS
const isGeniality = /sirope|geniality/i.test(product.name || '');
const MAQUILA_UNITS_PER_BOX = isGeniality ? defaultUnitsPerBox : 6;
```

**Comportamiento:**
- Liquipops MAQUILA: cajas de 6 (sin cambios)
- Geniality MAQUILA: cajas de 12 (igual que regular)

## CAMBIO 59: calculateBatchMix — fase 2 TOP UP (nunca dejar batch a medias)

**Problema:** El algoritmo `calculateBatchMix` solo asignaba unidades hasta cubrir el déficit (vs stock de seguridad). Si la demanda ya estaba cubierta en otros baches, el sistema sugería un batch con muy pocas unidades (ej: 24 uds 1150 GR = 27 kg en un batch de 120 kg). Resultado: batches medio vacíos, desperdicio de capacidad.

**Fix en `backend/src/controllers/productionSchedulerController.js` línea ~515 (loop GROUP A):**

Refactor a 2 fases:

1. **Fase 1 — Distribución por déficit**: como antes, respeta `mediumDeficitLeft` para distribuir entre items según necesidad real.

2. **Fase 2 — TOP UP**: después de fase 1, si el batch no llegó a `cap`, sigue agregando packs del item de **mayor velocidad de venta** (`dailyVolumeKg`) hasta llenar la capacidad. Iterativo, intenta cada item en orden de velocidad y agrega 1 pack si cabe.

**Resultado:** Cada batch se llena al máximo (~120 kg). El operador nunca produce baches medio vacíos. La sobreproducción va automáticamente al sabor que más rota.

## CAMBIO 60: Doble syrupRatio (Normal + Dioxido) con detección automática

**Problema:** Las Liquipops con BASE DIOXIDO (ej. MANGO BICHE CON SAL) tienen menos líquido de protección, rinden menos unidades por batch que las normales:
- Normal (120 kg jarabe): 60 × 3400g o 160 × 1150g (ratio jarabe/producto ≈ 0.62)
- Dioxido (120 kg jarabe): 40 × 3400g o 140 × 1150g (ratio jarabe/producto ≈ 0.81)

Antes había un solo `syrupRatio: 0.70` que no diferenciaba.

**Cambios:**

1. **PRODUCTION_CONFIG (BD)** — agregado `syrupRatioDioxido: 0.81`, cambiado `syrupRatio: 0.62` (de 0.70)

2. **`backend/src/controllers/productionSchedulerController.js`**:
   - `calculateBatchMix` antes de calcular ratio: busca el COMPUESTO del sabor, si su fórmula incluye `BASE LIQUIPOPS DIOXIDO` (sku PROCELIQUIPOPS54), marca `usesDioxido = true`
   - Aplica `syrupRatioDioxido` o `syrupRatio` según corresponda
   - Default cambiado de 0.70 a 0.62

3. **`frontend/src/pages/AdminConfig.jsx`**:
   - Renombrado label original: "% Jarabe Producto Final — Liquipops NORMAL"
   - Nuevo campo: "% Jarabe Producto Final — Liquipops DIOXIDO" (emerald)
   - `syrupRatioDioxido` agregado a `floatFields` y a `getDisplayValue` defaults

**Detección dinámica:** Cualquier sabor cuyo COMPUESTO use BASE LIQUIPOPS DIOXIDO se trata como dioxido automáticamente — no hay lista hardcoded.

## CAMBIO 61: Numeración de baches X/Y excluye COMPLETED/FAILED

**Problema:** En el calendario aparecía "FRESA 17/26" para el primer batch pendiente, porque la numeración contaba los 16 baches COMPLETED de días anteriores + los 10 PENDING actuales.

**Fix en `backend/src/controllers/productionSchedulerController.js` (`getSchedule`):**

```js
const sortedBatches = [...batches]
    .filter(b => !AUX_FLAVORS.includes(b.flavor))
    .filter(b => b.status !== 'COMPLETED' && b.status !== 'FAILED')  // ← NUEVO
    .sort(...);
```

**Resultado:** El primer PENDING ahora aparece como "1/N" donde N = total de baches activos del sabor (no incluye los ya terminados).

## CAMBIO 62: Sincronización automática Fórmula → Plantilla (CRUD completo)

**Problema:** Al editar una fórmula desde la UI, solo se actualizaban los inputs EXISTENTES de la plantilla. No se agregaban ingredientes nuevos ni se eliminaban los obsoletos. Esto causaba desfases (ej. agregar PROTONICO + CONSERVANTES a FORM085 no se reflejaba en TMPL063).

**Fix en `backend/src/controllers/formulaController.js` `updateFormula` (línea ~349):**

Antes solo hacía UPDATE de inputs existentes. Ahora hace los 3 niveles de sincronización:

1. **UPDATE**: actualizar `quantityPerUnit` + `displayOrder` de inputs que matchean
2. **CREATE**: agregar inputs nuevos cuando la fórmula tiene ingredientes que no están en la plantilla
3. **DELETE**: borrar inputs obsoletos que ya no están en la fórmula

**Excepción:** Stages CONTEO se siguen omitiendo (no tienen inputs de fórmula).

**Beneficio:** El operador edita la fórmula y la plantilla queda sincronizada automáticamente — ya no hay que abrir el editor de plantilla y presionar "Guardar" manualmente.

## CAMBIO 63: Consolidación de pedidos READY del mismo distribuidor

**Schema (`prisma/schema.prisma`)** — agregados 3 campos a `Order`:
- `isConsolidation: Boolean @default(false)`
- `consolidatedIntoOrderId: String?` (FK a Order — para los originales)
- `consolidatedFromOrderIds: String[]` (array IDs originales — para el consolidado)

**Backend `orderController.js` `consolidateOrders`** (POST /api/orders/consolidate):
- Valida: mismo distribuidor, status READY, no consolidados antes
- Crea nuevo Order `CON-XXXX` con `isConsolidation: true`
- Items: suma cantidades por productId
- Notas: `"Consolidado de pedidos: ORD-001, ORD-002\n--- Notas originales ---\n[ORD-001] notas..."`
- Copia OrderPickingItems (lotes ya asignados) al consolidado
- Marca originales con `consolidatedIntoOrderId` (visibles pero referenciados)

**Backend `orderControllerExtensions.js` `invoiceOrder`** (modificación):
- Si `order.isConsolidation`: skip FIFO deduction (evita doble descuento de inventario)
- Cascade: marca originales como INVOICED al facturar el consolidado

**Frontend `OrderManagement.jsx`**:
- State `selectedForConsolidation: Set<string>`
- Checkboxes en pedidos READY (solo admin/logistica)
- Barra superior con contador y validación visual (purple si mismo distribuidor, amber si distinto)
- Botón "Consolidar N pedidos" con confirmación
- Badges en cards: "CONSOLIDADO (N)" en el nuevo, "Consolidado en otro pedido" en originales

**Razón:** Cuando varios pedidos del mismo distribuidor van a la misma estiba/dirección, el operador podía facturarlos en una sola factura en lugar de chulear lote por lote en N facturas distintas.

## CAMBIO 64: KPI Mensual con desglose por Líder (bonificación + compañerismo)

**Frontend `ProductionKpiPage.jsx`** — sección "Consolidado Mensual por Líder":
- Aumentado `PER_PAGE` de 6 a 21 (semana completa visible sin paginar)
- Agrega bloque mensual sobre la lista de turnos con desglose por líder
- Métricas a nivel mes:
  - Adherencia al horario promedio (de `adherenceData.batches`)
  - Baches ejecutados / programados
  - Tiempo promedio de esferificación
  - Preparación entregada (intermedios completados: ALG, BASE, PROT, PREMZ, SIROPE)
- Métricas a nivel líder (atribución por bache vía `batchToLeader` map de los turnos):
  - mismas 4 métricas + cuadrilla agregada de todos los turnos del líder en el mes
  - shift breakdown (mañana/tarde/noche) — porque líder y cuadrilla pueden trabajar en distintos turnos
  - Badge "✓ BONO" si rendimiento ≥90% Y compañerismo ≥1 intermedio/turno
  - Badge "⚠ Sin compañerismo" si rendimiento OK pero baja preparación entregada (consume sin dejar)

**Backend `kpiController.js` `getScheduleAdherence`**:
- Nueva query `intermediateBatches`: productionBatches sin nota FORMACION + COMPLETED en el periodo (= intermedios)
- `classifyIntermediate(flavor)` — mapea por keywords del flavor (ALGINATO, BASE, PROTECCION, PREMEZCLA, SIROPE)
- Acumula por `dateStr_shift` y agrega como `intermediatesPrepared` a cada item de `shiftCompletion`

**Razón filosófica del usuario:**
> "Un equipo puede rendir porque le dejan todo preparado pero no deja nada para el siguiente. Esto no es compañerismo. La empresa crece cuando todos preparan al siguiente."

La bonificación grupal ahora exige doble condición: cumplir su meta Y dejar al siguiente turno con preparación. Penaliza al equipo que solo consume el inventario intermedio sin reponerlo.

## CAMBIO 65: Modelo operativo Liquipops calibrado en el programador (FASE 1)

Se calibró el programador con el modelo operativo real de Liquipops descrito por el usuario:
- Turnos 06/14/22 con entrega de turno 06:00–06:20, 14:00–14:20, 22:00–22:20 (informativa, NO bloqueo)
- BASE 30 min en marmita (líder)
- Esferificación 60 min/bache (cuello de botella)
- LAVADO de marmita: solo cuando cambia el sabor o cuando se hace ALGINATO
- ALGINATO cada 3 baches FINALES consecutivos en la misma marmita (35 min)
- Cambio de agua del tanque: lo registra el líder manualmente, NO se programa

**Backend `productionSchedulerController.js`:**
- Constantes nuevas: `LIQUIPOPS_BASE_DURATION_MIN=30`, `ALGINATO_DURATION_MIN=35`, `ALGINATO_EVERY_N_BATCHES=3`, `SHIFT_HANDOVER_WINDOWS`
- `AUX_FLAVORS` y `AUX_DUR` ampliados: `['ALGINATO', 'BASE']` con duraciones 35 y 30
- Helper `countConsecutiveFinalBatches(refTime)` — cuenta hacia atrás baches Liquipops finales (excluye AUX) con MAX_SESSION_GAP de 3h
- Helper `getLastFinalBatchBefore(refTime)` — devuelve el último final no-AUX antes de refTime
- Helper `createAuxEvent(flavor, start, end, notes)` — crea AUX simple sin outputTargets
- `createBatch` extendido (Liquipops, no AUX):
  - Si `lastFinal.flavor !== flavor` → inserta AUX `LAVADO` (60 min) ANTES del bache nuevo (encaja en el hueco si lo hay; sino empuja `adjStart`)
  - Crea AUX `BASE` (30 min) en `[scheduledStart-30, scheduledStart]` para visualizar la carga del líder
  - Si `(priorCount+1) % alginatoEveryN === 0` → tras el bache, encadena `LAVADO` (60min) + `ALGINATO` (35min) automáticamente

**Backend `routes/productionSchedulerRoutes.js`:**
- Nueva ruta `GET /production/liquipops/operational-meta` → devuelve `{ handoverWindows, alginatoEveryN, baseDurationMin, alginatoDurationMin }` para que el frontend pinte/configure

**Backend `configController.js`:**
- Defaults nuevos en `PRODUCTION_CONFIG`: `liquipops_baseDurationMin`, `liquipops_alginatoDurationMin`, `liquipops_alginatoEveryN`, `liquipops_handoverWindows`

**Frontend `ProductionScheduler.jsx`:**
- Estado `operationalMeta` cargado desde el endpoint en `useEffect`
- `slotPropGetter` del calendario pinta las ventanas de entrega de turno con un fondo amarillo tenue (10% opacity) y línea punteada — solo informativo, el operario puede programar dentro

**Razón:** los KPIs antes se medían contra una meta equivocada (BASE 40 min, sin lavados/alginato automáticos). Con esto el cronograma refleja el ritmo real y se sientan las bases para Fase 2 (KPIs por rol líder vs operarios) y Fase 3 (alertas anómalas).

**FASE 1 NO incluye:**
- Cambio de agua automático (decisión: el líder lo registra manualmente, ya causaba demasiados desplazamientos)
- KPIs por rol líder vs operarios (Fase 2)
- Alertas de comportamiento anómalo (Fase 3)
- Programación del líder como recurso separado (no se modela; el líder supervisa)

**REVISIÓN 2026-04-28 (después de probar):** se eliminaron los AUX automáticos LAVADO/ALGINATO/BASE creados en `createBatch`. El usuario reportó que generaban demasiados eventos en el calendario y complicaban los desplazamientos al correr baches adelante o atrás. Se mantienen las constantes y el endpoint `/operational-meta`, pero ahora el endpoint solo devuelve la **capacidad teórica diaria calculada** (ej. 5 baches/turno × 3 = 15/día con `alginatoEveryN=3`) que se muestra como badge informativo en el header del cronograma. Cero eventos AUX automáticos. El líder/operario sigue creando manualmente LAVADO/CAMBIO DE AGUA cuando los hace en planta.

Eventos AUX auto-creados durante la prueba (9 en total: 6 BASE + 3 ALGINATO) fueron borrados con script de limpieza.

## CAMBIO 66: FinishedProductZonePage — fallback de approved_qty=0 al stock real

**Archivo:** `frontend/src/pages/FinishedProductZonePage.jsx` (función `openTransfer`)

**Problema:** Cuando el operario completa la nota EMPAQUE sin diligenciar `conteo_qty` / `approved_qty` (queda en 0), el modal "Transferir entre zonas" mostraba `Cantidad (máx: 0 — 0 aprobadas)` y bloqueaba la transferencia a Producto Terminado, aunque hubiese stock real disponible en zona PRODUCCION.

**Caso reportado:** lote `MANGO-BICHE-CON-SAL-260427-0829`, presentaciones LIQUIPP13 (82 uds) y LIQUIPM13 (29 uds) tenían `approved_qty=0` aunque el stock estaba en 82 y 29.

**Fix:** En `openTransfer`, al recibir el lot-summary, si `match.approved===0 && match.defective===0` (señal de que no se diligenció), usar `stock.currentQuantity` como `approved` para no bloquear el botón. Si efectivamente hubo defectuosas o aprobadas reales, se respeta el dato.

**Backfill datos:** se actualizaron las dos notas EMPAQUE del batch `c1142814-3ee7-459e-b42f-3e390ccc8ecf` poniendo `approved_qty` igual a `actualQuantity` para destrabar la transferencia.

## CAMBIO 67: Rescheduling con cola compacta única (sin solapes ni saltos al final)

**Archivo:** `backend/src/controllers/productionSchedulerController.js` función `rescheduleAfterBatchStart` (línea 1556-1597).

**Problema previo:** cuando un bache se iniciaba tarde:
1. Algunos baches se mandaban al "final de la cola" (días después) — split entre `afterBatches` y `skippedBatches` rompía la escalera.
2. Cuando el reschedule corría con deltas distintos en momentos distintos, baches de cadenas diferentes (MANGO BICHE, MARACUYA, FRESA...) terminaban con drifts desiguales y se solapaban en el calendario.

**Fix:** reescritura con algoritmo de **cola compacta**:
- `cursor = realStart` del bache que se acaba de iniciar
- Listar PENDING (no AUX) ordenados por `originalScheduledStart`
- Asignar `scheduledStart = cursor + 60min`, avanzar cursor
- Resultado: una sola cola física para todos los sabores, sin solapes, escalera de 60 min preservada

**Razón filosófica del usuario:** "es coger todos los baches que están delante y sumarles la cantidad de tiempo para que se desplacen". Modelo: un solo tanque de esferificación = una sola cola física. El sabor no separa cadenas.

**Limitaciones aceptadas:** AUX (LAVADO, CAMBIO DE AGUA) no se incluyen en la cola del cursor — el operario los coloca manualmente y se mantienen donde quedaron. Stagger asume esferificación ≤ 60 min.

**Datos limpiados durante la migración:**
- 3 baches MANGO BICHE PENDING que estaban en 1 mayo restaurados a su escalera del 28/04
- 68 baches PENDING reordenados con cola compacta desde el último iniciado (1240, 12:40)

## CAMBIO 68: Plantilla BASE LIQUIPOPS DIOXIDO ahora con 4 stages

**Plantilla TMPL049** ampliada de 2 → 4 stages:
1. PESAJE — 7 inputs
2. **COCCION** "Cocción a 78°C" — sin inputs (control), `processParameters.targetTemperature: 78`
3. **COCCION** "Enfriamiento a 34°C" — sin inputs (control), `processParameters.targetTemperature: 34`
4. ENSAMBLE — 7 inputs

Sigue el patrón de TMPL-BASELIQ-001 (BASE regular) que también usa 2 stages COCCION para representar Calentamiento + Enfriamiento (no existe processType `ENFRIAMIENTO` en el catálogo Liquipops, solo `GE_COCCION` que es de Geniality).

**Razón:** la cocción de DIOXIDO es a 78°C (no 75°C como la regular) y debe enfriarse hasta 34°C antes de pasar al COMPUESTO. El `targetTemperature` se persiste en `processParameters` para que `CoccionStep.jsx` lo lea sin caer al default 105°C hardcodeado.

**Migración batch activo:** la nota activa de la BASE LIQUIPOPS DIOXIDO dentro del batch `MANGO-BICHE-CON-SAL-260427-2354` también recibió los 2 stages nuevos en estado PENDING (PESAJE seguía EXECUTING al momento del cambio).

**Pendiente:** cambiar el fallback `targetTemp = params.targetTemperature || 105` en `CoccionStep.jsx:12` por `null` o por parsing del `stageName`, para evitar que futuras plantillas sin temperatura definida muestren 105°C engañosamente.

## CAMBIO 69: G_EMPAQUE Geniality — botón Finalizar ahora cierra correctamente

**Archivo:** `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx` (handleComplete).

**Problema:** En notas G_EMPAQUE de Geniality (siropes), los `wizardSteps` construidos por [useAssemblyNote.js:238-244](frontend/src/components/AssemblyRunner/hooks/useAssemblyNote.js#L238-L244) son solo `G_CONTEO_CARRITOS` y `MARCADO_CAJAS`. Pero la lógica de cierre Geniality (auto-completar ENSAMBLE + ingest finished-lots) estaba dentro del branch `else if (currentStep?.type === 'CONTEO')`. Como CONTEO nunca aparece en wizardSteps de G_EMPAQUE, ese branch jamás se ejecutaba y el operario presionaba "Finalizar" sin que la nota se cerrara.

**Caso reportado:** batch `ESCARCHADOR-260423-1641`, stage 8 (G_EMPAQUE 360 ML) llevaba 4 días en `EXECUTING` con `actualQuantity: null` aunque las 278 unidades ya estaban ingestadas en zona PRODUCTO_TERMINADO por otro flujo.

**Fix:** nuevo branch en `handleComplete` antes del `else` genérico final, que detecta `note.processType?.code === 'G_EMPAQUE'` y replica el flujo del branch CONTEO:
1. Calcula `totalRealQty` desde `empaqueCarriots` recibidos (fallback a outputTargets/targetQuantity)
2. Persiste `processParameters.conteo` con los reales por producto
3. Llama `/complete` de la nota G_EMPAQUE
4. Auto-completa todas las G_ENSAMBLE/ENSAMBLE pending del batch con su qty correspondiente
5. Dispara `/finished-lots/ingest` (idempotente: ignora `DUPLICATE_INGESTION`)

Idempotente: si ENSAMBLE ya estaba COMPLETED o el stock ya estaba ingestado, los errores duplicados se suprimen.

## CAMBIO 70: Botón "No producido" para presentaciones EMPAQUE con real=0

**Archivo:** `frontend/src/components/AssemblyRunner/steps/IntroStep.jsx`.

**Problema:** En el selector EMPAQUE multi-presentación, si una presentación tiene `REAL FABRICADO = 0` (porque no se produjo), el operario quedaba bloqueado: el sistema le exigía imprimir etiquetas y completar ENSAMBLE con 0 unidades, cosa que MARCADO_CAJAS no permitía ("Ajusta la distribución de cajas").

**Caso reportado:** batch `MANGO-BICHE-CON-SAL-260427-1416`, presentación 1150g programó 144 uds pero real=0 (350g hizo 81 y 3400g hizo 40). El selector mostraba "1 pendiente" y bloqueaba avanzar.

**Fix:**
1. Nuevo handler `handleNoProducido(empaqueNote)` que pide confirmación y luego:
   - START de la nota EMPAQUE si está PENDING
   - COMPLETE con `actualQuantity = 0` y observación "No producido — presentación marcada como 0 unidades"
   - START + COMPLETE con qty=0 de las G_ENSAMBLE/ENSAMBLE pendientes del mismo `productId`
2. Botón **"❌ No se produjo esta presentación"** en cada tarjeta del selector cuando `!isCompleted && (actualConteo === 0 || null)`
3. Texto explicativo: "Cierra con 0 unidades — no imprime etiquetas ni envía a Siigo"

**Razón operativa del usuario:** "para Siigo no importa, pero para la adherencia del programa importa". Queda registrado el 0 (programó 144, real 0 = 0% adherencia para esa presentación) sin disparar RPA Siigo ni imprimir etiquetas innecesarias.

## CAMBIO 71: Consolidación de pedidos — fix copia de pickingItems

**Archivo:** `backend/src/controllers/orderController.js` función `consolidateOrders`.

**Bug encontrado durante prueba:** la copia de OrderPickingItems al consolidado usaba `where: { orderId: { in: orderIds } }`, pero el modelo `OrderPickingItem` se relaciona con `OrderItem` por `orderItemId`, NO con `Order` por `orderId`. La query retornaba 0 silenciosamente y el consolidado quedaba sin lotes asignados → la factura Siigo saldría sin información de lotes.

**Fix:**
1. Buscar `OrderItem` (con sus pickingItems) de los originales
2. Construir un `Map<productId, newOrderItemId>` del consolidado
3. Para cada pickingItem original, copiar al `OrderItem` del consolidado con el mismo `productId`, ajustando el campo correcto `orderItemId`

**Reparación del consolidado actual:** se copiaron los 122 pickingItems de los originales `ORD-TOPPING-17042026-1-BKO3` y `ORD-TOPPING-FROZEN-22042026-5-BKO3` al consolidado `CON-TOPPING-FROZEN-0001`. Verificado: scanned totals coinciden con los originales (incluyendo las diferencias de "Completado Parcial 22%/51%" que se preservan fielmente).

**Otros bugs colaterales del flujo consolidación corregidos:**
- `OrderItem.create` faltaba `pendingQty` (campo requerido en schema). Fix: `pendingQty = max(0, requestedQty - allocatedQty)`.
- Frontend `OrderManagement.jsx` usaba `api.post` en lugar de `axios.post(API_URL, ..., AUTH())` — `api` no estaba importado en ese archivo.
- Frontend `OrderManagement.jsx` llamaba `fetchOrders()` que no existe — el archivo usa `useQuery`. Cambiado a `queryClient.invalidateQueries(['admin-orders'])` y `['order-counts']`.

## CAMBIO 72: Cascada DISPATCHED y DELIVERED para pedidos consolidados

**Archivo:** `backend/src/controllers/orderControllerExtensions.js` (`dispatchOrder` y `deliverOrder`).

**Problema:** El CAMBIO 67 cascadeó solo INVOICED de consolidado → originales. Al despachar, los originales quedaban en INVOICED mientras el consolidado pasaba a DISPATCHED — generaba botón "Despachar" pendiente sobre los originales en la UI cuando ya no aplica.

**Fix:**
1. **`dispatchOrder`**: si `order.isConsolidation`, después de actualizar el consolidado a DISPATCHED, hace `updateMany` sobre los `consolidatedFromOrderIds` con los mismos datos de despacho (driver, placa, destino, etc.) excepto `transportGuideNumber/trackingGuide` (únicos por order). Skip de la deducción de stock (ya se descontó en originales al alistar).
2. **`deliverOrder`**: cascada DELIVERED a originales con `deliveredAt` cuando se confirma entrega del consolidado.

**Reparación de datos:** los 2 originales del consolidado `CON-TOPPING-FROZEN-0001` que habían quedado en INVOICED tras el primer despacho fueron actualizados manualmente a DISPATCHED con los datos del consolidado (driver BRAYAN TOVAR, etc.).

## CAMBIO 73: Ocultar pedidos originales consolidados del listado

**Archivos:**
- `backend/src/controllers/orderController.js` (`getOrders`)
- `backend/src/controllers/orderControllerExtensions.js` (`getOrderCounts`)

**Problema:** En la pantalla "Gestión de Pedidos" aparecían tanto el consolidado como los pedidos originales que ya fueron fusionados (cada uno con badge "Consolidado en otro pedido"). Generaba confusión: tanto admin como distribuidores podían pensar que eran pedidos diferentes pendientes y ejecutar acciones sobre los originales (despachar, confirmar entrega) cuando ya están representados por el consolidado.

**Fix:** filtro por defecto `where.consolidatedIntoOrderId = null` en:
1. `getOrders` (listado por status)
2. `getOrderCounts` (contadores de pestañas)

Para auditoría/debug, `getOrders` acepta el query param `?includeConsolidated=1` que omite el filtro y muestra los originales nuevamente.

**Resultado en UI:** la pestaña Despachado de TOPPING FROZEN ahora muestra **solo** `CON-TOPPING-FROZEN-0001`, no los 2 originales (que siguen en BD con `consolidatedIntoOrderId` apuntando al consolidado, pero ya no se ven en el listado normal).

## CAMBIO 74: Auto-save de PESAJE individual (INPUT) — persistencia al salir/recargar

**Archivo:** `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx` (efecto `savePesajeDraftTimeout`).

**Problema:** En el flujo de PESAJE uno-a-uno (currentStep.type === 'INPUT', usado en plantillas como PROTECCION MANGO BICHE), el operario escribía el peso, tomaba foto y seleccionaba lote, pero la persistencia al backend SOLO ocurría cuando presionaba "Confirmar" (en `handleNext`). Si salía o recargaba antes, perdía todo.

El auto-save por debounce que existía solo cubría `PESAJE_BATCH` (multi-item en una sola pantalla), no `INPUT`.

**Fix:** extendí el efecto de auto-save para que también maneje `currentStep.type === 'INPUT'` (item individual). El efecto detecta cualquier cambio en `actualQuantities`, `lotNumbers`, `weighingPhotos` o `lotSelections`, espera 2s de debounce y persiste al backend:
1. PATCH `/assembly-notes/:id/items/:itemId` con `actualQuantity` y `lotNumber`
2. PATCH `/assembly-notes/:id` con `processParameters.weighing_photos` y `processParameters.lot_selections`

La hidratación al recargar ya existía (en `useAssemblyNote.js:312-326` para items y en el wizard `:144-154` para photos/lot_selections), así que al volver a entrar al batch los valores se restauran automáticamente.

**Caso reportado:** batch `PROTECCION-MANGO-BIC-260428-1602-S1-AGG`, ingrediente 2 de 12 (AGUA). El operario perdía el progreso al salir.

## CAMBIO 75: Factura Siigo — observaciones con cada lote en línea separada

**Archivo:** `backend/src/services/siigoService.js` función `createInvoice` (línea ~700).

**Problema:** En las observaciones de la factura, cuando un producto se entregaba con varios lotes, todos iban en una sola línea separados por coma:
```
CHAMOY 3400GR: 164 uds - Lote: CHAMOY-260425-0414, CHAMOY-260425-1215, CHAMOY-260425-1131, CHAMOY-260425-0510
```
Difícil de leer y sin desglose de cuántas uds por lote.

**Fix:** nuevo formato — producto en su propia línea con total y conteo de lotes, y cada lote en una línea separada con su cantidad real:
```
CHAMOY 3400GR: 164 uds (4 lotes)
  • CHAMOY-260425-0414: 50 uds
  • CHAMOY-260425-1215: 50 uds
  • CHAMOY-260425-1131: 40 uds
  • CHAMOY-260425-0510: 24 uds
```

Suma uds por lote (combinando pickingItems repetidos del mismo lote). Sigue respetando el límite de 5000 caracteres con `substring(0, 5000)`.

## CAMBIO 76: Iniciales del operario en TODOS los rótulos Zebra

**Archivo central:** `frontend/src/services/zplLabelBuilder.js`.

Se exporta el helper `toInitials(name)` (ej: "JOHN EDISSON CAICEDO" → "JEC") y se agrega el campo opcional `printedBy` a:
- `renderLabel` (etiquetas de lote estándar) — pinta `Op:JEC` junto al timestamp inferior
- `renderCarritoLabel` (etiquetas de carrito Geniality) — pinta `Op: JEC` junto a `Cart 1 de 1`

**Componentes actualizados** (todos importan `toInitials` y pasan `printedBy: toInitials(user?.name)` al builder):
1. `pages/MaterialZonePage.jsx` — etiquetas de lotes de materia prima
2. `pages/Labeling.jsx` — etiquetadora general
3. `pages/FinishedProductZonePage.jsx` — 4 invocaciones (ingest, NC, modal print, NC del modal)
4. `components/inventory/LotManagementModal.jsx` — etiquetas desde modal de gestión de lotes
5. `components/Printers/ThermalPrintModal.jsx` — modal de impresión multi-pack
6. `components/AssemblyRunner/steps/PrintLotStep.jsx` — etiqueta de lote intermedio en wizard
7. `components/GenialityRunner/steps/GConteoCarritosStep.jsx` — etiquetas de carritos Geniality

**Bug corregido en este componente:** `handlePrintCarrito` usaba `carriots.indexOf(carrito) + 1` (índice global) que devolvía un número distinto al display cuando había varios productos. Ahora recibe `displayNum` (el mismo `i + 1` filtrado por producto que se muestra en pantalla).

**No modificado:** `ConteoStep.jsx` ya imprime el nombre del operario en su footer (formato propio, no ZPL standard), no necesita cambio.

**Resultado en cada etiqueta:**
```
... resto del rótulo ...
DD/MM/YYYY HH:MM  Op:JEC      ← nuevo
```

## CAMBIO 80: /marcaje multi-método (PIN/Cédula/Cara) + consolidación a Control de Ingreso

### Backend

**`attendanceController.js`** — agregados 2 endpoints nuevos siguiendo el patrón de `pinMark`:

```
POST /api/attendance/cedula-mark   body: { cedula: "1234567890", action: "IN"|"OUT" }
POST /api/attendance/face-mark     body: { descriptor: [128 floats], action: "IN"|"OUT" }
```

Helper interno `_markEmployeeAttendance({ shiftEmployee, action, methodLabel })` reutilizado por las 3 variantes (PIN/CEDULA/FACE) — idempotencia 4h, source=HANDOVER, notes etiquetan método.

`face-mark` compara descriptor recibido contra todos los empleados con `faceDescriptor` registrado, threshold euclidiana 0.5, retorna mejor match o 401 si nadie coincide.

Rutas registradas como públicas en `attendanceRoutes.js` (sin auth, igual que pin-mark).

### Frontend

**`pages/MarcajePage.jsx`** — rediseñada con 3 pestañas (PIN/Cédula/Cara). Carga `face-api.js@0.22.2` desde CDN dinámicamente solo cuando se abre la pestaña Cara, modelos de @vladmandic con fallback. Detección continua cada 800ms; cuando hay cara, descriptor de 128 floats viaja al backend al tocar IN/OUT. Mismo flujo de feedback verde/rojo.

### Refactor: consolidación de Gestión Laboral en Control de Ingreso

**Razón:** 3 módulos (Cuadro de Turnos + Control de Ingreso + Gestión Laboral) producían cruces — ausencias se podían registrar en 2 lugares (`shiftAbsence`), reportes desconectados del marcaje real.

**Cambios:**
- `pages/AttendancePage.jsx`: agregada pestaña **"Operación"** que renderiza `<LaborManagementPage />` embebido. Tab state ahora soporta deep-link via `?tab=operation`.
- `App.jsx`: Route `/labor-management` → `<Navigate to="/attendance?tab=operation" replace />` (preserva bookmarks).
- `Sidebar.jsx`: entry "Gestión Laboral" eliminada del menú lateral.
- `LaborManagementPage.jsx`: SIN cambios internos (sigue funcionando idéntico, solo cambia su contenedor).

**Convención operativa final:**
- Ausencias programadas → solo en Cuadro de Turnos.
- Ausencias del día → solo en Cuadro de Turnos.
- Marcaje real → `/marcaje` (PIN/Cédula/Cara) o firma de relevo.
- Reportes/aprobación de extras/cierres → tab Operación de Control de Ingreso.

**Validación en producción (29-abr 13:51-13:55):** primer relevo MAÑANA→TARDE generó 10 AttendanceRecord automáticos con source=HANDOVER (5 EXIT del turno saliente + 5 ENTRY del entrante). Cero firmas tardías, cero registros duplicados con kiosko.

## CAMBIO 79: Control de horas — firma del relevo + marcaje por PIN + aprobación manual de extras

Conjunto de cambios para que las horas trabajadas y horas extras de los 20 empleados activos queden registradas automáticamente sin doble paso (no kiosko + relevo, solo relevo).

### 79.A — Schema (`prisma/schema.prisma`)

**Nuevo enum value**: `AttendanceSource.HANDOVER` (existían KIOSK, MANUAL — agrega HANDOVER para distinguir registros generados por firma de relevo o marcaje por PIN).

**Nuevo modelo `OvertimeApproval`**:
```
model OvertimeApproval {
  id           String        @id @default(uuid())
  employeeId   String
  date         DateTime      @db.Date
  dayHours     Float         @default(0)
  nightHours   Float         @default(0)
  reason       String
  approvedById String
  approvedAt   DateTime      @default(now())
  ...
  @@map("overtime_approvals")
}
```

Migración: `prisma db push` (no requiere data migration). Relaciones inversas en `User.approvedOvertimes` y `ShiftEmployee.overtimeApprovals`.

### 79.B — Helper `recordHandoverAttendance` (attendanceController.js)

Cuando un operador firma el relevo, se llama de forma no-bloqueante para crear un `AttendanceRecord` con source=HANDOVER:

- **Idempotencia**: si ya hay record (cualquier fuente) en últimas 4h, no duplica.
- **Cap +10 min en OUT**: si saliente firma tarde, timestamp se topa en `endHourOfShift + 10 min`. Sábado usa horarios sabatinos (MANANA→TARDE 12:00, TARDE 18:00).
- **No-bloqueante**: cualquier excepción se loguea, no propaga.

Cableado en 4 endpoints de `shiftHandoverController.js`: `signOperator` (OUTGOING/INCOMING), `authorizeOutgoing`, `acceptIncoming`.

### 79.C — Endpoint `/api/attendance/pin-mark` + página `/marcaje`

Para personal de horario fijo (LOGISTICA, ASEO, EMPAQUE 8-17) que no pasa por el relevo.

```
POST /api/attendance/pin-mark   (público, sin auth)
body: { pin: "1234", action: "IN" | "OUT" }
```

Frontend: ruta nueva `/marcaje` en `App.jsx` (fuera de `ProtectedRoute`). Componente `pages/MarcajePage.jsx`: teclado numérico estilo kiosko, dos botones grandes (verde ENTRADA / rojo SALIDA), reloj en tiempo real.

### 79.D — Aprobación manual de horas extras (admin)

Endpoints:
- `GET    /api/attendance/overtime-approvals?employeeId&from&to` (auth)
- `POST   /api/attendance/overtime-approvals` (auth + ADMIN_ROLES)
- `DELETE /api/attendance/overtime-approvals/:id` (auth + ADMIN_ROLES)

POST valida: empleado existe, fecha válida, horas día/noche 0-24 (al menos una >0), motivo ≥3 chars. Si empleado tiene `ShiftAbsence` ese día → graba pero retorna `warning` (no bloquea — admin puede aprobar parcial-day).

UI nueva en `LaborManagementPage.jsx`: sección "Aprobar horas extra" (form: colaborador, fecha, horas día/noche, motivo) + tabla "Horas extra aprobadas" con motivo, aprobador, botón eliminar.

### 79.E — Integración con `getLaborSummary` (laborSummaryService.js)

Las aprobaciones manuales se cargan en paralelo con records/absences/assignments. En el loop por empleado, se suman a `dayMap` antes de `finalizeEmployeeSummary`:

```js
for (const approval of employeeApprovals) {
    const row = ensureDayRow(dayMap, toDateKey(approval.date));
    row.overtimeDayMinutes += Math.round((approval.dayHours || 0) * 60);
    row.overtimeNightMinutes += Math.round((approval.nightHours || 0) * 60);
}
```

Resultado: el reporte de quincena muestra `overtimeDayHours`/`overtimeNightHours` que solo incluyen lo aprobado manualmente (cap auto en OUT impide acumulación natural por demora).

### 79.F — Turno DIURNO definido (data fix)

Insertado en `shiftScheduleDefinition` el registro `DIURNO` (08:00-17:00 L-V, 08:00-13:00 sábado). Antes había asignaciones `shift='DIURNO'` para HUGO/LEDDY/ALBA pero sin definición → horas programadas salían 0.00. Ahora calcula correctamente.

### Convención operativa

- **Turnos rotativos** (17 personas) → firman relevo con PIN → check-in/out auto.
- **Horario fijo DIURNO** (3 personas: LOGISTICA, ASEO, EMPAQUE 8-17) → marcan en `/marcaje` con PIN.
- **Horas extras** → solo se acumulan si admin las aprueba en `Gestión Laboral → Aprobar horas extra`.
- **Ausencias** → se registran en `Cuadro de Turnos → Ausencias` (programadas) o `Gestión Laboral → Novedad laboral` (mismo día). Ambas escriben en `ShiftAbsence`. Relevo y check-in/out auto las respetan.

**Razón:** unificar registro de horas con el flujo del relevo que ya está en producción. Evita doble paso (kiosko + relevo) y errores humanos. Los 20 empleados activos tienen PIN registrado.

## CAMBIO 77e: Ingredientes (GLUCOSA/FRUCTOSA) excluidos del check de secuencia obligatoria

**Backend `assemblyNoteController.js` `quickStart`** (línea ~1304):

La validación "Debes iniciar el bache anterior primero (X). No puedes saltar baches en la secuencia." obliga a iniciar los baches en orden cronológico dentro de cada línea (LIQUIPOPS o GENIALITY). Se aplicaba SIN distinguir entre baches de sabores y baches de ingredientes (GLUCOSA, FRUCTOSA — productos con SKU `PROCELIQUIPOPS26`/`PROCELIQUIPOPS43`).

Resultado: si un sabor (ej. MARACUYA) estaba programado antes que GLUCOSA, el operador no podía iniciar GLUCOSA hasta arrancar MARACUYA — pero MARACUYA depende de GLUCOSA (la usa como insumo), creando un deadlock operacional.

```js
// Agregado al inicio de la validación:
const INGREDIENT_SKUS = ['PROCELIQUIPOPS26', 'PROCELIQUIPOPS43'];
const thisIsIngredient = thisBatch?.outputTargets?.some(t => INGREDIENT_SKUS.includes(t.product?.sku));
if (thisBatch?.scheduledStart && !thisIsIngredient) {
    // ... validación de secuencia (ahora también excluye ingredientes del firstPending lookup)
    const firstPending = await prisma.productionBatch.findFirst({
        where: {
            ...,
            outputTargets: {
                some: { product: { group: { name: lineGroup } } },
                none: { product: { sku: { in: INGREDIENT_SKUS } } }  // ← excluir ingredientes
            },
        },
        ...
    });
}
```

**Razón:** ingredientes son insumos intermedios que se preparan en paralelo a sabores; no deben encolarse secuencialmente con ellos.

## CAMBIO 77d: ProductionScheduler — propagar templateCode al modalData (real fix)

**Frontend `pages/ProductionScheduler.jsx`** `handleSelectEvent` (línea ~1398):

`ProductionScheduler.jsx` ES la página real que sirve la ruta `/production/view` para AMBAS líneas Liquipops y Geniality (la pestaña interna cambia `activeLine`). El archivo `pages/Geniality/GenialityScheduler.jsx` está huérfano (no está en el routing de App.jsx).

El bug: `handleSelectEvent` no propagaba `event.templateCode` ni `event.baseWeight` al `setModalData`. Cuando el operador hacía click en un bache de ingrediente (GLUCOSA, FRUCTOSA) y presionaba "Iniciar Producción", el botón verificaba `modalData.templateCode` (que era undefined) y caía en `handleLaunchBatch` con `BATCH-GENIALITY` (flujo de SIROPES). Resultado: 9 etapas equivocadas (BASE SIROPE CLASICA → SABORIZACION → CONTEO → EMPAQUE) en lugar de las 6 correctas de `TMPL-AZINV-001` (Pesaje de Agua/Azúcar/Ácido → Adición → Cocción 105°C → Enfriamiento → Medición Brix/pH → Ensamble Siigo).

```js
// Antes:
setModalData({
    ...,
    totalSyrupKg: event.baseWeight,
    mix: event.mix,
    // (sin templateCode ni baseWeight)
});

// Ahora:
setModalData({
    ...,
    totalSyrupKg: event.baseWeight,
    baseWeight: event.baseWeight,        // ← nuevo
    mix: event.mix,
    templateCode: event.templateCode,    // ← nuevo
});
```

`handleLaunchIngredient` ya existía en ProductionScheduler.jsx (línea 203). El botón de "Iniciar Producción" (línea ~2802) ya verificaba `modalData.templateCode` para enrutarlo. Solo faltaba que `templateCode` llegara al modalData desde el evento.

El `getSchedule` del `genialitySchedulerController.js` ya devolvía `templateCode='TMPL-AZINV-001'` para los baches con SKU `PROCELIQUIPOPS26`/`PROCELIQUIPOPS43` (`INGREDIENT_TEMPLATE_MAP`).

**Caché de Vite**: importante limpiar `node_modules/.vite` antes del build cuando los cambios no se reflejen — el hash del bundle cambia solo si el contenido cambia, y Vite a veces deja el bundle viejo si su HMR cache tiene una versión previa.

**Razón:** caso real visto el 28-abr — usuario inicia GLUCOSA dos veces seguidas y ambas veces el sistema lanza "Pesaje de BASE SIROPE CLASICA" con AGUA + AZUCAR + GOMA GUAR + GOMA XHANTAN + SUCRALOSA + SORBATO + ANTIESPUMANTE TECNAS (ingredientes de sirope, no de azúcar invertida glucosa). El fix anterior (CAMBIO 77c) en `GenialityScheduler.jsx` no aplicaba porque ese archivo está huérfano.

## CAMBIO 77c: GenialityScheduler — usar plantilla de ingrediente para GLUCOSA/FRUCTOSA

**Frontend `pages/Geniality/GenialityScheduler.jsx`**:

En la vista Geniality, al iniciar producción de un bache de ingrediente (GLUCOSA, FRUCTOSA, SKU `PROCELIQUIPOPS26`/`PROCELIQUIPOPS43`), `handleLaunchBatch` siempre usaba la plantilla `BATCH-GENIALITY` (flujo completo de SIROPES: BASE SIROPE CLASICA → SABORIZACION → CONTEO → EMPAQUE), generando 9 etapas equivocadas. La plantilla correcta para GLUCOSA es `TMPL-AZINV-001` con 6 etapas (Pesaje, Adición, Cocción 105°C, Enfriamiento, Medición Brix/pH, Ensamble Siigo).

```js
// Agregado:
const handleLaunchIngredient = async (batchId, templateCode, baseWeight) => {
    const tmpl = (await api.get('/assembly-templates?all=true')).data
        .find(t => t.isActive && t.templateCode === templateCode);
    const lotCount = baseWeight ? Math.max(1, Math.round(baseWeight / 100)) : 1;
    const res = await api.post('/assembly-notes/quick-start', {
        templateId: tmpl.id, userId, quantity: lotCount, existingBatchId: batchId,
    });
    if (res.data?.firstNoteId) window.location.href = `/assembly-execution/${res.data.firstNoteId}`;
};

// handleLaunchBatch ahora redirige cuando hay templateCode:
const handleLaunchBatch = async (batchId, title, flavor, mix, baseWeight, templateCode) => {
    if (templateCode) return handleLaunchIngredient(batchId, templateCode, baseWeight);
    // ... (BATCH-GENIALITY normal)
};
```

Las 3 llamadas (calendar event button x2, modal "Iniciar Producción" button) ahora pasan `event.templateCode` / `modalData.templateCode` (ya viene del `getSchedule` del backend para baches con SKU de ingrediente).

`handleSelectEvent` también propaga `templateCode` y `baseWeight` al modalData.

**Razón:** caso real visto el 28-abr — usuario inicia producción de GLUCOSA, sistema lanza el flujo de "Pesaje de BASE SIROPE CLASICA" con AGUA + AZUCAR + GOMA GUAR + GOMA XHANTAN + SUCRALOSA + SORBATO + ANTIESPUMANTE (ingredientes de sirope, no de glucosa). En Liquipops esto ya funcionaba porque `ProductionScheduler.jsx` tenía `handleLaunchIngredient`; faltaba replicarlo en Geniality.

## CAMBIO 77b: Geniality `updateBatch` ignoraba el campo `mix` — fix

**Backend `genialitySchedulerController.js` `updateBatch`** (línea ~670):

El endpoint `PUT /geniality/production/:id` apunta a `genialitySchedulerController.updateBatch` (NO al de productionScheduler). Ese handler **solo guardaba `scheduledStart/End/status/notes`** y no procesaba `mix` ni `baseWeight`. Resultado: el alert del frontend decía "Mix actualizado correctamente" pero los cambios al mix se perdían silenciosamente.

```js
// Antes:
const { scheduledStart, scheduledEnd, status, notes } = req.body;
// ... no manejaba mix ni baseWeight

// Ahora: maneja mix (actualiza BatchOutputTarget), baseWeight, projectedTotalWeight
// (mismo patrón que productionSchedulerController.updateBatch).
```

**Backend `genialitySchedulerController.js` `getSchedule`** (línea ~755):

También se aplicó el fallback de `kgFactor = baseWeight/totalUnits` para ingredientes sin patrón de tamaño en el nombre (igual que en `productionSchedulerController`).

**Razón:** caso real visto el 28-abr en GLUCOSA en vista Geniality — usuario cambia a 6 unidades, marmita correcta 600kg, guarda con éxito visible, reabre y vuelve a 700kg porque el backend ignoró silenciosamente el mix. Inicialmente arreglé el controller de Liquipops sin notar que Geniality tiene su propio controller separado.

## CAMBIO 77: Editar mix de bache programado — sincronizar baseWeight

**Backend `productionSchedulerController.js` `updateBatch`** (línea ~890):

`updateBatch` solo actualizaba `batchOutputTarget.plannedUnits`/`plannedWeightKg` cuando se cambiaba el mix, pero **no actualizaba `productionBatch.baseWeight`**. Como el título del bache (`getSchedule` línea 1031: `${b.flavor} (${Math.round(b.baseWeight)}kg)`) y el "PESO TOTAL MARMITA" del modal (`totalSyrupKg = event.baseWeight`) se leen de `baseWeight`, al guardar y reabrir el modal mostraba el peso viejo aunque las unidades sí se hubieran guardado correctamente. UX: parecía que "no se guardó" cuando sí se guardó.

```js
// Antes (solo actualizaba scheduledStart/scheduledEnd/status/notes + outputTargets):
const updateData = {};
if (scheduledStart) updateData.scheduledStart = new Date(scheduledStart);
// ... (no baseWeight)

// Ahora:
if (baseWeight !== undefined && !Number.isNaN(Number(baseWeight))) {
    updateData.baseWeight = Number(baseWeight);
}
// + Si baseWeight no viene, recalcula desde sum(plannedWeightKg) de outputTargets
// + También actualiza projectedTotalWeight = sum(plannedWeightKg)
```

**Frontend `ProductionScheduler.jsx`** (botón Guardar Cambios, línea ~2785):
```js
const newBaseWeight = modalData.totalSyrupKg || modalData.totalPlannedKg || modalData.baseWeight;
await api.put(`${updBase}/${realId}`, {
    mix: ...,
    baseWeight: newBaseWeight  // ← nuevo
});
```

**Razón:** caso real visto el 28-abr en GLUCOSA — usuario cambia 700kg → 600kg, el alert dice "Mix actualizado correctamente", pero al reabrir el bache el título sigue mostrando "(700kg)". El mix sí se guardaba pero `baseWeight` quedaba desincronizado.

## CAMBIO 78: Cocción a 105°C en Azúcar Invertida y Fructosa — sin cronómetro de 10 min

**Plantillas afectadas:** `TMPL-AZINV-001` (Azúcar Invertida Glucosa), `TMPL-AZINV-001-v2`, `TMPL-FRUCT-001` (Fructosa).

**Cambio operativo:** apenas la mezcla alcanza 105°C, se inicia inmediatamente el enfriamiento. Antes había un cronómetro forzoso de 10 minutos a 105°C que el operario debía esperar antes de poder pasar al stage de enfriamiento.

**Cambios en BD:**
- `stageName`: "Cocción a 105°C — Mantener" → **"Cocción a 105°C"**
- `processParameters.timerMinutes`: 10 → **0**
- `processParameters.instruction`: actualizada para reflejar "apenas se alcance, pasar a enfriamiento"

**Migración batches activos:** las notas en estado PENDING/EXECUTING que aún tenían el timer viejo también fueron actualizadas (ej. `AZUCAR-INVERTER-GLUC-260428-2112-S3` y `AZUCAR-INVERTER-GLUC-260428-2251-S3`).

**Frontend** (`CoccionStep.jsx`): no requirió cambio — el componente ya respeta `timerMin === 0` (líneas 43, 49, 117, 512). Cuando el timer es 0, el botón "Completar Etapa" se habilita apenas haya foto + temperatura real registrada.

## CAMBIO 79: Azúcar Invertida (Glucosa/Fructosa) clasificada como Geniality en Panel Operador

**Archivo:** `frontend/src/pages/ProductionOperatorPage.jsx` función `isSirope` (línea ~929).

**Problema:** Los baches de AZUCAR INVERTER GLUCOSA (PROCELIQUIPOPS26) y AZUCAR INVERTIDA FRUCTOSA (PROCELIQUIPOPS43) aparecían bajo el tab "Perlas" (Liquipops) en el Panel de Producción del operario, pero físicamente se preparan en la línea Geniality. Eso confundía al operario.

**Fix:** se agregaron keywords a `isSirope`:
- batchNumber: `AZUCAR-INVERT`, `FRUCTOSA`
- product name: `AZUCAR INVERT`, `AZUCAR INVERTIDA`

Ahora estos baches aparecen bajo el tab **"Siropes"** del Panel de Producción.

**Razón operativa:** el SKU `PROCELIQUIPOPS43` (Fructosa) está en grupo `PRODUCTOS EN PROCESO LIQUIPOPS` por inconsistencia histórica de catálogo, pero ambos productos se ejecutan en marmita Geniality. La detección por keywords lo arregla sin tocar el grupo del producto.

## CAMBIO 80: Time-line disciplinador del turno (agente que jalonea al operario)

**Modelo nuevo:** `ShiftDisciplineRun` en `prisma/schema.prisma` (tabla `shift_discipline_runs`).
- Una fila por cada turno (MANANA / TARDE / NOCHE × fecha)
- `steps`: JSON con los 13 hitos del turno (BASES + ALGINATOS + PROTECCIONES)
- `finalScore` 0-100 + `finalGrade` (EXCELENTE/BUENO/ACEPTABLE/DEFICIENTE) al cierre

**Backend:** `controllers/shiftDisciplineController.js` + `routes/shiftDisciplineRoutes.js`
- Tabla maestra `SHIFT_TEMPLATE` con offsets fijos desde inicio de turno (06/14/22):
  - Base 1 (T+0), Base 2 (T+50), Base 3 (T+1:40), ALG #1 (T+2:10), PROT #1 (T+2:25),
    Base 4 (T+3:10), Base 5 (T+4:00), Base 6 (T+4:50), ALG #2 (T+5:20), PROT #2 (T+5:35),
    Base 7 (T+6:20), ALG #3 herencia (T+6:50), PROT #3 herencia (T+7:05)
- Endpoints:
  - `GET /shift-discipline/current` — devuelve/crea el run del turno actual + lo refresca cruzando con `productionBatch.startedAt`
  - `GET /shift-discipline/previous` — último run cerrado (para modal de calificación)
  - `POST /:id/refresh` — re-evaluar
  - `POST /:id/close` — cierra y calcula score final
- **Auto-detección**: cruza cada step con baches Liquipops iniciados ±60 min de la hora ideal. Asigna `doneBy = batch.executedById`, calcula `deltaMin` y `score`.
- **Score por step**: ≤5min=100, ≤10min=85, ≤20min=65, ≤30min=40, >30min=0
- **Score final**: promedio ponderado por `weight` de cada step (BASES=1.0, ALG=0.8/0.9, PROT=0.7/0.8)
- **Cron** a las 6/14/22 COT (`server.js`): cierra el run anterior + el cron existente crea el nuevo al pedir `/current`

**Frontend:** `components/ShiftDisciplineTimeline.jsx`
- Barra horizontal arriba del Panel de Producción (sticky con el header)
- Steps como pills con estado visual: ✅ done (color verde/amarillo/verde según tipo) · ⏰ now (azul pulsante) · 🟡 late · 🔴 very-late (rojo pulsante)
- Mensaje motivacional contextual
- **Alerta sonora** (Web Audio API): beep -2min (suave 700Hz), +5min (medio 500Hz), +15min (fuerte doble 350Hz)
- Modal al inicio de turno con calificación del anterior (sessionStorage para mostrarlo solo una vez)
- Re-sync cada 2 min con BD + tick local cada 30 s
- Sobrevive refresh: el run se persiste en BD, el frontend solo lo lee

**Razón filosófica del usuario:** "es más un agente que está puyando a los operarios para que se rijan al plan de fabricación, que veo muchos que no tienen capacidad de liderar y mucho menos de regirse al plan."

**Capacidad teórica con este cronograma:** 21 BASES/día (7 por turno) + 9 ALG + 9 PROT. La rueda gira cada 8 horas y cada turno hereda ALG #3 + PROT #3 del anterior + deja los suyos para el siguiente.

## CAMBIO 81: Cronograma cíclico + comida + ranking + push + bono

Extensiones al CAMBIO 80 (time-line disciplinador):

### Cronograma cíclico (`SHIFT_TEMPLATE_BY_CODE`)
- Tres templates distintos por turno (MAÑANA, TARDE, NOCHE) reflejando la rueda 24h donde el ALG cae **cada 3 BASES contadas globalmente** sin reiniciar al cambiar turno
- Mañana: 12 hitos (7 BASES + 2 ALG + 2 PROT + 1 COMIDA almuerzo 10:30)
- Tarde: 12 hitos (7 BASES + 2 ALG + 2 PROT + 1 COMIDA cena 17:40)
- Noche: 14 hitos (7 BASES + 3 ALG + 3 PROT + 1 COMIDA 02:25) — cierra el ciclo con ALG #3 + PROT #3
- Step COMIDA con `weight: 0` (no penaliza score), estilo gris dasheado en frontend, sin alarma sonora

### Ranking mensual de líderes
- `GET /shift-discipline/leader-ranking?month=YYYY-MM` — agrupa runs cerrados por leaderId, calcula `avgScore` + lista de runs
- Schema: agregado `alertedSteps` (Json?) a `ShiftDisciplineRun` para no enviar push duplicados

### Notificaciones push de retraso
- Cron cada 5 min (`*/5 * * * *`) ejecuta `checkRetrasos`
- Cuando un step lleva >15 min sin hacerse, envía push (Web Push API VAPID) con título "⚠️ Retraso en cronograma"
- `alertedSteps` evita duplicar la misma alerta para el mismo step

### Factor disciplina al bono grupal (CAMBIO 64 → 81)
- `kpiController.js getScheduleAdherence` ahora trae `disciplineRuns` de la BD y los expone como `disciplineScore` + `disciplineGrade` por turno en `shiftCompletion`
- `ProductionKpiPage.jsx` agrega:
  - Mini KPI "⏱ Disciplina" en cada tarjeta de líder (verde ≥90, azul ≥75, amber ≥60, rojo <60)
  - Condición de bono ahora exige también `avgDiscipline >= 75` (si hay datos del turno disciplinador)
- Resultado: el bono grupal del CAMBIO 64 ahora exige **rendimiento ≥90% + compañerismo ≥1 intermedio/turno + disciplina ≥75**

## CAMBIO 82: Scan de pedidos prioriza PRODUCTO_TERMINADO sobre NO_CONFORME

**Archivo:** `backend/src/controllers/orderWorkflowController.js` (búsqueda de lote en scan).

**Bug:** cuando un mismo lote tiene entradas en varias zonas (PRODUCTO_TERMINADO, NO_CONFORME, PRODUCCION), el `findFirst` traía cualquiera con `currentQuantity > 0`. Si por orden traía NO_CONFORME (que tiene 1 ud separada por defectos), la validación `zone !== 'PRODUCTO_TERMINADO'` bloqueaba el scan con "Sin stock en Producto Terminado", aunque el mismo lote sí tuviera stock disponible en PT.

**Caso reportado:** lote `FRESA-260422-1718` con 159 ud en PRODUCTO_TERMINADO + 1 ud en NO_CONFORME → scan bloqueado.

**Fix:** nuevo helper `findLotPreferringPT(where)` que busca primero en `zone: 'PRODUCTO_TERMINADO'` y solo si no hay nada cae a otras zonas. Aplicado a las 3 búsquedas existentes (exacto / strip prefix / endsWith).

## CAMBIO 83: Iniciales en rótulos Zebra — fallback robusto + faltaba MarcadoCajasStep

**Problema reportado:** después del CAMBIO 76, las iniciales del operario NO salían en los rótulos. Causas:

1. **MarcadoCajasStep.jsx no estaba modificado** — es el que más imprime (etiquetas de cajas, contramuestras, NC) y se omitió. Faltaba `useAuth` + `printedBy`.
2. **Si algún componente olvida pasar `printedBy`, no había fallback** — quedaba en blanco.

**Fix:**

### a) MarcadoCajasStep agregado al pool
- `import { useAuth }` + `import { ..., toInitials }`
- `userInitials = toInitials(user?.name)`
- `baseData.printedBy = userInitials` para todos los `buildLotLabelZPL`

### b) Fallback automático desde localStorage
- `AuthContext.jsx` persiste `userInitials` y `userName` en localStorage cada vez que setea el user (login normal, pin-login, /auth/me en arranque). Logout limpia.
- `zplLabelBuilder.js` agrega helper `getStoredUserInitials()` que lee de localStorage
- `renderLabel` y `renderCarritoLabel`: si `printedBy` viene vacío, usan `getStoredUserInitials()` como fallback
- Resultado: aunque algún componente futuro olvide pasar `printedBy`, el rótulo SIEMPRE incluirá las iniciales del último usuario logueado

**Total de puntos de impresión Zebra cubiertos (8):**
1. MaterialZonePage.jsx
2. Labeling.jsx
3. FinishedProductZonePage.jsx (4 invocaciones internas)
4. LotManagementModal.jsx
5. ThermalPrintModal.jsx
6. PrintLotStep.jsx
7. GConteoCarritosStep.jsx
8. **MarcadoCajasStep.jsx** ← agregado en este cambio

ConteoStep.jsx ya tenía su propio formato con nombre completo del operario (no requirió fallback).

## CAMBIO 84: Cronómetro de Esferificación auto-arranca con `note.startedAt`

**Problema reportado:** algunos baches mostraban tiempos de esferificación irreales (ej. 183 min vs ~70 min esperados). Causa: el operario debía pulsar manualmente "INICIAR CRONÓMETRO" al llegar al paso `ESFERIFICACION`. Esto:
- Se podía olvidar (cronómetro no arrancaba o arrancaba tarde).
- Se podía manipular para alterar las estadísticas.
- No reflejaba el momento real, que es cuando se cierra `PROTECCION_GATE` (stage 7) → `FORMACION` (stage 8).

**Fix — `frontend/src/components/AssemblyRunner/steps/EsferificacionStep.jsx`:**

1. **Eliminado** el botón "INICIAR ESFERIFICACIÓN" del estado IDLE.
2. **Auto-inicialización al montar** el step: si no existe `processParameters.esferificacion_timer` persistido pero sí `noteData.startedAt` (heredado del cierre del paso PROTECCIÓN), se inicializa el cronómetro automáticamente con ese timestamp:
   - `startTime = noteData.startedAt`
   - `elapsedMs = Date.now() - startedAt` (recupera tiempo transcurrido si el operario llegó tarde a abrir el step)
   - `status = RUNNING`
   - Se persiste en backend con un evento `INICIO` que indica `"Esferificación iniciada automáticamente al finalizar Protección"`
3. **Pausas y FINALIZAR** funcionan igual que antes — el operario sigue pudiendo pausar por incidencias y describir el motivo.
4. **Eliminado** `handleStart` (ya no se usa).
5. Mensaje IDLE ahora explica que el cronómetro auto-inicia al pasar al paso (estado solo aparece si la nota aún no tiene `startedAt`, caso borde).

**Resultado esperado:** tiempo medido = tiempo real desde el cierre de Protección hasta que el operario pulsa FINALIZAR, descontando pausas justificadas. El operario ya no controla el inicio.

## CAMBIO 85: Una sola esferificación a la vez por planta (bloqueo de concurrencia)

**Regla operativa:** la planta solo puede tener UNA nota FORMACION (esferificación de Liquipops) corriendo o en pausa simultáneamente. Si el operario intenta abrir un nuevo bache mientras hay otro activo, el sistema bloquea el inicio del cronómetro y muestra cuál bache hay que finalizar primero.

**Aclaraciones explícitas (del usuario):**
- El FIN del cronómetro es **siempre manual** — el operario pulsa FINALIZAR. No hay encadenamiento automático.
- El INICIO sigue siendo automático (CAMBIO 84) desde `note.startedAt`, pero queda bloqueado si hay otra activa.
- El operario debe poder finalizar antes de tiempo si: termina la jornada, surge una eventualidad, o cambio de sabor.

**Backend:**
- Nuevo endpoint `GET /api/assembly-notes/active-esferificacion` (`assemblyNoteController.getActiveEsferificacion`).
  - Busca notas FORMACION en `EXECUTING` cuyo `processParameters.esferificacion_timer.status` sea `RUNNING` o `PAUSED`.
  - Devuelve `{ active, noteId, batchNumber, flavor, operatorName, startedAt, elapsedMinutes, timerStatus }`.
  - Registrado en `routes/assemblyNoteRoutes.js` ANTES de `/:id` para que matchee el path literal.

**Frontend — `EsferificacionStep.jsx`:**
- Antes de auto-arrancar (Case B del CAMBIO 84) se consulta el endpoint.
- Si otro bache está activo (`noteId !== current`), se setea `blockedBy` y el cronómetro queda IDLE.
- Banner rojo con `AlertTriangle`: muestra batchNumber + operario + minutos transcurridos + botón "Ir al bache en curso →".
- Mientras `blockedBy` está activo, polling cada 10s al endpoint; cuando el otro bache se finaliza, se libera el slot y el cronómetro auto-arranca.

**Frontend — `ProductionOperatorPage.jsx`:**
- Pill verde en el header del panel: "🟢 Esferificación activa: <bache> · Op. <nombre> · <min> min" con click que navega al step.
- Polling cada 30s, visible para todos los operarios del panel.

**Casos cubiertos:**
- Operario olvida FINALIZAR el bache anterior → al abrir el siguiente ve el banner rojo con atajo.
- Cambio de turno: operario entrante llega y ve qué bache del turno saliente sigue abierto.
- Cierre por eventualidad / fin de jornada → operario FINALIZA manualmente; el siguiente operario podrá iniciar otro.

## CAMBIO 86: Historial de turnos disciplinador (página dedicada)

**Necesidad:** hasta ahora solo se podía ver el turno actual y el inmediatamente anterior (modal de calificación). No había forma de auditar resultados pasados ni comparar líderes/turnos en un rango.

**Backend — `shiftDisciplineController.js` + `shiftDisciplineRoutes.js`:**
- `GET /api/shift-discipline/history?from&to&leaderId&shiftCode&page&pageSize`
  - Lista paginada de runs cerrados, con resumen por fila: `stepsTotal`, `stepsDone`, `stepsLate` (Δ>5min), `stepsMissed` (no hechos), `alertsCount`, `finalScore`, `finalGrade`, `leaderName`.
- `GET /api/shift-discipline/runs/:id`
  - Devuelve el run completo con `steps[]` para reproducir la timeline tal como ocurrió.

**Frontend — `pages/ShiftDisciplineHistoryPage.jsx` (nuevo):**
- Ruta: `/shift-discipline/history`
- Filtros: rango de fecha (default últimos 30 días), turno (Mañana/Tarde/Noche/Todos), líder (selector poblado desde leaderRanking).
- KPIs en el tope: turnos cerrados, score promedio, % adherencia al horario, pasos hechos/total con # tarde, mejor/peor score del rango.
- Tabla con columnas: fecha, turno, líder, score, grade, pasos, tarde, sin hacer, alertas push, fecha cierre. Click en fila abre drawer.
- Drawer detalle: score grande, info card (líder, fecha, inicio/fin), timeline completa con pills (verde=hecho, rojo=no hecho, gris=COMIDA) — mismo formato visual que `ShiftDisciplineTimeline.jsx` pero estático.
- Acceso restringido a roles `ADMIN`, `LIDER`, `PRODUCCION`. Otros roles ven mensaje de denegación.

**Frontend — `components/ShiftDisciplineTimeline.jsx`:**
- Botón "📊 Historial" en el header de la barra del turno actual → navega directo a `/shift-discipline/history`. Visible para todos pero la página gating lo bloquea para roles no autorizados.

**Archivos modificados/creados:**
- `backend/src/controllers/shiftDisciplineController.js` — `+history`, `+getRunDetail`
- `backend/src/routes/shiftDisciplineRoutes.js` — registra los 2 endpoints
- `frontend/src/pages/ShiftDisciplineHistoryPage.jsx` — NUEVO
- `frontend/src/App.jsx` — import + ruta
- `frontend/src/components/ShiftDisciplineTimeline.jsx` — link al historial

## CAMBIO 87: FEFO obligatorio al transferir lotes de Bodega Principal a Producción

**Archivo:** `frontend/src/components/inventory/LotManagementModal.jsx`

**Problema:** Cuando un operario transfería materia prima de WAREHOUSE → PRODUCTION (botón ArrowRightLeft del modal de gestión de lotes), podía escoger CUALQUIER lote, ignorando FEFO. Esto generaba que lotes con fecha de vencimiento más cercana se quedaran rezagados en bodega y vencieran antes de pasar a producción.

**Fix:** Convertir FEFO en restricción dura para la transferencia WAREHOUSE → PRODUCTION. El operario sigue viendo todos los lotes en bodega, pero solo el más próximo a vencer (o varios si vencen el mismo día) puede ser transferido a Producción. Los demás muestran badge "ESPERAR FEFO" y el botón "Transferir" se deshabilita con mensaje explicando cuál lote debe pasarse primero.

**Cambios clave:**

1. Estado `fefoOverride` y `isAdmin = user?.role === 'ADMIN'` (user ya estaba disponible vía `useAuth()` línea 237).
2. Nuevo `useMemo` `warehouseFefoEligibleIds`:
   - Filtra MaterialLot en zona WAREHOUSE con `currentQuantity > 0` y `expiresAt` registrado.
   - Encuentra la fecha de vencimiento más temprana (normalizada a día calendario).
   - Devuelve `Set` con IDs de los lotes que vencen ese día (empates incluidos).
3. Helper `isFefoBlocked(lot, targetZone)`:
   - Solo bloquea si `_type === 'MaterialLot'`, `lot.zone === 'WAREHOUSE'`, `targetZone === 'PRODUCTION'`.
   - Si no tiene `expiresAt` → siempre bloqueado.
   - Si admin activó override → bypass.
4. `handleTransfer()` valida `isFefoBlocked` con alert que indica el lote correcto.
5. UI:
   - Badge en cards de lotes WAREHOUSE: "✅ PRÓXIMO A VENCER — PASAR A PRODUCCIÓN" (verde) / "🔒 ESPERAR FEFO" (gris) / "⚠️ SIN FECHA VTO." (rojo).
   - Fila de fecha de recibido ahora también muestra "Vence: DD-MM-YYYY".
   - En el panel de transferencia: botón "Transferir" deshabilitado si `isFefoBlocked(lot, transferZone)`. Mensaje contextual amber con `<Lock>` indicando qué lote pasar primero, o rojo con `<ShieldAlert>` si falta fecha.
   - Toggle admin "🔒 Override FEFO" / "🔓 Override FEFO ACTIVO" en encabezado del panel de transferencia (solo si `isAdmin`).

**Reglas confirmadas con el usuario (John, 2026-04-29):**
- Override admin: SI (toggle visible solo para rol ADMIN).
- Lotes sin `expiresAt`: BLOQUEADOS sin excepción. Recepción de materia prima debe registrar fecha siempre.
- Auto-asignación EMPAQUE: se mantiene como está.
- Botón "lote manual" en InputStep: se mantiene como hoy.
- La restricción aplica SOLO a transferencias WAREHOUSE → PRODUCTION. Otros destinos (CUARENTENA, NO_CONFORME, MAQUILA) no se bloquean.

**NO se modificó InputStep.jsx ni GInputStep.jsx** — esos pasos son consumo dentro de zona de producción, donde el material ya fue liberado. El control FEFO ocurre en el momento del traspaso a producción.

**Refuerzo (2026-04-29 tercera iteración — página `/production/zone`):** El usuario reportó que aún podía seleccionar cualquier lote en la página "Zona de Producción". Esa página NO usa LotManagementModal, usa endpoints distintos (`/api/zone-transfers/available-lots/:productId` y `/api/zone-transfers/transfer-in`).

**Archivos:**
- `frontend/src/pages/ProductionZonePage.jsx` — `<Select>` de lotes con opciones deshabilitadas para no-FEFO. Banner verde mostrando el lote a transferir. Toggle admin "🔒 Override FEFO".
- `backend/src/controllers/zoneTransferController.js`:
  - `getAvailableLots` ordena por `expiresAt asc` y devuelve `fefoEligible` + `fefoBlockedReason` por lote.
  - `transferIn` valida server-side: bloquea si el lote no es el de fecha más temprana o no tiene `expiresAt`. Acepta `fefoOverride: true` solo para `req.user.role === 'ADMIN'`.

Backend reiniciado.

**Refuerzo (2026-04-29 segunda iteración):** Se agregaron 3 capas adicionales para garantizar el bloqueo:

1. **Frontend — `getTransferZoneOptions(lot)`**: oculta la opción "Producción" del `<select>` de zona destino para lotes WAREHOUSE no-FEFO. Operario no puede ni siquiera elegirla.
2. **Frontend — orden de la lista**: lotes FEFO elegibles aparecen arriba; los demás se ordenan por `expiresAt asc`; sin fecha al final.
3. **Backend — `lotController.transferZone` (línea 1653)**: guard server-side. Si origen=WAREHOUSE, destino=PRODUCTION, valida:
   - Que el lote tenga `expiresAt`.
   - Que sea el de fecha más temprana (empate por día calendario admitido).
   - Acepta `fefoOverride: true` solo si `req.user.role === 'ADMIN'`.
   - Devuelve mensaje específico citando el lote correcto si rechaza.

Backend reiniciado en pm2 (`popping-backend`).

## CAMBIO 88: Flag `isCleaningOnly` — restringir usuarias al módulo de aseo

**Problema:** LEDDY LARREA tiene rol `OPERARIO_PICKING` para que el sistema de aseo la trate como personal, pero ese rol le da acceso a Inventario, Producción, Modo Operador, etc. — módulos donde no está autorizada para hacer cambios.

**Solución:** Nuevo flag `isCleaningOnly` en el modelo `User`. Cuando está en `true`:
- El sidebar oculta TODOS los items excepto los de la sección "Aseo".
- ProtectedRoute redirige cualquier ruta que no empiece con `/aseo` hacia `/aseo`.
- El grupo "Aseo" del sidebar arranca expandido automáticamente (no necesita clickear).

**Archivos:**
- `backend/prisma/schema.prisma` — campo `isCleaningOnly Boolean @default(false)` en User.
- `backend/prisma/migrations/20260429190000_add_user_is_cleaning_only/migration.sql` — `ALTER TABLE users ADD COLUMN`.
- `backend/src/controllers/userController.js` — `getUsers` y `updateUser` aceptan/devuelven el flag.
- `frontend/src/components/common/ProtectedRoute.jsx` — `if (user.isCleaningOnly && !location.pathname.startsWith('/aseo')) return <Navigate to="/aseo" />`.
- `frontend/src/components/common/Sidebar.jsx` — filtra items: `canSeeItem = matchesFlag && currentSection === 'Aseo'`. `expandedGroups` arranca con `{ Aseo: true }` si `isCleaningOnly`.
- `frontend/src/pages/admin/Users.jsx` — modal de aseo agrega checkbox "🔒 Solo módulo de aseo".

**Activado para:** LEDDY LARREA HERNANDEZ (id `9f492632-3ce9-489f-bda0-3d2a48245ec5`). Otras usuarias se activan desde `/admin/users` → ícono 🧽 → checkbox.

**NO afecta:** ADMINs ni usuarias que solo tengan `isCleaningStaff: true` sin `isCleaningOnly` (estas siguen viendo todo lo de su rol + el módulo aseo).

Build frontend ejecutado, backend reiniciado.

## CAMBIO 89: Área PERSONAL_OFICINA + corrección OFFICE_SHIFT_CODES

(Originalmente nombrada `ADMINISTRACION`; se renombró a `PERSONAL_OFICINA` con label "Personal Oficina" para no confundirla con el rol ADMIN del sistema.)

**Archivos:**
- `frontend/src/pages/ShiftSchedulePage.jsx` — agregada `'PERSONAL_OFICINA'` a `AREAS`, `MIGRATION_AREAS`, `FIXED_AREAS`. Label "Administración", icono 💼.
- `backend/src/controllers/attendanceController.js`:
  - `OFFICE_SHIFT_CODES = ['OFICINA', 'DIURNO']` — antes era solo `['OFICINA']`, lo que provocaba que NUNCA se descontaran descansos en horas netas (mismatch con la BD que usa `'DIURNO'`).
  - Nueva constante `KIOSK_ELIGIBLE_ROLES = [...KIOSK_REQUIRED_ROLES, 'ADMIN']` — usada solo por `getEmployees` para listar usuarios pendientes de migrar a `shift_employees`. Permite que el equipo ADMIN aparezca en el cuadro de turnos sin obligarles a marcar ingreso para acceder al sistema (login externo de admin sigue intacto).

**Por qué:** El equipo de administración tiene horario 8:00–17:00 (igual que el turno DIURNO existente) y debe registrar entrada/desayuno/almuerzo/salida. El kiosko ya soporta los 4 tipos de marcas (ENTRY, EXIT BREAK, EXIT LUNCH, EXIT FINAL); solo faltaba el área en el cuadro y el reconocimiento del turno como "oficina" para descontar descansos correctamente.

**Cómo migrar admins al cuadro:** `/shift-schedule` → buscar al admin en lista pendiente → asignar área `PERSONAL_OFICINA` → automáticamente queda en turno DIURNO (área fija).

Frontend rebuild + backend reiniciado.

## CAMBIO 90: Ampliar roles elegibles + auto-aparición en cuadro de turnos + cleanup al eliminar + fix FaceEnroller

**Archivos:**
- `backend/src/services/shiftEmployeeSyncService.js` — `SHIFT_OPERATION_USER_ROLES` ahora incluye CARTERA, CONTABILIDAD, RECURSOS_HUMANOS, CALIDAD, QUIMICO, COMERCIAL, ADMIN. `SHIFT_OPERATION_AREAS` y `FIXED_SHIFT_AREAS` incluyen `PERSONAL_OFICINA`. `DEFAULT_AREA_BY_USER_ROLE` mapea esos roles a PERSONAL_OFICINA. `AREA_ALIASES` admite `OFICINA`/`ADMINISTRACION`/`OFFICE` como alias.
- `backend/src/controllers/userController.js` — `deleteUser` ahora limpia `shift_employees` antes de borrar el `user`: si tiene historial de asistencias se desvincula (`userId=null, active=false`), si no se borran asignaciones/ausencias y luego el shift_employee.
- `frontend/src/pages/AttendancePage.jsx` — `FaceEnroller` reescrito: verifica `window.isSecureContext` y `navigator.mediaDevices`, activa cámara antes de cargar modelos (feedback inmediato), maneja errores específicos (`NotAllowedError`/`NotFoundError`/`NotReadableError`) con mensajes claros, log a consola para debugging.

**Por qué:** 
1. VALERIA (CONTABILIDAD), YAZMIN (CARTERA) y otros usuarios de oficina no aparecían como pendientes en el cuadro de turnos porque solo PRODUCCION/OPERARIO_PICKING/LOGISTICA estaban en la lista elegible.
2. Los usuarios eliminados desde `/admin/users` fallaban si tenían `shift_employee` asociado (FK sin onDelete:Cascade).
3. La cámara del enrollment facial fallaba silenciosamente sin indicar la causa (HTTPS, permiso denegado, etc.).

Frontend rebuild + backend reiniciado.

## CHECKLIST ANTES DE ACEPTAR EL MERGE DEL OTRO EQUIPO

1. Guardar este documento (`CAMBIOS_PENDIENTES_2026-04-18.md`) en git o respaldo externo.
2. Resolver los 8 archivos `UU` uno por uno, revisando los cambios descritos en este documento.
3. Agregar al commit los archivos nuevos `??` que correspondan, especialmente documentos WhatsApp ERP y services/componentes nuevos.
4. No agregar imagenes sueltas de raiz sin confirmar si pertenecen a GestionPBI o a otra app.
5. Ejecutar `git diff --check` y corregir whitespace/conflict markers.
6. Verificar que no queden marcadores `<<<<<<<`, `=======`, `>>>>>>>`.
7. Probar como minimo: build frontend, arranque backend, flujo RPA, inventario, relevo de turno, reporte WhatsApp/documentos.

---

## 🎓 NUEVO MÓDULO — ACADEMIA POPPING BOBA (Escuela de Líderes)
**Fecha:** 2026-04-29

### Objetivo
Sistema interno de capacitación, evaluación y certificación de líderes de planta. Meta de productividad: **7 baches/turno sostenidos**. Atado a bonificación y posible alza de salario por nivel alcanzado.

### Arquitectura
- **Módulo independiente** del resto del ERP (prefijos `academia_*` en BD, ruta `/academia` en backend y frontend)
- Lee KPIs reales de los módulos existentes (production_batches, shift_handover, shift_discipline) para alimentar el cálculo de puntaje
- 4 pilares × 23 módulos × {lecciones + quiz + evaluación práctica + KPIs reales + comportamiento 360}
- 4 niveles de certificación: 🥉 Bronce (700-799) · 🥈 Plata (800-879) · 🥇 Oro (880-939) · 🏆 Maestro (940-1000)

### Archivos creados/modificados

**Backend — Schema Prisma:**
- `backend/prisma/schema.prisma`:
  - 7 enums nuevos: `AcademiaPilarType`, `AcademiaLessonType`, `AcademiaQuestionType`, `AcademiaCertificationLevel`, `AcademiaEnrollmentStatus`, `AcademiaPracticalEvalStatus`, `AcademiaBonusStatus`
  - 12 modelos nuevos: `AcademiaCourse`, `AcademiaModule`, `AcademiaLesson`, `AcademiaQuiz`, `AcademiaQuestion`, `AcademiaQuizAttempt`, `AcademiaEnrollment`, `AcademiaProgress`, `AcademiaLessonProgress`, `AcademiaRubric`, `AcademiaPracticalEval`, `AcademiaCertification`, `AcademiaBonus`
  - 8 relaciones inversas agregadas a `User`

**Backend — Migración SQL:**
- Aplicada manualmente con `psql` (NO con `prisma migrate dev`) para evitar reset.
- Solo `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`, `ALTER TABLE ADD CONSTRAINT` — cero `DROP` o `DELETE`.
- 13 tablas nuevas creadas. Total tablas BD: 99 → 112.
- Backup manual previo: `gestionpbi_20260429_224808.sql.gz`.

**Backend — Seed inicial:**
- `backend/src/scripts/seed_academia.js` — idempotente, crea 4 cursos (pilares) y 23 módulos. Re-ejecutable sin duplicar.

**Backend — Controllers (5 nuevos):**
- `backend/src/controllers/academiaCourseController.js` — CRUD cursos y módulos
- `backend/src/controllers/academiaLessonController.js` — Lecciones + tracking de avance + recompute progress
- `backend/src/controllers/academiaQuizController.js` — Quiz, preguntas, intentos, calificación automática
- `backend/src/controllers/academiaEnrollmentController.js` — Inscripciones y perfil del aprendiz
- `backend/src/controllers/academiaPracticalEvalController.js` — Rúbricas y evaluaciones prácticas en planta
- `backend/src/controllers/academiaCertificationController.js` — Score, certificaciones, ranking, bonos

**Backend — Servicio de scoring:**
- `backend/src/services/academiaScoringService.js`:
  - `computeTotalScore(userId)` — calcula 1000 puntos repartidos en:
    - Quiz teóricos (230 / 23%)
    - Eval prácticas (350 / 35%)
    - KPIs reales del turno (200 / 20%) — lee `production_batches`, meta 7 baches/turno
    - Proyecto final (150 / 15%)
    - Comportamiento 360° (70 / 7%) — lee `shift_discipline_record` si existe
  - Robusto a falta de datos: degrada a 0 sin romper

**Backend — Rutas:**
- `backend/src/routes/academiaRoutes.js` — Express router con todas las rutas REST
- `backend/src/routes/index.js` — Registra `/api/academia/*`

**Frontend — Páginas estudiante:**
- `frontend/src/pages/Academia/AcademiaCatalogo.jsx` — Catálogo de pilares, stats personales, inscripción
- `frontend/src/pages/Academia/AcademiaCurso.jsx` — Lista de módulos del curso con avance
- `frontend/src/pages/Academia/AcademiaLeccion.jsx` — Visor de lección (video + texto + adjuntos)
- `frontend/src/pages/Academia/AcademiaQuiz.jsx` — Cuestionario interactivo con calificación
- `frontend/src/pages/Academia/AcademiaPerfil.jsx` — Mi puntaje, niveles, certificaciones
- `frontend/src/pages/Academia/AcademiaRanking.jsx` — Ranking entre líderes

**Frontend — Páginas admin:**
- `frontend/src/pages/Academia/Admin/AcademiaSeguimiento.jsx` — Tabla de líderes con avance, KPIs, botón de certificar
- `frontend/src/pages/Academia/Admin/AcademiaPanelEvaluacion.jsx` — Listado y creación de evaluaciones prácticas
- `frontend/src/pages/Academia/Admin/AcademiaEvaluar.jsx` — Calificar rúbrica desde móvil/web en planta
- `frontend/src/pages/Academia/Admin/AcademiaContenido.jsx` — Editor unificado: lecciones + quiz + rúbricas por módulo

**Frontend — Navegación:**
- `frontend/src/App.jsx` — 10 rutas nuevas bajo `/academia/*`
- `frontend/src/components/common/Sidebar.jsx` — Sección nueva "Talento" con ítem "Academia" + atajos admin (Seguimiento, Evaluaciones, Editor, Ranking)

### Estado al cierre
- Backend `popping-backend` reiniciado y respondiendo en puerto 3051
- Frontend compila sin errores (`npm run build` ✅)
- 4 pilares + 23 módulos visibles en `/api/academia/courses`
- Endpoints probados: `/courses`, `/modules`, `/me/profile`, `/me/score`
- Score se calcula correctamente con datos reales de `production_batches` y degrada elegantemente con cero datos

### Pendiente para futuras iteraciones
- Cargar contenido pedagógico real (lecciones, videos, preguntas, rúbricas) — el editor `/academia/admin/contenido` está listo para esto
- Producción de videos (HeyGen + Artlist + tomas en planta)
- Definir estructura de bonos en COP (formula final atada a baches/turno y nivel alcanzado)
- Integrar el bonus generado por Academia con `AdminLeaderBonusPage` existente

## CAMBIOS 2026-04-30 / 2026-05-03 — Wizard rediseñado + cronograma fin de semana

### Backend
- **`backend/src/controllers/assemblyNoteController.js`**:
  - `getNoteById` enriquecida: `displayOrder` ahora con 3 fallbacks (stageId → templateId+stageOrder → formula.additionOrder).
  - `quickStart`: `noteQty = (stageFormula.baseQuantity || 1) * baseQty` (soporte 0.5 baches).
  - Hard-cap 120% removido (bloqueaba flujos legítimos por escalado).
  - `auditLog.create` corregido: `details` no existe, se usa `changes: { note: ... }`.
- **`backend/src/controllers/genialityAssemblyNoteController.js`**:
  - Asigna `item.displayOrder` también en formula sort para que frontend respete orden de fórmula.
- **`backend/src/controllers/assemblyTemplateController.js`**:
  - 4 sitios `auditLog.create({ details })` cambiados a `changes: { note }`.
- **`backend/src/services/assemblyService.js`** y **`genialityAssemblyService.js`**:
  - `consumingStage` ahora incluye `G_PESAJE` (validación stock zona PRODUCCION para Geniality, antes solo Liquipops).
- **`backend/src/controllers/shiftDisciplineController.js`** (refactor mayor):
  - `isNonWorkWindow(date, code)` — Sáb-noche, Dom-MAÑANA/TARDE → no-work.
  - **Domingo NOCHE = arranque de semana** con `TEMPLATE_NOCHE_ARRANQUE`: 3h ALISTAMIENTO (type nuevo `ALISTAMIENTO`, weight 0) + 3 ALGINATOS seguidos a 01:00/01:30/02:00 lun + Base #1 a 02:30 lun.
  - `isArranqueSemana()` helper.
  - `buildIdealSchedule(code, start, shiftDate)` ahora dispatch por shiftDate.
  - `getShiftDateStr` corregido: usa componentes locales (no `toISOString().slice(0,10)`) — evitaba que Sun-NOCHE 22:00 COT se reportara como Mon-NOCHE.
  - `_loadNonWorkDays` con caché 60s; lista persistida en `systemSettings.NON_WORK_DAYS`.
  - 3 endpoints CRUD: `GET/POST/DELETE /api/shift-discipline/non-work-days`.
  - `history`, `leaderRanking`, `monthlyBonus` filtran `isNonWorkWindow` para no inflar promedios.
  - `getRunDetail` incluye `esferificacion` summary.
- **`backend/src/routes/shiftDisciplineRoutes.js`** — 3 rutas nuevas para non-work-days.

### Frontend — Wizard rediseñado (PROTECCION/PREMEZCLA/SIROPE)
- **`frontend/src/components/AssemblyRunner/hooks/useAssemblyNote.js`**:
  - `isProteccionFlow` extendido: PROTECCION + BASE LIQUIPOPS + COMPUESTO + BASE SIROPE + SABORIZACION → genera `PESAJE_BATCH → ADICION_BATCH → OUTPUT`.
  - `isPremezclaFlow`: PREMEZCLA + PROTONICO + ALGINATO PREPARADO → genera `PESAJE_BATCH → OUTPUT` (sin adicion).
  - INTRO se omite para esos flujos (header propio en PESAJE_BATCH).
  - ENSAMBLE invisible para todos esos productos (auto-completa via API en `handleComplete` y on-mount).
  - Auto-fill items intermedios: si `componentId` corresponde al producto de un stage previo COMPLETED del mismo bache, se rellena `actualQuantity` y `lotNumber=batchNumber`. Persistido en backend via PATCH.
  - INPUT step se SALTA para items intermedios (no foto, no captura).
  - Restauración de `wizardStep` para notas COMPLETED (F5/multi-tablet preserva pantalla).
  - SABORIZACION: skip OUTPUT (cierre con `actualQuantity = targetQuantity`), va directo a MEDICION nueva.
- **`frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx`** y **`GenialityRunner/GenialityExecutionWizard.jsx`**:
  - Auto-complete invisible ENSAMBLE/G_ENSAMBLE en handleComplete + useEffect on-mount.
  - Auto-save debounce 2s para PESAJE_BATCH e INPUT (Geniality wizard ahora también lo tiene).
  - canAdvance PESAJE_BATCH exime AGUA + intermedios de foto.
  - canAdvance ADICION_BATCH bloquea hasta `allConfirmed` (Geniality wizard también).
  - Guard `!currentStep` muestra spinner "Cerrando ensamble en Siigo..." cuando wizardSteps=0.
- **`frontend/src/components/AssemblyRunner/steps/PesajeBatchStep.jsx`**:
  - Header morado "PESAR INGREDIENTES" + nombre producto + contador.
  - Grid 2-columnas (siempre, no solo desktop).
  - Sort por `displayOrder` cuando todos lo tienen (de fórmula).
  - Items intermedios (BASE/ALGINATO PREPARADO/COMPUESTO/PROTECCION/PREMEZCLA/PROTONICO/SABORIZACION) — sin botón FOTO, no requieren foto.
  - `fmtQtyShort(unit)` respeta unidad real (no asume gramos).
- **`frontend/src/components/AssemblyRunner/steps/AdicionBatchStep.jsx`**:
  - Sort por `displayOrder` (orden de fórmula).
  - Items intermedios se auto-marcan como adicionados (ya están en olla del stage anterior).
  - Label muestra `item.component?.name` (nombre completo, no abreviatura).
  - Color naranja para keywords no reconocidas.
- **`frontend/src/components/AssemblyRunner/steps/OutputStep.jsx`**:
  - Header compactado, removida sección "Materiales utilizados".
  - QC params en grilla 2 columnas.
  - Foto del producto movida DENTRO del bloque QC (era duplicada al final).
  - QC_PARAMS_SABORIZACION nuevo (Brix 60-65, pH 2.8-3.5).
- **`frontend/src/components/AssemblyRunner/steps/PrintLotStep.jsx`**:
  - Default copies = `targetQuantity` (en vez de 1).
- **`frontend/src/context/ZebraContext.jsx`**:
  - Removido fallback VPS-Queue (solo IP directa o relay PC).
- **`frontend/src/components/AssemblyRunner/steps/MedicionStep.jsx`**:
  - Lee `requireFlavorCheck` y `requireProductPhoto` del config.
  - Bloque verificación de sabor (checkbox) + foto del producto final.
  - Persiste en `medicion_draft.flavorOk` y `productPhoto`.
  - Grid 2 columnas para measurements.

### Frontend — Otros
- **`frontend/src/components/AssemblyRunner/steps/FormacionQCStep.jsx`**:
  - Sección "💧 Cambio de agua del sistema de lavado" con SI/NO obligatorio (estado `waterSystemChanged`).
  - Removida sección "LAVADO + CITROSAN" (proceso ya no existe).
  - Modal foto ampliada al click sobre miniaturas.
- **`frontend/src/pages/ProductionOperatorPage.jsx`**:
  - Botón "⚠️ Reportar evento" en header (abre modal AuxEvent que ya existía pero NO tenía trigger).
- **`frontend/src/components/ShiftDisciplineTimeline.jsx`** y **`ShiftDisciplineHistoryPage.jsx`**:
  - Nuevo type `ALISTAMIENTO` (icon 🔧, color indigo).
  - Card "Días especiales" en historial con CRUD de festivos/no-laborados.
  - Tira de esferificación visible también en historial (export `EsferificacionStrip`).
- **`frontend/src/components/AssemblyRunner/StepDisplay.jsx`** — caso `AGUA` agregado (luego no usado pero queda).

### BD — Plantillas modificadas
- 12 plantillas SABORIZACION (TMPL065, TMPL102-108, GTPL-SAB-CEREZA/SANDIA/CURAZAO/TAMARINDO):
  - Stage 2 nueva = MEDICION "Toma de Parámetros" (entre G_PESAJE y G_ENSAMBLE).
  - `processParameters`: measurements [brix 60-65 °Bx, pH 2.8-3.5] + `requireFlavorCheck:true` + `requireProductPhoto:true`.
- TMPL-PRECONS-001 (PREMEZCLA CONSERVANTES PERLAS) y demás PREMEZCLA: agregado stage IMPRESION_LOTE.

### BD — Datos
- `systemSettings.NON_WORK_DAYS` precargado con 2026-05-01 (Festivo Día del Trabajo) y 2026-05-02 (Sábado no laborado).
- Borrados runs huérfanos: 2026-05-03 Mañana/Tarde/Noche (domingo), 2026-05-04 TARDE (creado con shiftDate equivocada), TARDE 30/04 leaderId corregido (Johnatan SIROPES → Gabriel PROD).

### Estado
- Backend `popping-backend` reiniciado.
- Frontend compila sin errores.
- Memoria nueva: `project_shift_discipline_weekend_rules.md`.

---

## INVENTARIO COMPLETO DE PRODUCCIÓN — 2026-05-03 (snapshot pre-merge)

Este bloque enumera **todo lo que NO está commiteado pero ESTÁ corriendo en producción** desde el último commit (`47776da` del 27/04/2026). Para que el merge no borre nada por accidente, cada archivo nuevo o modificado debe inspeccionarse antes de aceptar la versión del equipo externo.

### Backend — CONTROLADORES NUEVOS (no estaban antes)
- `backend/src/controllers/academiaCertificationController.js` — Certificaciones de líderes en Academia
- `backend/src/controllers/academiaCourseController.js` — CRUD de cursos
- `backend/src/controllers/academiaEnrollmentController.js` — Inscripciones de líderes
- `backend/src/controllers/academiaLessonController.js` — Lecciones (video + texto + adjuntos)
- `backend/src/controllers/academiaPracticalEvalController.js` — Evaluaciones prácticas con rúbrica
- `backend/src/controllers/academiaQuizController.js` — Cuestionarios interactivos
- `backend/src/controllers/cleaningController.js` — Módulo de limpieza/sanitización
- `backend/src/controllers/inventoryAuditController.js` — Auditoría de inventario físico
- `backend/src/controllers/mrpForecastController.js` — Forecast MRP (alertas de stock + modal en Procurement)
- `backend/src/controllers/networkIpsController.js` — Gestión de IPs permitidas (reloj de marcaje)
- `backend/src/controllers/shiftDisciplineController.js` — **Cronograma disciplinador completo** (TEMPLATE_MANANA/TARDE/NOCHE/NOCHE_ARRANQUE, matcher Hungarian-style ±90min, esferificación summary, monthlyBonus, NON_WORK_DAYS, isNonWorkWindow, getRunDetail con esferificacion)

### Backend — RUTAS NUEVAS
- `backend/src/routes/academiaRoutes.js`
- `backend/src/routes/cleaningRoutes.js`
- `backend/src/routes/inventoryAuditRoutes.js`
- `backend/src/routes/shiftDisciplineRoutes.js` — `/current`, `/previous`, `/leader-ranking`, `/history`, `/bonus`, `/runs/:id`, `/runs/:id/recompute`, `/:id/refresh`, `/:id/close`, **`/non-work-days` (GET/POST/DELETE)**

### Backend — SERVICIOS NUEVOS
- `backend/src/services/academiaScoringService.js` — Score de Academia desde `production_batches`
- `backend/src/services/allowedIpsService.js` — Validación de IPs para marcaje
- `backend/src/services/cleaningService.js` — Lógica de zonas/tareas/ejecuciones de limpieza
- `backend/src/services/laborSummaryService.js` — Reporte mensual de horas trabajadas / extras

### Backend — SCRIPTS / SEEDS
- `backend/prisma/seed-cleaning.js` — Zonas + tareas iniciales del módulo limpieza
- `backend/src/scripts/seed_academia.js` — 4 pilares + 23 módulos iniciales

### Backend — MIGRACIONES (todas aplicadas en BD producción)
- `20260320113000_add_internal_lab_traceability_fields`
- `20260330_fase5_batch_output_target_real_units`
- `20260330_normalization_fase1_2_6`
- `20260330_normalization_fase3_7`
- `20260330_normalization_fase4_8`
- `20260414000000_add_attendance_module`
- `20260415000000_add_shift_handover_module`
- `20260423130000_shift_handover_incoming_signatures`
- `20260427090000_add_material_lot_attachments`

### Backend — CONTROLADORES MODIFICADOS (cambios sin commitear, ordenados por tamaño)

| Archivo | Δ líneas | Resumen alto-nivel |
|---|---|---|
| `attendanceController.js` | +869 | Marcaje de asistencia, validación IP, cálculo horas extra, reportes mensuales |
| `productionSchedulerController.js` | +672 | createBatch dinámico, 0.5 lotes, deleteBatch revierte consumos, reschedule, validación duración cíclica |
| `assemblyNoteController.js` | +250 | displayOrder enrichment 3-fallback, quickStart 0.5 lotes, hard-cap 120% removido, auditLog details→changes, auto-cierre esferificación, exclusividad esferificación |
| `shiftHandoverController.js` | +237 | Firmas de líder entrante, autorización 15min de gracia, simulación de handoff, cleaning supervisor flag |
| `orderController.js` | +183 | Multi-presentación, scan QR PRODUCTO_TERMINADO prioritario, despacho zona terminado, etiquetas múltiples |
| `productionSchedulerController.js` (Geniality) | +55 | createBatch Geniality + AUX coexistencia, validación stock G_PESAJE |
| `formulaController.js` | +53 | Edición de additionOrder por ingrediente, propagación a baches PENDING |
| `lotController.js` | +36 | Adjuntos de lote (PDF/JPG), traspaso FEFO bodega→producción, productionZoneStock auto-reconcile |
| `genialityAssemblyNoteController.js` | +33 | displayOrder en formula sort, sub-template stage expansion, FORMACION uses formula |
| `kpiController.js` | +49 | KPIs de turno con baches/líder, adherencia cronograma, fallas |
| `rpaController.js` | +21 | Reintento RPA Siigo + log de fallos visibles |
| `assemblyTemplateController.js` | +8 | auditLog `details` → `changes` (4 sitios) |

### Backend — Fixes menores
- `auth.js`, `authController.js`, `userController.js` — PIN auth, cleaning supervisor flag, login audit
- `shiftController.js`, `attendanceRoutes.js`, `adminRoutes.js` — Endpoints de turno + admin
- `purchaseOrderController.js` — MRP integration, multi-supplier, custom items
- `orderControllerExtensions.js` (NUEVO) — handlers extendidos para escaneo + reposición
- `zoneTransferController.js` — Traspaso entre zonas con validación
- `services/assemblyService.js` y `genialityAssemblyService.js` — `consumingStage` incluye G_PESAJE, validación stock zona PRODUCCION
- `services/siigoService.js` — Sincronización inventario completa cada hora, reintento POST con backoff
- `server.js` — Servir downloads de fichas, CORS para múltiples orígenes

### Frontend — PÁGINAS NUEVAS
- `frontend/src/pages/Academia/` (carpeta completa) — 10 páginas: Catálogo, Curso, Lección, Quiz, Perfil, Ranking, AcademiaSeguimiento, AcademiaPanelEvaluacion, AcademiaEvaluar, AcademiaContenido
- `frontend/src/pages/AdminLeaderBonusPage.jsx` — Bonificación mensual líderes con desglose
- `frontend/src/pages/Cleaning/` (carpeta) — Cleaning operator + admin
- `frontend/src/pages/InventoryAuditPage.jsx` — Conteo físico + reconciliación
- `frontend/src/pages/LaborManagementPage.jsx` — Gestión de empleados + áreas + asignaciones semanales
- `frontend/src/pages/MarcajePage.jsx` — Pantalla de marcaje (huella/PIN + IP whitelist)
- `frontend/src/pages/ShiftDisciplineHistoryPage.jsx` — Histórico cronograma con KPIs + filtros + card "Días especiales"

### Frontend — COMPONENTES NUEVOS
- `frontend/src/components/ShiftDisciplineTimeline.jsx` — Timeline en panel operario + EsferificacionStrip exportada
- `frontend/src/components/AssemblyRunner/steps/AdicionBatchStep.jsx` — Lista ordenada de adición a olla con auto-marcado intermedios
- `frontend/src/components/AssemblyRunner/steps/AguaStep.jsx` — Cronómetro de llenado de agua (creado, no usado actualmente — se mantiene por compatibilidad)
- `frontend/src/components/AssemblyRunner/steps/PrintLotStep.jsx` — Impresión Zebra del lote producido
- `frontend/src/api/cleaning.js` — Cliente API limpieza

### Frontend — PÁGINAS MODIFICADAS (top por cambios)

| Página | Δ líneas | Resumen |
|---|---|---|
| `ProductionScheduler.jsx` | +559 | Calendario react-big-calendar con sticky gutter (CSS custom), single scrollbar, real start time, reschedule conflict detection, drag&drop, 0.5 lotes |
| `ProductionOperatorPage.jsx` | +503 | Header colapsable, banner FALLA activa, ShiftDisciplineTimeline embedded, KPI fallas hoy, tabs Perlas/Siropes, esferificación pill, **botón "Reportar evento" agregado** |
| `ProductionKpiPage.jsx` | +253 | KPIs por turno con score, baches, adherencia, ranking |
| `OrderManagement.jsx` | +207 | Multi-presentación, scan QR, etiquetas múltiples |
| `AdminConfig.jsx` | +189 | Configuración shift hours, fallas, zone validation toggle, IPs marcaje, etc. |
| `App.jsx` | +44 | 14+ rutas nuevas (academia, cleaning, marcaje, labor, inventory audit, shift discipline history, admin leader bonus) |

### Frontend — COMPONENTES Wizard MODIFICADOS

| Componente | Δ | Resumen |
|---|---|---|
| `AssemblyExecutionWizard.jsx` | +370 | Auto-complete invisible ENSAMBLE PROTECCION/PREMEZCLA/etc., debounce 2s save, canAdvance PESAJE_BATCH/ADICION_BATCH, guard !currentStep spinner, ENSAMBLE auto desde EMPAQUE/CONTEO |
| `GenialityRunner/GenialityExecutionWizard.jsx` | +166 | Mismo auto-complete invisible, auto-save debounce, ADICION_BATCH gate, on-mount auto-complete G_ENSAMBLE, multi-lot validation |
| `hooks/useAssemblyNote.js` | +268 | isProteccionFlow/isPremezclaFlow detection, displayOrder restore, INPUT skip intermedios, persistencia auto-fill, restoredActuals/Lots, intermedios auto-fill desde producedByPrevStage, skip INTRO para flujos rediseñados, COMPLETED → ultimo wizardStep |
| `steps/PesajeBatchStep.jsx` | +297 | Header morado, grid 2-col, sort displayOrder, sin foto intermedios, fmtQtyShort por unidad, validación 80% inline |
| `steps/OutputStep.jsx` | +229 | QC compactado, foto en bloque QC, QC_PARAMS_SABORIZACION, pesaje simple confirmar+foto, removido "Materiales utilizados" |
| `steps/EsferificacionStep.jsx` | +224 | Cronómetro auto-arranca con note.startedAt, único en planta, modal pausa, persistencia processParameters.esferificacion_timer |
| `steps/MedicionStep.jsx` | +146 | requireFlavorCheck + requireProductPhoto, grid 2-col, modal foto |
| `steps/FormacionQCStep.jsx` | +110 | Cambio agua sistema lavado SI/NO obligatorio, removido CITROSAN, modal foto |

### Frontend — Componentes Inventario / Lotes
- `components/inventory/LotManagementModal.jsx` (+228) — FEFO obligatorio en traspaso, multi-lote selección, adjuntos, validación coverage
- `components/ShiftHandover/ShiftHandoverTab.jsx` (+157) — Tab completa con firmas, simulación, autorización líder
- `services/zplLabelBuilder.js` (+64) — Iniciales operario robustas, fallback localStorage

### Frontend — Otros
- `index.css` (+147) — react-big-calendar overrides, sticky calendar gutter, animaciones pill, font scaling tablet
- `pages/admin/Users.jsx` (+94) — Cleaning supervisor flag, área asignación
- `pages/PurchaseOrdersPage.jsx` (+90) — MRP integration, custom items
- `pages/TemplateEditorPage.jsx` (+7) — Soporte sub-templates, edición displayOrder

### Datos / BD aplicados (NO migración — datos puros)
- `systemSettings.PRODUCTION_CONFIG` — config global de cronograma, zone_validation_enabled, baseDurationMin, etc.
- `systemSettings.NON_WORK_DAYS` — `[{ date: "2026-05-01", reason: "Festivo Día del Trabajo" }, { date: "2026-05-02", reason: "Sábado no laborado" }]`
- 12 plantillas SABORIZACION + stage MEDICION (Brix 60-65, pH 2.8-3.5, requireFlavorCheck, requireProductPhoto)
- Plantillas PREMEZCLA + stage IMPRESION_LOTE
- Cleaning zones + tasks (seed)
- Academia courses + modules (seed)
- ShiftWeek + ShiftAssignment de las semanas operadas

### Recursos estáticos (assets nuevos sirviéndose desde producción)
- `frontend/public/downloads/ficha-operativa-whatsapp-erp.{html,pdf}`
- `frontend/public/downloads/informe-gerencial-whatsapp-erp.{html,pdf}`
- 30+ imágenes de productos: `perlas-*.{png,webp}`, `skarcha-*.png`, `yexis-*.png`, `cocktail.png`, etc.

### Snapshots DOOR_MONITOR
- ~75 snapshots .jpg en `door_monitor/snapshots/` (capturas del sensor de puerta — datos operativos, no se borran)

### REGLA CLAVE PARA EL MERGE
Si el equipo externo trae versión de cualquiera de estos archivos:
1. **NUNCA aceptar su versión completa** sin antes haber hecho diff línea-a-línea contra la nuestra.
2. Aplicar primero su lógica nueva, luego re-injectar nuestras protecciones (auto-complete invisible, displayOrder fallback, getShiftDateStr local, validación G_PESAJE stock zona, etc.).
3. Verificar que las migraciones de BD no se duplican (los timestamps `20260320*-20260427*` son nuestros).
4. Confirmar que `systemSettings.NON_WORK_DAYS` y plantillas SABORIZACION+MEDICION sigan en BD post-merge.

---

## CAMBIO 2026-05-05 — Auto-cierre de bache Geniality al TERMINAR EMPAQUE

**Síntoma:** los operarios cerraban TERMINAR EMPAQUE (toast "Conteo completado / Proceso Completado") pero al volver al programador el bache seguía apareciendo "EN PROCESO" / pendiente, y el scheduler de Geniality contaba esos baches en la columna Prog. con sus `plannedUnits` completos (caso CEREZA-260424-0958: +275/+420 fantasma).

**Causa raíz:** la rama `currentStep.type === 'ENSAMBLE' && processType === 'EMPAQUE'` del wizard sólo cerraba la nota EMPAQUE del tamaño actual + las notas `ENSAMBLE` (Liquipops). Las notas `G_ENSAMBLE` (Ensamble Siigo de Geniality) y los EMPAQUE de los OTROS tamaños del mismo bache quedaban en `EXECUTING`/`PENDING`. El backend ([genialityAssemblyService.js:1451-1469](backend/src/services/genialityAssemblyService.js#L1451-L1469)) sólo cierra `productionBatch.status = COMPLETED` cuando `pendingNotes === 0`, así que el bache nunca cerraba → reaparecía pendiente.

**Fix:** [GenialityExecutionWizard.jsx](frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx) — en la rama EMPAQUE de Geniality, después del paso 4 (auto-complete ENSAMBLE Liquipops), añadir paso 5:
- 5a) Auto-completar todas las `G_ENSAMBLE` pendientes del bache. Para producto terminado se marca `skipRpa: true` (la RPA Siigo ya disparó por carrito); productos intermedios pre-CONTEO mantienen su lógica.
- 5b) Auto-completar `EMPAQUE`/`G_EMPAQUE` de los OTROS tamaños del mismo bache. Si tienen `carriots_consumed` se usa esa cantidad real y se marca `skipRpa`; si no, `targetQuantity`.

**Resultado:** al cerrar el empaque del primer tamaño, todo el bache cierra y el scheduler deja de contarlo en Prog.

**Archivos tocados:**
- `frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx` (lógica auto-cierre paso 5)

---

## CAMBIO 2026-05-05 (b) — Cierre de bache Geniality cuando faltan cantidades en presentaciones

**Contexto:** continuación del fix anterior. Caso TAMARINDO-260428-0213: 1000ml programado 504 / entregado real 478, 360ml programado 150 / entregado 148. Las notas G_EMPAQUE quedaban EXECUTING porque el auto-cierre usaba `targetQuantity` cuando no había carritos suficientes — Siigo recibía cantidades inventadas. Adicional: si un tamaño del bache no tenía NINGÚN carrito (presentación que no se produjo), su nota EMPAQUE/G_ENSAMBLE jamás cerraba.

**Síntoma:** operario daba TERMINAR EMPAQUE, sistema mostraba "éxito", pero el bache reaparecía pendiente y el scheduler lo seguía contando en Prog.

**Fix:** [GenialityExecutionWizard.jsx](frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx) en las dos ramas de auto-cierre (rama CONTEO ~1252 y rama EMPAQUE ~1492):

1. **Cantidad real, no target.** En lugar de caer a `empNote.targetQuantity` cuando no hay carritos, usar `qty=0` y marcar `skipRpa:true` con observación `"Presentación sin producción — bache cerrado sin esta referencia"`. Para G_ENSAMBLE de productos terminados de OTRO tamaño, se calcula la qty leyendo `carriots_consumed` de su EMPAQUE correspondiente.

2. **Productos parciales (caso TAMARINDO).** Si tiene carritos parciales (ej. 478 de 504), se cierra con la suma real de los carritos, no con el target. Siigo refleja lo realmente producido.

3. **Visibilidad de fallos.** Acumulador `failedAutoCloses` que junta nombres de notas cuyo `complete` lance excepción. Al final del bucle se muestra `message.warning("No se cerraron automáticamente: ...")` para que el operario detecte cuándo el cierre quedó parcial — antes el `console.warn` era invisible.

**Reglas finales:**
- Producto terminado con carritos → qty = suma(carritos), skipRpa (RPA per-carrito ya disparó).
- Producto terminado sin carritos → qty = 0, skipRpa.
- Intermedio (BASE/SABORIZACION) con producción → qty = targetQuantity, RPA dispara.
- Intermedio sin producción → qty = 0, skipRpa.

**Lo que NO se tocó:** rama PRODUCCION (línea ~1686+), validación canAdvance del else PRODUCTION (~2147), llamadas RPA por carrito en MARCADO_CAJAS, watcher startAutoRetryScheduler, schema de BD.

**Archivos tocados:**
- `frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx` (qty=0 + skipRpa + visibilidad de fallos en ambas ramas).

---

## CAMBIO 2026-05-05 (c) — Auto-cierre Liquipops EMPAQUE: presentaciones sin producción real

**Contexto:** caso típico Liquipops siropes (ej. FRESA-260430-0238) — un bache puede tener varias presentaciones (1150g, 350g, 3400g) y al final sólo una se fabrica realmente. Las 1150g y 350g quedan en `realRecibido=0`. El operario no puede imprimir etiquetas ni ensamblar Siigo de algo que no existe, pero el banner exige "completar TODAS las presentaciones" y bloquea el avance.

**Solución antes:** existía botón manual "❌ No se produjo esta presentación" (`handleNoProducido`) que cierra la nota con qty=0 + cierra ENSAMBLE/G_ENSAMBLE asociadas. Requería clic operario por cada presentación.

**Cambio:** [IntroStep.jsx](frontend/src/components/AssemblyRunner/steps/IntroStep.jsx) — `useEffect` automático que detecta presentaciones EMPAQUE/G_EMPAQUE con `realRecibido === 0` (no null) y las cierra solas.

**Cómo decide qué cerrar:**
1. La nota CONTEO está COMPLETED, **o** alguna nota EMPAQUE tiene `conteo_qty` ya guardado (no en draft).
2. **Existe al menos una presentación con producción > 0** — si todas están en 0/null no se toca (probable que aún no se haya registrado nada).
3. Para cada nota EMPAQUE pendiente con `actualConteo === 0`: PATCH `skipRpa:true` + complete `actualQuantity=0` + cerrar ENSAMBLE/G_ENSAMBLE asociadas con la misma regla.
4. `sessionStorage` flag por `batchId` evita re-disparar tras el `window.location.reload()` final.

**Cálculo de `actualConteo`:** mismo que el JSX (~línea 1054) — preferir suma de carritos si existen, si no leer `conteoMap[productId].actual ?? empData.conteo_qty ?? empRef.conteo_qty`.

**Banner actualizado:** ya no dice "Debes completar TODAS las presentaciones (3 pendientes)" cuando 2 están en 0. Ahora distingue:
- "Debes completar 1 presentación con producción real (2 sin producción se cerrarán solas)" → operario sólo se enfoca en lo importante.
- "Cerrando automáticamente 2 presentación(es) sin producción…" → mientras se procesa.
- "Todas las presentaciones completadas" → cuando termina.

**Lo que NO se tocó:**
- `handleNoProducido` (manual) sigue existiendo como fallback.
- Rama PRODUCCION del wizard.
- RPA per-carrito.

**Archivos tocados:**
- `frontend/src/components/AssemblyRunner/steps/IntroStep.jsx` (useEffect auto-skip + banner reformulado).

NOTA POST: el `useEffect` automático fue revertido (el usuario prefiere clic manual en "❌ No se produjo"). Solo queda el botón manual existente — el banner reformulado se mantuvo.

---

## CAMBIO 2026-05-05 (d) — Eliminación de duplicidad EMPAQUE+ENSAMBLE en plantilla BATCH-LIQUIPOPS

**Problema identificado:** la plantilla `BATCH-LIQUIPOPS` tenía 11 stages — los stages 9/10/11 (ENSAMBLE Siigo por tamaño 3400/1150/350g) eran redundantes con el sub-step ENSAMBLE interno del wizard de la nota EMPAQUE. El frontend ya unificaba ambos: cuando el operario terminaba el sub-step ENSAMBLE interno de un EMPAQUE, automáticamente buscaba la nota ENSAMBLE espejo del mismo `productId` y la cerraba ([AssemblyExecutionWizard.jsx:1175-1222](frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx#L1175-L1222)). Esto generaba 2 notas en BD para la misma operación (ej. S10 EMPAQUE 1150g y S12 ENSAMBLE 1150g, ambas con qty=168 cuando se produjo, o ambas con qty=0 cuando no se produjo).

**Decisión:** eliminar los stages ENSAMBLE 9/10/11 y absorber su responsabilidad (RPA Siigo + clasificación FINISHED_GOOD) en los stages EMPAQUE 6/7/8.

**Cambios aplicados:**

1. **BD plantilla `BATCH-LIQUIPOPS`** (script `migrate_batch_liquipops.js`, backup en `backend/BACKUP_batch_liquipops_2026-05-05.json`):
   - **Borrados** stages 9, 10, 11 (ENSAMBLE Siigo 3400/1150/350g).
   - **Actualizados** stages 6, 7, 8 (EMPAQUE):
     - `processParameters.assembly_on_complete = true` → activa el RPA Siigo desde el sub-step ENSAMBLE interno del wizard.
     - `outputClassification = 'FINISHED_GOOD'` → ingreso al stock como producto terminado.
   - `totalStages: 11 → 8`.

2. **Frontend** [AssemblyExecutionWizard.jsx:1175-1226](frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx#L1175-L1226):
   - Bloque de auto-cierre de nota ENSAMBLE espejo se mantiene como **compatibilidad para baches en curso** (los creados antes de la migración ya tienen S10/S11/S12 abiertas en BD y deben cerrarse para que pendingNotes=0).
   - **NUEVO:** antes de cerrar la nota espejo se hace `PATCH processParameters.skipRpa = true` para evitar RPA Siigo DUPLICADO (el RPA ya disparó arriba en el sub-step ENSAMBLE interno gracias a `assembly_on_complete=true`).
   - Para baches NUEVOS (post-migración) este bloque no encuentra nota espejo (stages 9-11 ya no existen) → `filter` devuelve [] → no hace nada.

**Resultado esperado:**
- Baches **nuevos**: 8 stages, sin nota ENSAMBLE espejo. EMPAQUE 6/7/8 dispara RPA Siigo + ingest stock como FINISHED_GOOD. Una sola operación por presentación.
- Baches **en curso** (ej. MANGO-BICHE-CON-SAL-260427-2354 con S10/S11 ENSAMBLE espejo abiertas): seguirán cerrando correctamente — el frontend cierra la espejo con skipRpa para no duplicar Siigo.

**Lo que NO se tocó:**
- Plantillas hijas (TMPL010/TMPL011/TMPL012 — siguen como están, son legacy o uso especial).
- Backend `completeNote` — el frontend ya dispara el RPA via `assembly_on_complete:true` por compatibilidad.
- Otros tipos de bache (Geniality, sub-templates BASE/COMPUESTO, etc.).

**Archivos tocados:**
- BD: `assemblyTemplate` `BATCH-LIQUIPOPS` (3 stages borrados + 3 actualizados + totalStages updated). Backup en `backend/BACKUP_batch_liquipops_2026-05-05.json`.
- `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx` (skipRpa al cerrar nota espejo).

**Pruebas pendientes (a cargo del usuario):**
1. Bache nuevo Liquipops cualquier sabor: verificar que se generen sólo 8 stages (no 11) y que al cerrar EMPAQUE de cada tamaño dispare RPA Siigo + ingest stock una sola vez (no duplicado).
2. Bache en curso MANGO-BICHE-CON-SAL-260427-2354: cerrar EMPAQUE 3400g (S8) y EMPAQUE 350g (S9) y verificar que las notas ENSAMBLE espejo S10/S11 cierren con skipRpa y NO disparen RPA adicional.

---

## CAMBIO 2026-05-05 (e) — Fix bucle "RESUMEN FINAL / COMPLETAR ETAPA" tras cerrar EMPAQUE

**Síntoma:** Tras cerrar el último EMPAQUE de un bache Liquipops (ej. MANGO-BICHE-CON-SAL-260427-2354), el operario era redirigido al wizard de un EMPAQUE ya COMPLETED, viendo otra vez la pantalla "RESUMEN FINAL — ENSAMBLE / COMPLETAR ETAPA". Si daba clic, el backend respondía con `RPA SKIPPED` + `DUPLICATE_INGESTION blocked` y el operario seguía atrapado en un bucle.

**Causa:** [AssemblyExecutionWizard.jsx:1561-1573](frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx#L1561-L1573) buscaba "el siguiente EMPAQUE selector" filtrando sólo `n.id !== note.id` pero **sin filtrar `n.status !== 'COMPLETED'`**. Cuando todos los EMPAQUE estaban cerrados, el filtro retornaba el primer EMPAQUE COMPLETED (ej. S8 3400g), y el frontend navegaba ahí — al re-abrir el wizard de una nota ya cerrada se mostraba el último step del wizard ("RESUMEN FINAL") con botón habilitado.

**Fix:** agregar `n.status !== 'COMPLETED'` al filtro del `selectorNote`. Si no hay EMPAQUE pendiente, cae al `else` que avanza al siguiente stage NO-ENSAMBLE; si tampoco hay (bache 100% cerrado), muestra el `setShowCompletionPanel(true)` con mensaje "🎉 Todas las etapas completadas! Bache cerrado."

**Lo que NO se tocó:** lógica de cierre de notas ENSAMBLE espejo (sigue ejecutándose con skipRpa), navegación de baches en curso (los que tienen S10/S11 viejas).

**Archivos tocados:**
- `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx` (filtro selectorNote en handleComplete rama EMPAQUE).

---

## CAMBIO 2026-05-05 (f) — Patch retroactivo `assembly_on_complete` en notas EMPAQUE de baches Liquipops abiertos

**Problema:** la migración de plantilla (cambio (d)) añadió `assembly_on_complete:true` a los stages 6/7/8 EMPAQUE. Pero los baches creados ANTES de la migración tienen sus notas EMPAQUE con `processParameters` heredados del template viejo — sin ese flag. Cuando el operario cerraba uno de esos baches:
- Frontend NO disparaba RPA Siigo desde el sub-step ENSAMBLE interno (no estaba `assembly_on_complete:true`).
- Backend cerraba la nota ENSAMBLE espejo con `skipRpa:true` (cambio (d)) → tampoco disparaba RPA.
- **Resultado: el producto terminado NO entraba a Siigo.**

**Fix:** UPDATE retroactivo a TODAS las notas EMPAQUE en estado PENDING/EXECUTING de baches Liquipops abiertos para añadir `assembly_on_complete:true` en `processParameters`.

**Resultado:** 28 notas EMPAQUE parchadas en 14 baches abiertos (CEREZA, MANGO-BICHE-CON-SAL, MANZANA-VERDE, MARACUYA). Cuando el operario cierre cualquiera de esos EMPAQUE, el wizard dispara RPA Siigo correctamente.

**Lo que NO se tocó:**
- Baches ya COMPLETED (no necesitan).
- Notas ENSAMBLE espejo S10/S11/S12... (siguen con la lógica de skipRpa).
- Otros grupos (Geniality).

**Archivos/datos tocados:**
- BD: `assemblyNote.processParameters` de 28 notas EMPAQUE Liquipops abiertas.

---

## CAMBIO 2026-05-05 (g) — RPA Siigo dispatch SOLO desde el backend (eliminación del frontend)

**Problema:** después del cambio (d) el RPA Siigo se disparaba desde DOS lugares:
1. Frontend [`AssemblyExecutionWizard.jsx:1099-1128`] cuando la nota EMPAQUE tenía `assembly_on_complete:true`.
2. Backend [`assemblyService.completeNote`] cuando cerraba una nota ENSAMBLE espejo.

Para evitar duplicado el frontend marcaba la nota espejo con `skipRpa:true` antes de cerrarla. **Pero eso falló en el caso real** del bache MANGO-BICHE-CON-SAL-260428-0134 (350g, 1 unidad): el PATCH skipRpa no se aplicó (race condition / `.catch(() => {})`) y la nota S13 ENSAMBLE quedó con `skipRpa=undefined`. Resultado: 2 RPAs Siigo para la misma unidad (`c73b8765` desde frontend + `e11fbcbb` desde backend).

**Decisión arquitectónica del usuario:** "el backend es quien decide cuándo disparar RPA, no el frontend". Reescritura para que el RPA viva exclusivamente en backend.

**Cambios:**

1. **Backend** [`assemblyService.completeNote`] (~líneas 1646-1680): la decisión `isEnsambleStep` (que controla si se dispara RPA) ahora considera el grupo contable del producto:
   - `EMPAQUE` con `accountGroup=1401` (Liquipops finished good) y `type !== 'MATERIA_PRIMA'` → **dispara RPA**.
   - `ENSAMBLE` con `accountGroup=1401` (espejo de Liquipops finished good, baches en curso) → **NO dispara** (la EMPAQUE del mismo productId ya lo hizo).
   - `EMPAQUE` con `accountGroup=1402` (Geniality) → **NO dispara** (per-carrito durante MARCADO_CAJAS).
   - `ENSAMBLE`/`FORMACION` de productos intermedios (BASE, COMPUESTO, PROTECCION, ESFERAS) → comportamiento original, dispara.

2. **Frontend** [`AssemblyExecutionWizard.jsx`]:
   - Eliminado el bloque que disparaba RPA desde el sub-step ENSAMBLE interno del wizard EMPAQUE (~líneas 1099-1128). Sólo queda el dispatch de adjustment de defectuosos (otro endpoint).
   - El bloque que cierra la nota ENSAMBLE espejo (~líneas 1175-1226) ya NO marca `skipRpa:true` — el backend ya bloquea por accountGroup.

3. **Plantilla** `BATCH-LIQUIPOPS`: removido `assembly_on_complete` de `processParameters` de los 3 stages EMPAQUE (6/7/8). Ya no se necesita esa señal.

4. **Patch retroactivo**: removido `assembly_on_complete` de las 28 notas EMPAQUE Liquipops abiertas (CEREZA, MANZANA-VERDE, MARACUYA, MANGO-BICHE-CON-SAL).

**Resultado:**
- Baches NUEVOS: cierre EMPAQUE → backend dispara RPA Siigo único + ingest stock. Cero duplicados.
- Baches EN CURSO (con notas ENSAMBLE espejo): cierre EMPAQUE → backend dispara RPA. Frontend cierra nota espejo. Backend al cerrar la espejo detecta que es ENSAMBLE de finished good Liquipops y omite el RPA. Cero duplicados.

**Lo que NO se tocó:**
- Lógica de Geniality (per-carrito).
- ENSAMBLE/FORMACION de productos intermedios (sigue disparando RPA correctamente).
- Adjustment de defectuosos (sigue desde frontend, otro endpoint).

**Archivos tocados:**
- `backend/src/services/assemblyService.js` (lógica `isEnsambleStep` extendida).
- `frontend/src/components/AssemblyRunner/AssemblyExecutionWizard.jsx` (bloque RPA frontend eliminado, skipRpa eliminado).
- BD: `assemblyTemplate` BATCH-LIQUIPOPS (3 stages limpiados) + 28 notas EMPAQUE en curso.

**Backend reload requerido:** `pm2 reload popping-backend` (hecho).
**Frontend build requerido:** `npm run build` (hecho).
**Operarios:** Ctrl+Shift+R para cargar bundle nuevo.


---

## CAMBIO (2026-05-05): justifyOvertime no leía isFixed → bloqueaba autorización admin

**Archivo:** `backend/src/controllers/attendanceController.js` (~línea 2372)

**Problema:** Al marcar EXIT FINAL fuera del horario (>30 min), el kiosko muestra el modal "Tiempo extra detectado" y pide PIN del admin. Cuando el admin lo autoriza, el endpoint `/api/attendance/justify-overtime` re-consulta al empleado pero el `select` no incluía `isFixed`. La función `getScheduledShiftEnd` exige `isFixed === true`, así que devolvía `null`, `assessOvertime` decía `applies:false`, y el endpoint respondía error: "No hay tiempo extra que justificar (estás dentro del horario)" — bloqueando la autorización aunque sí hubiera tiempo extra real.

**Fix:** Agregar `isFixed: true` al `select` del `findUnique` en `justifyOvertime`:

```js
const employee = await prisma.shiftEmployee.findUnique({
    where: { cedula: String(cedula).trim() },
    select: { id: true, name: true, area: true, active: true, isFixed: true }  // ← agregar isFixed
});
```

**Backend reload requerido:** `pm2 restart popping-backend` (hecho).

---

## CAMBIO 2026-05-05 (h) — Bloqueo de transferencia LOGISTICA desde zona PRODUCCION

**Problema raíz del descuadre:** EMPAQUE no creaba "Actas de Entrega" (`ProductHandoff`) al entregar a LOGISTICA. Como LOGISTICA tenía permiso para transferir desde **cualquier zona**, agarraba lotes directo desde zone='PRODUCCION' o, peor, los pedidos los consumían de PRODUCCION (vía fallback de `consumeForOrder`). Resultado: `Product.productionZoneStock` quedaba inflado con fantasmas porque `consumeForOrder` con `fromZone === toZone` no actualiza el cache.

**Decisión del usuario:** quitar a LOGISTICA la opción de transferir desde zona PRODUCCION. Solo ADMIN podrá hacerlo (escape hatch para correcciones manuales). Forzar a EMPAQUE a crear Acta de Entrega.

**Cambios aplicados:**

1. **Backend** [`finishedLotRoutes.js:276-310`](backend/src/routes/finishedLotRoutes.js#L276-L310): nuevo guard en `POST /finished-lots/transfer`:
   ```js
   if (fromZone === 'PRODUCCION' && req.user.role !== 'ADMIN') {
       return res.status(403).json({
           error: 'No puedes transferir desde la zona de Producción. El producto debe entregarse mediante Acta de Entrega creada por Empaque.'
       });
   }
   ```

2. **Frontend** [`FinishedProductZonePage.jsx`](frontend/src/pages/FinishedProductZonePage.jsx) — el botón "Transferir" en la pestaña PRODUCCION sólo se renderiza si:
   - `user.role === 'ADMIN'`, **o**
   - `user.role === 'LOGISTICA' && activeZone !== 'PRODUCCION'`

   LOGISTICA puede seguir transfiriendo entre PRODUCTO_TERMINADO ↔ NO_CONFORME / CUARENTENA / MAQUILA / PUBLICIDAD pero **no desde PRODUCCION**.

**Operación correcta a partir de ahora:**
1. EMPAQUE termina un bache → producto queda en zone='PRODUCCION'.
2. EMPAQUE crea **Acta de Entrega** (`POST /handoffs`) listando los lotes a entregar a LOGISTICA.
3. LOGISTICA recibe el Acta (`POST /handoffs/:id/receive`) → `transferZone(PRODUCCION → PRODUCTO_TERMINADO)` automáticamente, y `productionZoneStock` se decrementa correctamente.
4. LOGISTICA despacha pedidos consumiendo de PRODUCTO_TERMINADO.

**Lo que NO se tocó (pendiente bajo confirmación del usuario):**
- `consumeForOrder` aún tiene `ZONES_PRIORITY = ['PRODUCTO_TERMINADO', 'PRODUCCION']` — el despacho podría consumir de PRODUCCION si LOGISTICA fuerza un escenario raro. Para forzar disciplina total habría que cambiar a `['PRODUCTO_TERMINADO']`.
- El cache fantasma `productionZoneStock` ya acumulado (descuadre histórico) sigue inflado. Se necesita reconciliación si quieres limpiarlo de un golpe.

**Backend reload:** `pm2 reload popping-backend` (hecho).
**Frontend build:** `npm run build` (hecho).
**Operarios:** Ctrl+Shift+R para cargar el bundle nuevo.

**Archivos tocados:**
- `backend/src/routes/finishedLotRoutes.js` (guard fromZone=PRODUCCION).
- `frontend/src/pages/FinishedProductZonePage.jsx` (botón Transferir condicional por rol/zona).

---

## CAMBIO 2026-05-05 (i) — Bloqueo total de despacho desde zona PRODUCCION + Reconciliación de fantasmas

**Contexto:** continuación de (h). El bloqueo de transferencia para LOGISTICA cerró una vía. Pero quedaba abierta la otra: `consumeForOrder` (despacho de pedido al picking) tenía `ZONES_PRIORITY = ['PRODUCTO_TERMINADO', 'PRODUCCION']` — si LOGISTICA forzaba despachar antes de que EMPAQUE creara Acta de Entrega, el sistema consumía directo desde PRODUCCION sin actualizar el cache `productionZoneStock`.

Adicionalmente, el descuadre histórico acumulado: 1,226 unidades fantasma en lotes zone='PRODUCCION' de baches ya COMPLETED, y un cache `productionZoneStock` total inflado en 5,225 (real era ≤1,226).

**Cambios aplicados:**

### 1. Backend `consumeForOrder` ([finishedLotService.js:292-358](backend/src/services/finishedLotService.js#L292-L358))

```js
// ANTES
const ZONES_PRIORITY = ['PRODUCTO_TERMINADO', 'PRODUCCION'];

// DESPUÉS
const ZONES_PRIORITY = ['PRODUCTO_TERMINADO'];
```

Cuando no hay stock en PRODUCTO_TERMINADO, el error es claro y orienta al operario:
```
"Lote ${lotNumber} aún está en zona PRODUCCION (disp ${X}). Debe entregarse mediante
Acta de Entrega creada por Empaque antes de despachar."
```

### 2. Reconciliación de datos (script atómico)

Para cada producto finished Liquipops+Geniality:
- Identificar lotes en zone='PRODUCCION' con `currentQuantity > 0`.
- Filtrar SÓLO los huérfanos (batchId apunta a bache `COMPLETED` o batchId nulo).
- Setear `currentQuantity = 0`, `status = 'DEPLETED'`.
- Crear `FinishedLotTransfer` de auditoría (motivo: "Reconciliación 2026-05-05: lote huérfano de bache COMPLETED — Siigo es fuente de verdad").
- Recalcular `Product.productionZoneStock = SUM(FinishedLotStock.currentQuantity WHERE zone='PRODUCCION' AND batch.status NOT IN [COMPLETED, FAILED])`.

**Resultado:**
- Productos ajustados: **24**
- Lotes cerrados a 0: **15** (todos con auditoría en `FinishedLotTransfer`)
- Unidades fantasma borradas: **1,226**
- `productionZoneStock` total ANTES: 5,225 → DESPUÉS: **0**
- Lotes con stock en zone=PRODUCCION (Liquipops+Geniality): 0

### 3. Lo que NO se tocó

- `currentStock` (Siigo es la fuente de verdad).
- `FinishedLotStock` con zone='PRODUCTO_TERMINADO' (no se tocó).
- Lotes asociados a baches abiertos (PENDING / EXECUTING / STAGE_*) — su stock se preserva para que producción en curso no se rompa.

### 4. Disciplina nueva del flujo (resumen final)

```
EMPAQUE termina bache
  → FinishedLotStock(zone='PRODUCCION', batchId=X)
EMPAQUE crea Acta de Entrega (POST /handoffs)
  → ProductHandoff PENDING
LOGISTICA recibe Acta (POST /handoffs/:id/receive)
  → transferZone PRODUCCION → PRODUCTO_TERMINADO
  → productionZoneStock decrementa, currentStock se actualiza vía sync Siigo
LOGISTICA hace picking del pedido
  → consumeForOrder consume SÓLO de PRODUCTO_TERMINADO
  → si no hay stock allí → error claro pidiendo Acta
LOGISTICA despacha
  → orden DISPATCHED, currentStock baja por el dispatchOrder
```

**Backend reload:** `pm2 reload popping-backend` (hecho).
**Frontend:** sin cambios adicionales (la UI ya está OK desde (h)).

**Archivos/datos tocados:**
- `backend/src/services/finishedLotService.js` (ZONES_PRIORITY + mensaje error).
- BD: 15 `FinishedLotStock` cerrados, 24 `Product.productionZoneStock` reseteados, 15 `FinishedLotTransfer` creados (auditoría).

---

## CAMBIO (2026-05-05): Optimización del reconocimiento facial en kiosko

**Archivos:** `kiosko/index.html`, `door_monitor/app.py`

**Síntoma:** Operarios reportaban lentitud al marcar entrada/salida de descanso (face recognition).

**Causa raíz (5 puntos):**

1. El loop de detección en frontend (`startFaceDetection`, cada 300 ms) ejecutaba `.detectSingleFace().withFaceLandmarks(true).withFaceDescriptor()`, pero el descriptor y los landmarks **nunca se enviaban al backend** — el único campo usado era `det.detection.box`. Calcular el descriptor con face-api.js corre la red de reconocimiento (~6 MB) en CPU de tablet por nada.
2. `loadFaceModels()` bajaba 3 modelos del CDN (`tinyFaceDetector`, `faceLandmark68TinyNet`, `faceRecognitionNet`) cuando solo se usa el primero.
3. `inputSize: 416` en TinyFaceDetectorOptions — innecesariamente grande.
4. JPEG capturado al 85 % de calidad — overkill para el match de InsightFace.
5. Python `door_monitor/app.py` tenía un hilo `keep_warm` que cada 30 s corría `face_app.get(np.zeros(480,480,3))` "para mantener calientes los pesos". El modelo ya está en RAM, ese keep-warm puede bloquear ~100-300 ms una petición `/match` concurrente.

**Fix:**

1. **`kiosko/index.html` — `loadFaceModels()`** — solo carga `tinyFaceDetector`:
   ```js
   await faceapi.nets.tinyFaceDetector.loadFromUri(CDN);
   ```

2. **`kiosko/index.html` — loop de detección** (alrededor de la línea 631):
   ```js
   const det = await faceapi
       .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize:320, scoreThreshold:0.30 }));
   if (!det) { status.textContent = 'No se detecta rostro. Mire a la cámara.'; return; }
   const box = det.box;   // antes era det.detection.box
   ```
   - Quitado `.withFaceLandmarks(true)` y `.withFaceDescriptor()`.
   - `inputSize: 416` → `320`.
   - Acceso `det.detection.box` → `det.box` (ya no hay envoltorio de landmarks).

3. **`kiosko/index.html`** — JPEG quality 0.85 → 0.72:
   ```js
   const blob = await new Promise(r => cap.toBlob(r, 'image/jpeg', 0.72));
   ```

4. **`door_monitor/app.py`** — eliminado el bloque `keep_warm`. Solo queda el warm-up único en arranque:
   ```python
   try:
       warm = np.zeros((480, 480, 3), dtype=np.uint8)
       face_app.get(warm)
       log.info("InsightFace pre-calentado (warm-up exitoso)")
   except Exception as e:
       log.warning(f"Warm-up falló: {e}")
   ```

**LO QUE NO SE TOCÓ (importante para seguridad):**

- **InsightFace en backend Python (`/match`) sigue idéntico** — sigue siendo el único responsable de identificar al empleado por su embedding ArcFace de 512 dimensiones contra el cache enrolado. Cualquier "optimización" que toque eso degrada la seguridad.
- **Liveness sigue idéntico** — 4 frames con desviación >1.2 px obligatorios.
- **Anti-spoofing de pantalla sigue idéntico** — escaneo de bordes para bloquear fotos de tablets.
- **Threshold de match en Python (`FACE_THRESHOLD = 0.50`)** sigue igual.
- **`det_size = (480, 480)` en InsightFace** — bajarlo a 320 sí degradaría reconocimiento de caras lejanas; **NO bajar**.

**Reload requerido:**
- `pm2 restart door-monitor` (hecho).
- Tablets recargan automáticamente (`Cache-Control: no-store` en nginx).

**Resultado esperado:** ~40-50 % más rápido en la fase "Buscando rostro...", payload de subida ~35 % más liviano para 4G.

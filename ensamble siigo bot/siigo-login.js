const { chromium } = require('playwright');

async function crearNotaEnsamble() {
    console.log('🚀 Siigo - Nota de Ensamble\n');

    const browser = await chromium.launch({
        headless: false,
        slowMo: 300,
        args: ['--start-maximized']
    });

    const context = await browser.newContext({
        viewport: null,
        no_viewport: true
    });

    const page = await context.newPage();

    try {
        // === LOGIN ===
        console.log('=== LOGIN ===');
        await page.goto('https://siigonube.siigo.com/');
        await page.waitForTimeout(3000);

        await page.fill('#siigoSignInName', 'Gerencia@poppingbobainternational.com');
        await page.fill('#siigoPassword', 'Naranjita2025*');
        await page.click('#siigoNext');
        await page.waitForTimeout(5000);

        await page.click('button:has-text("Ingresar")');
        await page.waitForTimeout(5000);
        console.log('✅ Login\n');

        // === NAVEGACIÓN ===
        console.log('=== NAVEGACIÓN ===');
        await page.goto('https://siigonube.siigo.com/#/assembly-note/1664');
        await page.waitForTimeout(5000);
        console.log('✅ Formulario\n');

        // === TERCERO ===
        console.log('=== TERCERO ===');

        // 1. Click en el PRIMER input autocomplete (es el de Tercero)
        const terceroInput = page.locator('id=autocomplete_autocompleteInput').first();
        await terceroInput.click();
        await page.waitForTimeout(500);

        // 2. Escribir NIT despacio
        console.log('Escribiendo NIT 901878434 lentamente...');
        await terceroInput.pressSequentially('901878434', { delay: 200 });

        // 3. Esperar dropdown (Reducido a 3s)
        console.log('Esperando dropdown...');
        await page.waitForTimeout(3000);

        // 4. Click en la opción con texto exacto
        console.log('Seleccionando POPPING BOBA...');
        try {
            await page.click('text="POPPING BOBA INTERNATIONAL S.A.S"', { timeout: 5000 });
            console.log('✅ POPPING BOBA seleccionado\n');
        } catch (e) {
            console.log('⚠️ No se encontró por texto, intentando con coordenadas...');
            // Fallback: buscar y clickear la fila
            await page.evaluate(() => {
                const rows = document.querySelectorAll('tr, div');
                for (const row of rows) {
                    if (row.textContent.includes('901878434') && row.textContent.includes('POPPING BOBA')) {
                        row.click();
                        break;
                    }
                }
            });
            console.log('✅ Seleccionado con fallback\n');
        }

        await page.waitForTimeout(2000);

        // === TIPO ENSAMBLE ===
        console.log('=== TIPO ENSAMBLE ===');
        console.log('Seleccionando: Materia prima - producto en proceso...');

        // Usar el segundo select (index 1) o buscar por opciones
        const tipoOK = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            for (const select of selects) {
                const options = Array.from(select.options);
                // Usar includes separados para evitar problema con el guion (en-dash vs hyphen)
                const opt = options.find(o =>
                    o.text.includes('Materia prima') &&
                    o.text.includes('en proceso')
                );
                if (opt) {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });

        console.log(tipoOK ? '✅ Tipo seleccionado\n' : '⚠️ No seleccionado\n');
        await page.waitForTimeout(2000);

        // === PRODUCTO ===
        console.log('=== PRODUCTO ===');
        console.log('Seleccionando: BASE LIQUIPOPS...');

        // 1. Focus en el TERCER input autocomplete (Index 2)
        const productInput = page.locator('id=autocomplete_autocompleteInput').nth(2);
        await productInput.click();
        await page.waitForTimeout(500);

        // 2. Escribir nombre del producto lentamente
        await productInput.pressSequentially('BASE LIQUIPOPS', { delay: 100 });

        // 3. Esperar y seleccionar con teclado (ArrowDown + Enter)
        console.log('Esperando dropdown...');
        await page.waitForTimeout(2000);

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');

        console.log('✅ Producto seleccionado: BASE LIQUIPOPS\n');
        await page.waitForTimeout(2000);

        // === BODEGA ===
        console.log('=== BODEGA ===');
        console.log('Seleccionando Bodega: Sin asignar...');

        // Index 3: Bodega (Producto a ensamblar)
        const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
        await bodegaInput.click();
        await page.waitForTimeout(500);

        await bodegaInput.pressSequentially('Sin asignar', { delay: 100 });

        console.log('Esperando dropdown de bodega...');
        await page.waitForTimeout(2000);

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');

        console.log('✅ Bodega seleccionada: Sin asignar\n');
        await page.waitForTimeout(1000);

        // === CANTIDAD ===
        console.log('=== CANTIDAD ===');
        console.log('Ingresando cantidad: 1000...');
        // Selector identificado: #inputDecimal_siigoInputDecimal (index 0)
        await page.locator('#inputDecimal_siigoInputDecimal').first().fill('1000');
        await page.waitForTimeout(2000); // Esperar a que se calculen ingredientes

        // === BODEGAS DE INGREDIENTES ===
        console.log('=== BODEGAS INGREDIENTES ===');
        // Buscar los selects de bodega dentro de la tabla de ingredientes
        // Cada fila de ingrediente tiene un <select> para la bodega
        const bodegaSelects = await page.evaluate(() => {
            // Buscar todos los selects en la sección de ingredientes
            const selects = document.querySelectorAll('select');
            const bodegaInfo = [];
            selects.forEach((sel, idx) => {
                const options = Array.from(sel.options);
                // Los selects de bodega tienen opciones como "Sin asignar"
                const hasSinAsignar = options.some(o => o.text.includes('Sin asignar'));
                if (hasSinAsignar) {
                    bodegaInfo.push({ index: idx, currentValue: sel.value, optionCount: options.length });
                }
            });
            return bodegaInfo;
        });

        console.log(`Selects de bodega encontrados: ${bodegaSelects.length}`);

        // El primer select de bodega (index 0 de los encontrados) es el de "Tipo ensamble",
        // así que lo saltamos si ya fue configurado. 
        // Los selects de bodega de ingredientes empiezan después del de tipo ensamble.
        for (let i = 0; i < bodegaSelects.length; i++) {
            const selInfo = bodegaSelects[i];
            console.log(`🔧 Configurando bodega select #${i} (global index ${selInfo.index})...`);
            const configured = await page.evaluate((globalIdx) => {
                const selects = document.querySelectorAll('select');
                const sel = selects[globalIdx];
                if (!sel) return false;
                const options = Array.from(sel.options);
                const sinAsignarOpt = options.find(o => o.text.includes('Sin asignar'));
                if (sinAsignarOpt && sel.value !== sinAsignarOpt.value) {
                    sel.value = sinAsignarOpt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return sel.value === (sinAsignarOpt ? sinAsignarOpt.value : '');
            }, selInfo.index);
            console.log(configured ? `✅ Bodega ${i} configurada` : `ℹ️ Bodega ${i} ya estaba correcta`);
        }
        await page.waitForTimeout(1000);

        // === CERRAR MODALES/OVERLAYS ===
        console.log('=== CERRANDO OVERLAYS ===');
        // Cerrar cualquier modal MUI que haya quedado abierto
        const hasModal = await page.locator('.MuiDialog-root').count();
        if (hasModal > 0) {
            console.log(`⚠️ Modal MUI detectado (${hasModal}), cerrando...`);
            // Intentar cerrar con botón de cierre del modal
            try {
                const closeBtn = page.locator('.MuiDialog-root button:has-text("Cancelar"), .MuiDialog-root button:has-text("Cerrar"), .MuiDialog-root [aria-label="close"], .MuiDialog-root .MuiIconButton-root').first();
                if (await closeBtn.isVisible({ timeout: 1000 })) {
                    await closeBtn.click();
                    console.log('✅ Modal cerrado con botón');
                }
            } catch (e) {
                console.log('Intentando cerrar modal con Escape...');
            }
            // Fallback: presionar Escape
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
            // Fallback adicional: remover backdrop por JS
            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            console.log('✅ Overlays limpiados');
        } else {
            console.log('✅ Sin overlays bloqueantes');
        }
        await page.waitForTimeout(1000);

        // === OBSERVACIONES ===
        console.log('=== OBSERVACIONES ===');
        console.log('Ingresando observación...');
        await page.locator('textarea[placeholder="Observaciones"]').fill('nota de ensamble creada de forma automatica');
        await page.waitForTimeout(500);

        // === GUARDAR Y CAPTURAR CÓDIGO ===
        console.log('=== GUARDAR ===');
        console.log('Guardando nota de ensamble...');
        // Asegurarse de que no hay overlays bloqueando
        await page.evaluate(() => {
            document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
        });
        await page.waitForTimeout(500);
        const saveBtn = page.locator('button:has-text("Guardar")').first();
        await saveBtn.click({ force: true });
        console.log('✅ Botón Guardar presionado\n');

        console.log('⏳ Esperando confirmación y código...');
        await page.waitForTimeout(6000); // Esperar a que guarde/redirija

        // Capturar URL final
        console.log('🔗 URL Final:', page.url());

        // Intentar leer título o mensaje
        try {
            const title = await page.title();
            console.log('📄 Título:', title);

            // Si redirige a vista detalle, buscar h3 o similar
            // Si muestra un toast, intentar capturarlo
            const toast = await page.locator('.toast-message').textContent().catch(() => '');
            if (toast) console.log('🔔 Mensaje:', toast);

        } catch (e) { }

        console.log('\n=== PROCESO FINALIZADO ===');
        await page.screenshot({ path: 'siigo-final.png' });

        // Dejar abierto para ver
        await page.waitForTimeout(10000);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await page.screenshot({ path: 'siigo-error.png' });
    }
}

crearNotaEnsamble().catch(console.error);

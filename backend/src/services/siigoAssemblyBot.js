/**
 * Siigo Assembly Note Bot (RPA)
 * 
 * Uses Playwright to automate creating assembly notes in Siigo Nube.
 * Runs headless on the server, triggered via API endpoint.
 * 
 * Parameters:
 *  - productName: Name of the product to assemble (as it appears in Siigo)
 *  - quantity: Final quantity to produce
 *  - assemblyType: 'proceso' (Materia prima → producto en proceso) or 'terminado' (producto en proceso → producto terminado)
 *  - observations: Text for observation field
 */

const { chromium } = require('playwright');
const path = require('path');

// Siigo credentials
const SIIGO_EMAIL = 'Gerencia@poppingbobainternational.com';
const SIIGO_PASSWORD = 'Naranjita2025*';
const SIIGO_COMPANY = 'POPPING BOBA INTERNATIONAL';
const ASSEMBLY_NOTE_URL = 'https://siigonube.siigo.com/#/assembly-note/1664';

/**
 * Create an assembly note in Siigo via browser automation
 * @param {Object} params
 * @param {string} params.productName - Product name as it appears in Siigo
 * @param {number} params.quantity - Quantity to produce
 * @param {string} params.assemblyType - 'proceso' or 'terminado'
 * @param {string} params.observations - Notes/observations
 * @returns {Object} Result with success status, URL, and screenshot path
 */
async function createSiigoAssemblyNote({ productName, quantity, assemblyType = 'proceso', observations = '' }) {
    const screenshotDir = path.join(__dirname, '..', 'rpa-screenshots');
    const timestamp = Date.now();
    const logs = [];
    const log = (msg) => { console.log(msg); logs.push(msg); };

    log('🚀 Siigo RPA - Nota de Ensamble');
    log(`📦 Producto: ${productName}`);
    log(`📊 Cantidad: ${quantity}`);
    log(`🔧 Tipo: ${assemblyType === 'terminado' ? 'Producto en proceso → Producto terminado' : 'Materia prima → Producto en proceso'}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    try {
        // === 1. LOGIN ===
        log('=== LOGIN ===');
        await page.goto('https://siigonube.siigo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        await page.fill('#siigoSignInName', SIIGO_EMAIL);
        await page.fill('#siigoPassword', SIIGO_PASSWORD);
        await page.click('#siigoNext');
        await page.waitForTimeout(5000);

        await page.click('button:has-text("Ingresar")');
        await page.waitForTimeout(5000);
        log('✅ Login exitoso');

        // === 2. NAVIGATE TO ASSEMBLY NOTE FORM ===
        log('=== NAVEGACIÓN ===');
        await page.goto(ASSEMBLY_NOTE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        log('✅ Formulario de Nota de Ensamble cargado');

        // === 3. TERCERO (Company NIT) ===
        log('=== TERCERO ===');

        // Find the Tercero input field (it's the first autocomplete on the page)
        const terceroInput = page.locator('id=autocomplete_autocompleteInput').first();
        await terceroInput.click();
        await page.waitForTimeout(1000);

        // Clear any existing value and type NIT
        await terceroInput.fill('');
        await page.waitForTimeout(500);
        await terceroInput.pressSequentially('901878434', { delay: 250 });
        await page.waitForTimeout(4000); // Wait for autocomplete dropdown

        // Try selecting from dropdown using keyboard
        let terceroSelected = false;
        try {
            // Method 1: ArrowDown + Enter (works for most autocompletes)
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);

            // Check if field was filled
            const fieldValue = await terceroInput.inputValue().catch(() => '');
            if (fieldValue && fieldValue.length > 3) {
                terceroSelected = true;
                log(`✅ Tercero seleccionado: ${fieldValue}`);
            }
        } catch (e) {
            log('⚠️ Método 1 falló, intentando método 2...');
        }

        if (!terceroSelected) {
            try {
                // Method 2: Click on dropdown item
                await terceroInput.fill('');
                await page.waitForTimeout(500);
                await terceroInput.pressSequentially('901878434', { delay: 250 });
                await page.waitForTimeout(4000);

                // Click on the first visible result
                const dropdownItem = page.locator('text=901878434').first();
                await dropdownItem.click({ timeout: 5000 });
                await page.waitForTimeout(2000);
                terceroSelected = true;
                log('✅ Tercero seleccionado (click directo)');
            } catch (e) {
                log('⚠️ Método 2 falló, intentando método 3...');
            }
        }

        if (!terceroSelected) {
            // Method 3: JavaScript click on matching element
            await page.evaluate((nit) => {
                const elements = document.querySelectorAll('li, tr, div, span, a');
                for (const el of elements) {
                    if (el.textContent.includes(nit) && el.offsetHeight > 0) {
                        el.click();
                        return true;
                    }
                }
                return false;
            }, '901878434');
            await page.waitForTimeout(2000);
            log('✅ Tercero seleccionado (fallback JS)');
        }
        await page.waitForTimeout(2000);

        // Verify Tercero was actually selected
        const terceroValue = await page.evaluate(() => {
            const input = document.getElementById('autocomplete_autocompleteInput');
            return input ? input.value : '';
        });
        if (!terceroValue || terceroValue.length < 3) {
            log('❌ Tercero NO fue seleccionado correctamente');
            throw new Error('Tercero no seleccionado - el campo de tercero no se llenó correctamente');
        }
        log(`✅ Tercero verificado: ${terceroValue}`);

        // === 4. ASSEMBLY TYPE ===
        log('=== TIPO ENSAMBLE ===');
        const typeText = assemblyType === 'terminado'
            ? ['en proceso', 'terminado']
            : ['Materia prima', 'en proceso'];

        const tipoOK = await page.evaluate((searchTerms) => {
            const selects = document.querySelectorAll('select');
            for (const select of selects) {
                const options = Array.from(select.options);
                const opt = options.find(o =>
                    searchTerms.every(term => o.text.includes(term))
                );
                if (opt) {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, typeText);

        log(tipoOK ? '✅ Tipo seleccionado' : '⚠️ Tipo no encontrado');
        await page.waitForTimeout(2000);

        // === 5. PRODUCT ===
        log('=== PRODUCTO ===');
        const productInput = page.locator('id=autocomplete_autocompleteInput').nth(2);
        await productInput.click();
        await page.waitForTimeout(500);
        await productInput.pressSequentially(productName, { delay: 100 });
        await page.waitForTimeout(2000);
        await page.keyboard.press('Enter');
        log(`✅ Producto seleccionado: ${productName}`);
        await page.waitForTimeout(2000);

        // === 6. WAREHOUSE (Sin asignar) ===
        log('=== BODEGA ===');
        const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
        await bodegaInput.click();
        await page.waitForTimeout(500);
        await bodegaInput.pressSequentially('Sin asignar', { delay: 100 });
        await page.waitForTimeout(2000);

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        log('✅ Bodega: Sin asignar');
        await page.waitForTimeout(1000);

        // === 7. QUANTITY ===
        log('=== CANTIDAD ===');
        const qtyInput = page.locator('#inputDecimal_siigoInputDecimal').first();
        await qtyInput.click({ clickCount: 3 }); // Select all existing text
        await page.waitForTimeout(300);
        await qtyInput.fill(''); // Clear
        await page.waitForTimeout(300);
        await qtyInput.pressSequentially(String(quantity), { delay: 150 }); // Type char by char
        await page.waitForTimeout(500);
        // Trigger blur/change to force Siigo recalculation of ingredient totals
        await page.keyboard.press('Tab');
        await page.waitForTimeout(3000); // Give Siigo time to recalculate formula totals
        log(`✅ Cantidad: ${quantity}`);

        // === 8. INGREDIENT WAREHOUSES (all "Sin asignar") ===
        log('=== BODEGAS INGREDIENTES ===');
        const configuredCount = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            let count = 0;
            selects.forEach((sel) => {
                const options = Array.from(sel.options);
                const sinAsignarOpt = options.find(o => o.text.includes('Sin asignar'));
                if (sinAsignarOpt && sel.value !== sinAsignarOpt.value) {
                    sel.value = sinAsignarOpt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    count++;
                }
            });
            return count;
        });
        log(`✅ ${configuredCount} bodegas configuradas a "Sin asignar"`);
        await page.waitForTimeout(1000);

        // === 9. CLOSE MODALS/OVERLAYS ===
        const hasModal = await page.locator('.MuiDialog-root').count();
        if (hasModal > 0) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            log('✅ Overlays cerrados');
        }

        // === 10. OBSERVATIONS ===
        log('=== OBSERVACIONES ===');
        const obsText = observations || `Nota de ensamble creada automáticamente - ${new Date().toLocaleString('es-CO')}`;
        try {
            await page.locator('textarea[placeholder="Observaciones"]').fill(obsText);
            log('✅ Observaciones escritas');
        } catch (e) {
            log('⚠️ No se pudo escribir observación');
        }
        await page.waitForTimeout(500);

        // === 11. SAVE ===
        log('=== GUARDAR ===');
        await page.evaluate(() => {
            document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
        });
        await page.waitForTimeout(500);

        const saveBtn = page.locator('button:has-text("Guardar")').first();
        await saveBtn.click({ force: true });
        log('✅ Botón Guardar presionado');

        // Wait for save - Siigo redirects to confirmation page after successful save
        // Wait for URL change or page content change
        const urlBeforeSave = page.url();
        await page.waitForTimeout(5000);

        // Check if page redirected (successful save)
        const urlAfterSave = page.url();
        const pageChanged = urlAfterSave !== urlBeforeSave;

        if (!pageChanged) {
            // Wait more and check again
            await page.waitForTimeout(5000);

            // Check for save errors on the same page
            const saveError = await page.evaluate(() => {
                const errorToast = document.querySelector('.Toastify__toast--error');
                if (errorToast) return errorToast.textContent;

                const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger');
                for (const el of errorElements) {
                    const text = el.textContent.trim();
                    if (text.includes('obligatorio') || text.includes('inválid') || text.includes('requerid')) {
                        return text;
                    }
                }
                return null;
            });

            if (saveError) {
                throw new Error(`Error al guardar en Siigo: ${saveError}`);
            }
        }

        // === 12. CAPTURE NOTE CODE ===
        log('=== CAPTURA DE CÓDIGO ===');
        let siigoNoteCode = null;

        // Wait a bit more for the confirmation page to fully load
        await page.waitForTimeout(3000);

        try {
            // After save, Siigo redirects to confirmation page showing:
            // "Nota de ensamble: NE-1-12220"
            const pageNoteCode = await page.evaluate(() => {
                const allText = document.body.innerText;

                // Primary: Look for "Nota de ensamble: NE-X-XXXXX" pattern on confirmation page
                const neMatch = allText.match(/Nota de ensamble:\s*(NE-\d+-\d+)/i);
                if (neMatch) return neMatch[1];

                // Fallback: Look for "NE-" followed by numbers
                const neMatch2 = allText.match(/(NE-\d+-\d+)/);
                if (neMatch2) return neMatch2[1];

                // Fallback: "Número XXXXX"
                const numMatch = allText.match(/Número\s+(\d{3,})/i);
                if (numMatch) return numMatch[1];

                return null;
            });

            if (pageNoteCode) {
                siigoNoteCode = pageNoteCode;
            }
            log(`📋 Número de nota Siigo: ${siigoNoteCode || 'No capturado'}`);
        } catch (e) {
            log('⚠️ No se pudo capturar número de nota');
        }

        // === 13. CAPTURE ASSEMBLED INGREDIENTS ===
        const assembledIngredients = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr, .ingredient-row, [class*="ingredient"]');
            const ingredients = [];
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, span, div');
                if (cells.length >= 2) {
                    const name = cells[0]?.textContent?.trim();
                    const qty = cells[cells.length - 1]?.textContent?.trim();
                    if (name && name.length > 2 && name.length < 100) {
                        ingredients.push({ name, quantity: qty });
                    }
                }
            });
            return ingredients;
        }).catch(() => []);

        const finalUrl = page.url();
        log(`🔗 URL Final: ${finalUrl}`);

        // Take screenshot
        const screenshotPath = path.join(screenshotDir, `siigo-assembly-${timestamp}.png`);
        try {
            const { mkdirSync } = require('fs');
            mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: screenshotPath, fullPage: true });
            log(`📸 Screenshot: ${screenshotPath}`);
        } catch (e) {
            log('⚠️ No se pudo guardar screenshot');
        }

        await browser.close();

        // If no NE code captured, the save likely failed
        const actualSuccess = !!siigoNoteCode;
        if (!actualSuccess) {
            log('⚠️ No se capturó código NE - la nota probablemente no se guardó');
        }

        log(actualSuccess ? '\n=== ✅ PROCESO FINALIZADO ===' : '\n=== ⚠️ PROCESO FINALIZADO SIN NE ===');

        return {
            success: actualSuccess,
            url: finalUrl,
            siigoNoteCode,
            screenshotPath,
            logs,
            assembledIngredients,
            error: actualSuccess ? null : 'No se capturó código de nota - revisar screenshot',
            message: actualSuccess
                ? `Nota de ensamble ${siigoNoteCode} creada para ${productName} (${quantity} unidades)`
                : `No se pudo confirmar la creación de la nota para ${productName}`
        };

    } catch (error) {
        log(`\n❌ Error: ${error.message}`);

        // Try to capture error screenshot
        const errorScreenshotPath = path.join(screenshotDir, `siigo-error-${timestamp}.png`);
        try {
            const { mkdirSync } = require('fs');
            mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: errorScreenshotPath, fullPage: true });
        } catch (e) { }

        await browser.close();

        return {
            success: false,
            error: error.message,
            screenshotPath: errorScreenshotPath,
            logs
        };
    }
}

module.exports = { createSiigoAssemblyNote };

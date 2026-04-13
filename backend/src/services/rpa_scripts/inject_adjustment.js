// Script to insert executeInventoryAdjustment into siigoBrowserManager.js
const fs = require('fs');
const path = require('path');

const managerPath = path.join(__dirname, 'backend/src/services/siigoBrowserManager.js');
let code = fs.readFileSync(managerPath, 'utf8');

const adjustmentCode = `
    /**
     * Execute inventory adjustment creation on the current page
     */
    async executeInventoryAdjustment({ productName, quantity, accountCode = '71050504' }) {
        const page = this.page;
        const screenshotDir = path.join(__dirname, '..', '..', '..', 'rpa-screenshots'); // Fix path if needed
        const timestamp = Date.now();
        const taskLogs = [];
        const log = (msg) => { this.log(msg); taskLogs.push(msg); };

        log(\`🚀 Creando Ajuste Inventario: \${productName} x \${quantity} (Cuenta: \${accountCode})\`);

        try {
            // Force a hard reload of the adjustment note URL
            log('Forzando recarga de página (Hard Reload) para evitar DOM fantasma...');
            await page.goto(INVENTORY_ADJUSTMENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(5000); // Wait for SPA to render

            // Wait for at least one autocomplete to appear (Tercero)
            await page.waitForSelector('#autocomplete_autocompleteInput', { timeout: 15000 });

            // === TERCERO (Company NIT) ===
            log('=== TERCERO ===');
            const terceroInput = page.locator('id=autocomplete_autocompleteInput').first();
            await terceroInput.focus();
            await terceroInput.click({ timeout: 5000 });
            await page.waitForTimeout(500);
            
            // Siigo UI sometimes pre-fills "POPPING BOBA..." so we clear it first
            await page.keyboard.press('End');
            for(let i=0; i<30; i++) await page.keyboard.press('Backspace');
            await page.waitForTimeout(500);

            await page.keyboard.type('901878434', { delay: 150 });
            await page.waitForTimeout(4000);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);
            
            log('✅ Tercero seleccionado: 901878434');

            // === PRODUCTO ===
            log('=== PRODUCTO ===');
            // Second autocomplete on the page (first inside the grid)
            const productInput = page.locator('id=autocomplete_autocompleteInput').nth(1);
            await productInput.focus();
            await productInput.click({ timeout: 5000 });
            await page.waitForTimeout(500);
            await productInput.fill(''); // Clear
            await page.waitForTimeout(500);
            await productInput.pressSequentially(productName, { delay: 100 });
            await page.waitForTimeout(4000);
            await page.keyboard.press('Enter'); // Primary match
            await page.waitForTimeout(2000);
            log(\`✅ Producto typeado: \${productName}\`);

            // === BODEGA ===
            log('=== BODEGA ===');
            // Third autocomplete
            const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(2);
            await bodegaInput.focus();
            await bodegaInput.click();
            await page.waitForTimeout(500);
            await bodegaInput.pressSequentially('Sin asig', { delay: 100 });
            await page.waitForTimeout(3000);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            log('✅ Bodega: Sin asignar');

            // === AUMENTA / DISMINUYE ===
            log('=== AUMENTA / DISMINUYE ===');
            await page.evaluate(() => {
                const selects = document.querySelectorAll('select');
                for (const select of selects) {
                    if (select.offsetHeight > 0) {
                        for (const opt of select.options) {
                            if (opt.text.toLowerCase().includes('disminuye')) {
                                select.value = opt.value;
                                select.dispatchEvent(new Event('change', { bubbles: true }));
                                return;
                            }
                        }
                    }
                }
            });
            await page.waitForTimeout(1000);
            log('✅ Acción: Disminuye');

            // === CANTIDAD ===
            log('=== CANTIDAD ===');
            const qtyInput = page.locator('#inputDecimal_siigoInputDecimal, input[id*="inputDecimal"]').first();
            await qtyInput.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await qtyInput.click({ clickCount: 3, force: true }).catch(() => {});
            await page.waitForTimeout(300);
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(200);
            await qtyInput.pressSequentially(String(quantity), { delay: 100 });
            await page.waitForTimeout(500);
            await page.keyboard.press('Tab'); // Trigger blur
            await page.waitForTimeout(1000);
            log(\`✅ Cantidad: \${quantity}\`);

            // === CUENTA CONTABLE ===
            log('=== CUENTA CONTABLE ===');
            // Fourth autocomplete is the Account code
            const accountInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
            await accountInput.focus();
            await accountInput.click();
            await page.waitForTimeout(500);
            await accountInput.pressSequentially(accountCode, { delay: 100 });
            await page.waitForTimeout(4000);
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            log(\`✅ Cuenta: \${accountCode}\`);

            // === SAVE ===
            log('=== GUARDAR ===');
            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            await page.waitForTimeout(1000);

            const urlBeforeSave = page.url();
            await page.locator('button:has-text("Guardar")').first().click({ force: true });
            log('✅ Guardar presionado');

            await page.waitForTimeout(6000);
            const urlAfterSave = page.url();

            // CAPTURE AJUSTE CODE
            let siigoNoteCode = null;
            try {
                siigoNoteCode = await page.evaluate(() => {
                    const text = document.body.innerText;
                    // Usually Adjustments are "Ajuste de inventario: AJ-1-XXX" or similar
                    const m1 = text.match(/(AJ-\\d+-\\d+)/i);
                    if (m1) return m1[1];
                    const m2 = text.match(/(Ajuste[-\\s]*\\d+)/i);
                    if (m2) return m2[0];
                    return null;
                });
            } catch (e) {}

            const success = !!siigoNoteCode || (urlAfterSave !== urlBeforeSave);

            if (!success) {
                const errorAlert = await page.evaluate(() => {
                    const el = document.querySelector('.Toastify__toast--error, [class*="error"], [class*="alert"]');
                    return el ? el.textContent : 'No hubo redirección ni código AJ capturado.';
                });
                throw new Error(errorAlert);
            }

            log(\`✅ Ajuste completado: \${siigoNoteCode || 'Éxito (Cambio URL)'}\`);

            return {
                success: true,
                siigoNoteCode,
                logs: taskLogs,
                message: \`Ajuste generado para \${productName}\`
            };

        } catch (error) {
            log(\`❌ Error: \${error.message}\`);
            
            throw {
                message: error.message,
                logs: taskLogs
            };
        }
    }
`;

// Insert it right before "getStatus() {"
code = code.replace(/(\/\*\*[^*]+getStatus \(\) {)/, adjustmentCode + '\n    $1');

fs.writeFileSync(managerPath, code);
console.log('Adjustment logic injected.');
`;


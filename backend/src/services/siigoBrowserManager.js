/**
 * SiigoBrowserManager - Singleton
 * 
 * Maintains a persistent Playwright browser session with Siigo Nube.
 * Keeps the assembly note form ready at all times.
 * Auto-logs-in if session expires.
 * Processes RPA tasks sequentially via FIFO queue.
 */

const { chromium } = require('playwright');
const path = require('path');

// Siigo credentials
const SIIGO_EMAIL = 'Gerencia@poppingbobainternational.com';
const SIIGO_PASSWORD = 'Naranjita2025*';
const ASSEMBLY_NOTE_URL = 'https://siigonube.siigo.com/#/assembly-note/1664';
const INVENTORY_ADJUSTMENT_URL = 'https://siigonube.siigo.com/#/inventories/1107';
const LOGIN_URL = 'https://siigonube.siigo.com/';

class SiigoBrowserManager {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isReady = false;
        this.isProcessing = false;
        this.queue = [];
        this.logs = [];
    }

    log(msg) {
        const timestamp = new Date().toLocaleTimeString('es-CO');
        const formatted = `[${timestamp}] ${msg}`;
        console.log(`🤖 BrowserManager: ${formatted}`);
        this.logs.push(formatted);
        // Keep only last 200 logs
        if (this.logs.length > 200) this.logs = this.logs.slice(-200);
    }

    /**
     * Initialize the browser and navigate to the assembly note form
     */
    async initialize(taskType = 'assembly') {
        try {
            this.log('Inicializando browser...');

            // Ensure any previous browser instance is properly closed
            if (this.browser) {
                try { await this.browser.close(); } catch (e) { /* ignore */ }
                this.browser = null;
                this.context = null;
                this.page = null;
            }

            this.browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
            });

            this.context = await this.browser.newContext({
                viewport: { width: 1920, height: 1080 }
            });

            this.page = await this.context.newPage();

            // Set default timeout
            this.page.setDefaultTimeout(60000);

            await this.login();
            if (taskType === 'assembly') {
                await this.navigateToForm();
                this.log('✅ Browser listo y en formulario de ensamble');
            } else {
                this.log('✅ Browser listo para tarea: ' + taskType);
            }

            this.isReady = true;
        } catch (error) {
            this.log(`❌ Error inicializando: ${error.message}`);
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Login to Siigo Nube
     */
    async login() {
        this.log('=== LOGIN ===');
        await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.waitForTimeout(3000);

        // Check if already logged in (e.g., session still valid)
        const currentUrl = this.page.url();
        if (currentUrl.includes('/#/') && !currentUrl.includes('login')) {
            this.log('✅ Sesión activa, no necesita login');
            return;
        }

        await this.page.fill('#siigoSignInName', SIIGO_EMAIL);
        await this.page.fill('#siigoPassword', SIIGO_PASSWORD);
        await this.page.click('#siigoNext');
        await this.page.waitForTimeout(5000);

        await this.page.click('button:has-text("Ingresar")');
        await this.page.waitForTimeout(5000);
        this.log('✅ Login exitoso');
    }

    /**
     * Navigate to the assembly note form
     */
    async navigateToForm() {
        this.log('Navegando a formulario de ensamble...');
        await this.page.goto(ASSEMBLY_NOTE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.waitForTimeout(5000);
        this.log('✅ En formulario de ensamble');
    }

    /**
     * Check if the session is still valid. If not, re-login.
     * Also ensures we're on the assembly note form.
     */
    async ensureReady() {
        // Check if browser is alive
        if (!this.browser || !this.page) {
            this.log('⚠️ Browser no existe, reinicializando...');
            await this.initialize();
            return;
        }

        // Check if page is still responsive
        try {
            const url = this.page.url();
            this.log(`Verificando sesión... URL: ${url}`);

            // Check if we got redirected to login page (URL-based)
            if (url.includes('login') || url.includes('b2clogin') || url === 'about:blank') {
                this.log('⚠️ Sesión expirada (URL login), re-logueando...');
                await this.login();
                await this.navigateToForm();
                return;
            }

            // Check if login form is present on the page (DOM-based)
            const hasLoginForm = await this.page.evaluate(() => {
                return !!document.getElementById('siigoSignInName') || !!document.getElementById('siigoPassword');
            }).catch(() => false);

            if (hasLoginForm) {
                this.log('⚠️ Sesión expirada (formulario login detectado), re-logueando...');
                // Dismiss any popups/ads first
                await this.page.evaluate(() => {
                    document.querySelectorAll('.modal, .popup, [class*="overlay"], [class*="banner"], [class*="dialog"]').forEach(el => {
                        try { el.remove(); } catch (e) { }
                    });
                    // Try clicking any X/close buttons
                    document.querySelectorAll('button[class*="close"], [aria-label="close"], [aria-label="Close"]').forEach(btn => {
                        try { btn.click(); } catch (e) { }
                    });
                }).catch(() => { });
                await this.page.waitForTimeout(1000);
                await this.login();
                await this.navigateToForm();
                return;
            }

            // Check if we're on the assembly note form
            if (!url.includes('assembly-note')) {
                this.log('⚠️ No estamos en el formulario, navegando...');
                await this.navigateToForm();
                return;
            }

            // Check if Siigo shows a session expired dialog
            const sessionExpired = await this.page.evaluate(() => {
                const dialogs = document.querySelectorAll('.modal, .MuiDialog-root, .swal2-popup');
                for (const d of dialogs) {
                    if (d.textContent.includes('sesión') || d.textContent.includes('expirad') || d.textContent.includes('inactiv')) {
                        return true;
                    }
                }
                return false;
            }).catch(() => false);

            if (sessionExpired) {
                this.log('⚠️ Diálogo de sesión expirada detectado, re-logueando...');
                await this.login();
                await this.navigateToForm();
                return;
            }

            this.log('✅ Sesión activa y lista');
        } catch (error) {
            this.log(`⚠️ Error verificando sesión: ${error.message}, reinicializando...`);
            await this.cleanup();
            await this.initialize();
        }
    }

    /**
     * Clean up browser resources
     */
    async cleanup() {
        try {
            if (this.browser) {
                await this.browser.close().catch(() => { });
            }
        } catch (e) { /* ignore */ }
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isReady = false;
    }

    /**
     * Add a task to the queue and process it
     * @param {Object} task - { params, executionId, resolve, reject }
     */
    enqueue(task) {
        this.queue.push(task);
        this.log(`📋 Tarea encolada (cola: ${this.queue.length}). Producto: ${task.params.productName}`);
        this.processQueue();
    }

    /**
     * Process the queue sequentially
     */
    async processQueue() {
        if (this.isProcessing) return; // Already processing
        if (this.queue.length === 0) return; // Nothing to do

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            this.log(`🔄 Procesando tarea (quedan ${this.queue.length} en cola): ${task.params.productName}`);

            try {
                // Launch a fresh browser for EACH task to prevent OOM
                this.log(`🚀 Lanzando browser efímero (tipo: ${task.type || 'assembly'})...`);
                await this.initialize(task.type || 'assembly');

                // Execute based on task type
                let result;
                if (task.type === 'adjustment') {
                    result = await this.executeInventoryAdjustment(task.params);
                } else {
                    result = await this.executeAssemblyNote(task.params);
                }
                
                task.resolve(result);
            } catch (error) {
                this.log(`❌ Error en tarea: ${error.message || error}`);

                // If browser crashed, try ONE more time with a fresh browser
                if (!task._retried) {
                    this.log('🔄 Reintentando con browser fresco...');
                    task._retried = true;
                    try {
                        await this.cleanup();
                        await this.initialize(task.type || 'assembly');
                        
                        let result;
                        if (task.type === 'adjustment') {
                            result = await this.executeInventoryAdjustment(task.params);
                        } else {
                            result = await this.executeAssemblyNote(task.params);
                        }
                        
                        task.resolve(result);
                        this.log('✅ Reintento exitoso');
                    } catch (retryError) {
                        this.log(`❌ Reintento falló: ${retryError.message || retryError}`);
                        task.reject(retryError);
                    }
                } else {
                    task.reject(error);
                }
            } finally {
                // ALWAYS close browser after each task to free RAM
                this.log('🧹 Cerrando browser para liberar memoria...');
                await this.cleanup();
            }

            // Small pause between tasks
            await new Promise(r => setTimeout(r, 2000));
        }

        this.isProcessing = false;
        this.log('✅ Cola vacía');
    }

    /**
     * Execute assembly note creation on the current page
     * This is the core form-filling logic (extracted from siigoAssemblyBot)
     */
    async executeAssemblyNote({ productName, quantity, assemblyType = 'proceso', observations = '' }) {
        const page = this.page;
        const screenshotDir = path.join(__dirname, '..', 'rpa-screenshots');
        const timestamp = Date.now();
        const taskLogs = [];
        const log = (msg) => { this.log(msg); taskLogs.push(msg); };

        log(`🚀 Creando NE: ${productName} x${quantity}`);

        try {
            // Very important: Siigo's SPA sometimes fails to render inputs on repeated navigation
            // Force a hard reload of the assembly note URL to guarantee fresh DOM state
            log('Forzando recarga de página (Hard Reload) para evitar DOM fantasma...');
            await page.goto(ASSEMBLY_NOTE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(5000); // Wait for SPA to render

            // === TERCERO (Company NIT) ===
            log('=== TERCERO ===');

            // Find the Tercero input field (it's the first autocomplete on the page)
            const terceroInput = page.locator('id=autocomplete_autocompleteInput').first();
            await terceroInput.click({ timeout: 15000 }).catch(() => log('⚠️ Click inicial en Tercero falló, continuando...'));
            await page.waitForTimeout(1000);

            // Check if Tercero is already filled (template pre-fills it sometimes)
            let terceroSelected = false;
            const terceroAlreadyFilled = await terceroInput.inputValue().catch(() => '');

            if (terceroAlreadyFilled && terceroAlreadyFilled.length > 5) {
                log(`✅ Tercero ya pre-llenado: ${terceroAlreadyFilled}`);
                terceroSelected = true;
            } else {
                // Focus and clear via JS, then type with keyboard
                await terceroInput.focus();
                await terceroInput.click();
                await terceroInput.fill(''); // Clear using Playwright fill
                await page.waitForTimeout(500);

                // Type NIT using keyboard (goes to focused element)
                await page.keyboard.type('901878434', { delay: 200 });
                await page.waitForTimeout(4000);

                // Select from dropdown
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);

                // Verify
                const terceroVal = await terceroInput.inputValue().catch(() => '');

                if (!terceroVal || terceroVal.length < 3) {
                    // Fallback: click on dropdown item directly
                    log('⚠️ Tercero no seleccionado, intentando click directo en dropdown');
                    await page.evaluate(() => {
                        const els = document.querySelectorAll('li, tr, div, span, a');
                        for (const el of els) {
                            if (el.textContent.includes('901878434') && el.offsetHeight > 0) {
                                el.click(); return true;
                            }
                        }
                        return false;
                    });
                    await page.waitForTimeout(2000);
                }

                // Method 1: Focus, Clear, Type, Down, Enter
                try {
                    await terceroInput.focus();
                    await terceroInput.click();
                    await terceroInput.fill(''); // Clear using Playwright fill
                    await page.waitForTimeout(500);

                    // Type NIT using keyboard (goes to focused element)
                    await page.keyboard.type('901878434', { delay: 200 });
                    await page.waitForTimeout(4000);

                    // Select from dropdown
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);

                    // Verify
                    const terceroVal = await terceroInput.inputValue().catch(() => '');
                    if (terceroVal && terceroVal.length > 3) {
                        terceroSelected = true;
                        log(`✅ Tercero: ${terceroVal}`);
                    }
                } catch (e) {
                    log(`⚠️ Error en selección normal de tercero: ${e.message}`);
                }
            }

            // Method 2: Fallback to direct click on dropdown item if Method 1 failed
            if (!terceroSelected) {
                log('⚠️ Método 1 falló, intentando click directo en dropdown...');
                const clicked = await page.evaluate(() => {
                    const els = document.querySelectorAll('li, tr, div, span, a');
                    for (const el of els) {
                        if (el.textContent.includes('901878434') && el.offsetHeight > 0) {
                            el.click(); return true;
                        }
                    }
                    return false;
                });
                if (clicked) {
                    await page.waitForTimeout(2000);
                    const terceroVal = await terceroInput.inputValue().catch(() => '');
                    if (terceroVal && terceroVal.length > 3) {
                        terceroSelected = true;
                        log(`✅ Tercero seleccionado (via fallback click): ${terceroVal}`);
                    }
                }
            }

            // --- METHOD 3 (JavaScript direct set + ArrowDown event simulation) ---
            if (!terceroSelected) {
                log('⚠️ Método 2 falló, intentando método 3 (JS + Events)...');
                await page.evaluate(({ nit }) => {
                    const inputs = document.querySelectorAll('#autocomplete_autocompleteInput');
                    const targetInput = inputs[0]; // Assuming Tercero is first
                    if (targetInput) {
                        targetInput.value = nit;
                        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                        targetInput.dispatchEvent(new Event('change', { bubbles: true }));

                        // Try to trigger the dropdown explicitly
                        targetInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                        targetInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
                    }
                }, { nit: '901878434' });
                await page.waitForTimeout(2500);

                // Now try method 1 again or look for dropdown
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(1000);

                const finalValue = await terceroInput.inputValue().catch(() => '');
                if (finalValue && finalValue.length > 3) {
                    terceroSelected = true;
                    log('✅ Tercero seleccionado (JS + Events)');
                }
            }

            if (!terceroSelected) {
                throw new Error('No se pudo seleccionar el Tercero usando ningún método.');
            }

            log(`✅ Tercero verificado: 901878434`);

            // === TIPO ENSAMBLE ===
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

            log(tipoOK ? `✅ Tipo ensamble: ${assemblyType}` : `⚠️ Tipo no encontrado: ${assemblyType}`);
            await page.waitForTimeout(2000);

            // === PRODUCTO ===
            log('=== PRODUCTO ===');
            // The product input is the 3rd autocomplete (index 2)
            const productInput = page.locator('id=autocomplete_autocompleteInput').nth(2);
            let bodySelected = false;

            // Method 1: Click, Type, Down, Enter
            try {
                await productInput.click({ timeout: 5000 });
                await page.waitForTimeout(500);
                await productInput.fill('');
                await page.waitForTimeout(500);
                // Type product slowly to trigger SIIGO's autocomplete
                await productInput.pressSequentially(productName, { delay: 100 });
                await page.waitForTimeout(4000);

                // Press ENTER directly. Siigo pre-selects the first match.
                // ArrowDown skips to the 2nd item (e.g. ETIQUETA).
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);

                const pVal = await productInput.inputValue().catch(() => '');
                if (pVal && pVal.length > 3) {
                    bodySelected = true;
                    log(`✅ Producto: ${pVal}`);
                }
            } catch (e) {
                log(`⚠️ Error en selección normal de producto: ${e.message}`);
            }

            if (!bodySelected) {
                throw new Error(`No se pudo seleccionar el producto ${productName} después de múltiples intentos.`);
            }

            // === BODEGA PRODUCTO (Bodega Output) ===
            // This is the 4th autocomplete (index 3)
            log('=== BODEGA PRODUCTO ===');
            const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
            try {
                const bodegaVal = await bodegaInput.inputValue().catch(() => '');
                if (bodegaVal && bodegaVal.length >= 2) {
                    log(`✅ Bodega ya pre-llenada: ${bodegaVal}`);
                } else {
                    await bodegaInput.focus();
                    await bodegaInput.click();
                    await bodegaInput.fill('');
                    await page.waitForTimeout(500);
                    await page.keyboard.type('Sin asig', { delay: 80 });
                    await page.waitForTimeout(3000);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(1000);
                    const bodegaVal2 = await bodegaInput.inputValue().catch(() => '');
                    log(`✅ Bodega: ${bodegaVal2 || '(set via keyboard)'}`);
                }
            } catch (e) {
                log(`⚠️ Bodega falló: ${e.message}`);
            }

            // Ingredient bodegas are handled by the Siigo template — NOT touched by RPA.
            // === QUANTITY ===
            log('=== CANTIDAD ===');
            // Use JavaScript to directly set the decimal input value
            const qtySet = await page.evaluate((qty) => {
                const inputs = document.querySelectorAll('#inputDecimal_siigoInputDecimal, input[id*="inputDecimal"]');
                for (const inp of inputs) {
                    if (inp.offsetHeight > 0) {
                        // Clear the field
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(inp, String(qty));
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                        inp.dispatchEvent(new Event('blur', { bubbles: true }));
                        return inp.value;
                    }
                }
                return null;
            }, quantity);
            log(`✅ Cantidad: ${quantity} (JS set: ${qtySet})`);
            await page.waitForTimeout(1000);
            // ALWAYS use triple-click + type as primary strategy because 
            // Siigo's masked inputs ignore JS dispatch events for large formatted numbers.
            log('⚠️ Usando triple-click + type para garantizar que Siigo procese los eventos del teclado');
            const qtyInput = page.locator('#inputDecimal_siigoInputDecimal').first();
                await qtyInput.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
                await qtyInput.click({ clickCount: 3, force: true }).catch(() => { });
                await page.waitForTimeout(300);
                await page.keyboard.press('Backspace');
                await page.waitForTimeout(200);
                await qtyInput.fill(String(quantity), { force: true }).catch(async () => {
                   await qtyInput.pressSequentially(String(quantity), { delay: 100 });
                });
                await page.waitForTimeout(500);
                await page.keyboard.press('Tab'); // tab out to trigger blur/change cleanly
                await page.waitForTimeout(500);
                const qtyVal2 = await qtyInput.inputValue().catch(() => '');
                log(`✅ Cantidad (backup estricto): ${qtyVal2}`);
            await page.waitForTimeout(1000);

            // === PRODUCT BODEGA (only the product row, ingredients come from template) ===
            // ALWAYS force "Sin asignar" here because the Siigo template may have
            // overridden the bodega to MAQUILAS after loading ingredients.
            await page.waitForTimeout(3000); // Wait for template to load ingredients
            log('=== BODEGA PRODUCTO (forzar Sin asignar) ===');
            try {
                // Find the exact Bodega input inside the "Entrada de producto" table
                const foundBodega = await page.evaluate(() => {
                    const tables = document.querySelectorAll('table');
                    let targetInput = null;
                    if (tables.length > 0) {
                        const productTable = Array.from(tables).find(t => t.textContent.includes('Entrada de producto') || t.textContent.includes('ensamblar')) || tables[0];
                        const inputs = productTable.querySelectorAll('#autocomplete_autocompleteInput');
                        if (inputs.length >= 2) {
                            targetInput = inputs[1]; // Usually second autocomplete is Bodega
                        } else if (inputs.length === 1) {
                            targetInput = inputs[0]; // If product turned to plain text, only 1 autocomplete left
                        }
                    }
                    
                    if (targetInput && targetInput.offsetHeight > 0) {
                        targetInput.scrollIntoView();
                        targetInput.focus();
                        targetInput.click();
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeSetter.call(targetInput, '');
                        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }
                    return false;
                });
                
                if (foundBodega) {
                    await page.waitForTimeout(500);
                    await page.keyboard.type('Sin asig', { delay: 100 });
                    await page.waitForTimeout(3000);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(1000);
                    log(`✅ Bodega producto: forzada vía JS locator`);
                } else {
                    // Fallback to original `.nth(3)` behavior
                    log(`⚠️ No se encontró la tabla de entrada vía JS, usando fallback nth(3)`);
                    const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
                    await bodegaInput.click({ timeout: 5000, force: true }).catch(() => { });
                    await page.waitForTimeout(500);
                    
                    // Use keyboard backspaces instead of playwright .fill('') to avoid visibility strictness
                    await bodegaInput.focus();
                    await page.keyboard.press('End');
                    for(let i=0; i<25; i++) await page.keyboard.press('Backspace');
                    
                    await page.waitForTimeout(500);
                    await bodegaInput.pressSequentially('Sin asig', { delay: 100 });
                    await page.waitForTimeout(3000);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(1000);
                    const bodegaVal2 = await bodegaInput.inputValue().catch(() => '');
                    log(`✅ Bodega producto: ${bodegaVal2 || '(set via fallback keyboard)'}`);
                }
            } catch (e) {
                log(`⚠️ Bodega producto falló: ${e.message}`);
            }

            // === LOTE DE PRODUCTO (OBLIGATORIO EN ALGUNOS PRODUCTOS) ===
            log('=== LOTE ===');
            try {
                // Buscamos cualquier input que sea de lote y lo forzamos a "AJUSTE" si no hay lote indicado, 
                // o usamos el batchNumber si viniera (en este script no lo recibimos explícitamente, pero podemos extraerlo de obs)
                const loteToSet = (observations && observations.match(/Lote:\s*([^.]+)/i)) ? observations.match(/Lote:\s*([^.]+)/i)[1].trim() : 'AJUSTE';
                
                const foundLote = await page.evaluate((lval) => {
                    const inputs = document.querySelectorAll('input');
                    for (const inp of inputs) {
                        const name = (inp.name || '').toLowerCase();
                        const id = (inp.id || '').toLowerCase();
                        const placeholder = (inp.placeholder || '').toLowerCase();
                        if ((name.includes('lote') || id.includes('lote') || placeholder.includes('lote') || placeholder.includes('lot')) && inp.offsetHeight > 0) {
                            inp.scrollIntoView();
                            inp.focus();
                            inp.value = lval || 'AJUSTE';
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }, loteToSet || 'AJUSTE');

                if (foundLote) {
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Tab');
                    log(`✅ Campo Lote detectado y llenado con: ${loteToSet || 'AJUSTE'}`);
                } else {
                    log('ℹ️ No se detectó campo Lote obligatorio en la tabla principal');
                    // Fallback: tratar de buscar por locator
                    try {
                        const loteInput = page.locator('input[placeholder*="Lote" i], input[id*="lote" i]').first();
                        if (await loteInput.isVisible({ timeout: 1000 })) {
                            await loteInput.fill(loteToSet || 'AJUSTE');
                            await page.waitForTimeout(300);
                            await page.keyboard.press('Tab');
                            log(`✅ Campo Lote llenado por fallback con: ${loteToSet || 'AJUSTE'}`);
                        }
                    } catch(e2) {}
                }
            } catch(e) {
                log(`⚠️ Intento de llenar Lote falló: ${e.message}`);
            }

            // Ingredient bodegas are handled by the Siigo template — NOT touched by RPA.

            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            await page.waitForTimeout(500);

            // === OBSERVATIONS ===
            const obsText = observations || `Proceso automático - ${new Date().toLocaleString('es-CO')}`;
            try {
                await page.locator('textarea[placeholder="Observaciones"]').fill(obsText);
            } catch (e) {
                try { await page.locator('textarea').first().fill(obsText); } catch (e2) { /* ok */ }
            }
            await page.waitForTimeout(500);

            // === FILL EMPTY INGREDIENT BODEGAS before saving ===
            log('=== BODEGAS INGREDIENTES ===');
            try {
                // Find all empty bodega selects AND autocompletes in ingredient rows
                const emptyBodegaSelects = await page.evaluate(() => {
                    const tables = document.querySelectorAll('table');
                    const empties = [];
                    for (const table of tables) {
                        const rows = table.querySelectorAll('tr');
                        for (let r = 0; r < rows.length; r++) {
                            const sel = rows[r].querySelector('select');
                            if (sel && (!sel.value || sel.value === '' || sel.value === 'undefined')) {
                                empties.push({ rowIdx: r, type: 'select' });
                            }
                            const inp = rows[r].querySelector('#autocomplete_autocompleteInput:not([placeholder*="Buscar"]):not([placeholder*="buscar"])');
                            // Exclude inputs that are clearly for searching products (they usually have placeholder="Buscar")
                            if (inp && (!inp.value || inp.value.trim() === '') && !inp.readOnly) {
                                empties.push({ rowIdx: r, type: 'autocomplete' });
                            }
                        }
                    }
                    return empties;
                });

                if (emptyBodegaSelects.length > 0) {
                    log(`🔧 ${emptyBodegaSelects.length} bodegas ingrediente vacías — llenando`);

                    // Try JS first: set value to "Sin asignar" option
                    const filledJS = await page.evaluate(() => {
                        const tables = document.querySelectorAll('table');
                        let filled = 0;
                        for (const table of tables) {
                            const rows = table.querySelectorAll('tr');
                            for (const row of rows) {
                                const selects = row.querySelectorAll('select');
                                for (const sel of selects) {
                                    if (!sel.value || sel.value === '' || sel.value === 'undefined') {
                                        // Try to find "Sin asignar" or first non-empty option
                                        for (const opt of sel.options) {
                                            if (opt.text.toLowerCase().includes('sin asig')) {
                                                sel.value = opt.value;
                                                sel.dispatchEvent(new Event('change', { bubbles: true }));
                                                sel.dispatchEvent(new Event('input', { bubbles: true }));
                                                filled++;
                                                break;
                                            }
                                        }
                                        // If no "Sin asignar" found, try the first option with value
                                        if (!sel.value || sel.value === '') {
                                            for (const opt of sel.options) {
                                                if (opt.value && opt.value !== '') {
                                                    sel.value = opt.value;
                                                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                                                    sel.dispatchEvent(new Event('input', { bubbles: true }));
                                                    filled++;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        return filled;
                    });

                    // Also try to fill empty autocompletes with JS/keyboard sequence (Pre-fill phase)
                    const autocompleteEmpties = emptyBodegaSelects.filter(e => e.type === 'autocomplete');
                    for (const ae of autocompleteEmpties) {
                        try {
                            const autocompletes = page.locator('#autocomplete_autocompleteInput');
                            const allInputs = await autocompletes.count();
                            // We don't know the exact flat index, so we evaluate to find the one matching the row
                            const flatIdx = await page.evaluate((rowIdx) => {
                                const tables = document.querySelectorAll('table');
                                let absIdx = -1;
                                let matchIdx = -1;
                                const inputs = document.querySelectorAll('#autocomplete_autocompleteInput');
                                for (let i = 0; i < inputs.length; i++) {
                                    const inRow = inputs[i].closest('tr');
                                    if (inRow) {
                                        // find row index in parent node
                                        const tRows = Array.from(inRow.parentNode.children);
                                        if (tRows.indexOf(inRow) === rowIdx) return i;
                                    }
                                }
                                return -1;
                            }, ae.rowIdx);

                            if (flatIdx >= 0) {
                                log(`  → Pre-llenando bodega autocomplete idx=${flatIdx}`);
                                await page.evaluate((i) => {
                                    const inputs = document.querySelectorAll('#autocomplete_autocompleteInput');
                                    const inp = inputs[i];
                                    if (inp) {
                                        inp.scrollIntoView();
                                        inp.focus();
                                        inp.click();
                                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                        nativeSetter.call(inp, '');
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                    }
                                }, flatIdx);
                                await page.waitForTimeout(400);
                                await page.keyboard.type('Sin asig', { delay: 80 });
                                await page.waitForTimeout(1500);
                                await page.keyboard.press('ArrowDown');
                                await page.waitForTimeout(200);
                                await page.keyboard.press('Enter');
                                await page.waitForTimeout(400);
                                filledJS++;
                            }
                        } catch (e) {
                            log(`  ⚠️ Pre-llenado autocomplete falló (row ${ae.rowIdx}): ${e.message.slice(0, 50)}`);
                        }
                    }

                    if (filledJS > 0) {
                        log(`✅ ${filledJS} bodegas ingrediente llenadas via JS`);
                    } else {
                        // Fallback: click each empty select and use keyboard
                        log('⚠️ JS no llenó selects, usando click + keyboard');
                        const allSelects = page.locator('table select');
                        const selectCount = await allSelects.count();
                        for (let i = 0; i < selectCount; i++) {
                            const sel = allSelects.nth(i);
                            const val = await sel.evaluate(el => el.value).catch(() => '');
                            if (!val || val === '') {
                                try {
                                    await sel.click({ timeout: 3000 });
                                    await page.waitForTimeout(500);
                                    // Select "Sin asignar" (usually first or second option)
                                    await sel.selectOption({ label: 'Sin asignar' }).catch(async () => {
                                        // Try keyboard navigation
                                        await page.keyboard.press('ArrowDown');
                                        await page.waitForTimeout(200);
                                        await page.keyboard.press('Enter');
                                    });
                                    await page.waitForTimeout(300);
                                    log(`  ✅ Select #${i} bodega llenada`);
                                } catch (e) {
                                    log(`  ⚠️ Select #${i} falló: ${e.message.slice(0, 50)}`);
                                }
                            }
                        }
                    }
                    await page.waitForTimeout(1000);
                } else {
                    log('✅ Todas las bodegas ingrediente tienen valor');
                }
            } catch (e) {
                log(`⚠️ Bodega ingredientes check: ${e.message.slice(0, 80)}`);
            }

            // === SAVE ===
            log('=== GUARDAR ===');
            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            await page.waitForTimeout(500);

            const urlBeforeSave = page.url();
            await page.locator('button:has-text("Guardar")').first().click({ force: true });
            log('✅ Guardar presionado');

            // Wait for redirect (successful save redirects to confirmation page)
            await page.waitForTimeout(5000);
            const urlAfterSave = page.url();

            if (urlAfterSave === urlBeforeSave) {
                // Didn't redirect — might still be saving, wait more
                await page.waitForTimeout(5000);

                // Check for errors — broad keyword matching to catch Siigo validation messages
                const saveError = await page.evaluate(() => {
                    const toast = document.querySelector('.Toastify__toast--error');
                    if (toast) return toast.textContent;
                    // Also check for the red validation banner at top-right
                    const alerts = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger, .alert-danger, [class*="alert"], [class*="toast"]');
                    const errorKeywords = ['obligatorio', 'inválid', 'existir', 'debe', 'requerido', 'falta', 'error', 'no se puede'];
                    for (const el of alerts) {
                        const t = el.textContent.trim().toLowerCase();
                        if (t && errorKeywords.some(kw => t.includes(kw))) return el.textContent.trim();
                    }
                    return null;
                });

                if (saveError) {
                    log(`⚠️ Error detectado: ${saveError}`);

                    // === BODEGA RECOVERY: fill empty bodegas with "Sin asignar" ===
                    log('=== BODEGA RECOVERY ===');
                    const emptyBodegaCount = await page.evaluate(() => {
                        // Find all bodega select/dropdowns and autocompletes in the ingredient rows
                        const rows = document.querySelectorAll('tr');
                        let emptyCount = 0;
                        for (const row of rows) {
                            const bodegaSelect = row.querySelector('select');
                            if (bodegaSelect && (!bodegaSelect.value || bodegaSelect.value === '')) {
                                emptyCount++;
                            }
                            const bodegaAuto = row.querySelector('#autocomplete_autocompleteInput');
                            if (bodegaAuto && (!bodegaAuto.value || bodegaAuto.value.trim() === '') && !bodegaAuto.readOnly) {
                                emptyCount++;
                            }
                        }
                        return emptyCount;
                    });

                    if (emptyBodegaCount > 0) {
                        log(`🔧 Encontradas ${emptyBodegaCount} bodegas vacías — llenando con "Sin asignar"`);

                        // Find all empty bodega selects and set them to "Sin asignar"
                        const filled = await page.evaluate(() => {
                            const rows = document.querySelectorAll('tr');
                            let filledCount = 0;
                            for (const row of rows) {
                                const bodegaSelect = row.querySelector('select');
                                if (bodegaSelect && (!bodegaSelect.value || bodegaSelect.value === '')) {
                                    // Find "Sin asignar" option
                                    for (const opt of bodegaSelect.options) {
                                        if (opt.text.toLowerCase().includes('sin asig')) {
                                            bodegaSelect.value = opt.value;
                                            bodegaSelect.dispatchEvent(new Event('change', { bubbles: true }));
                                            filledCount++;
                                            break;
                                        }
                                    }
                                }
                            }
                            return filledCount;
                        });
                        log(`✅ SELECT bodegas llenadas: ${filled}`);

                        // Now also try with autocomplete inputs regardless of select success
                        log('🔍 Buscando autocomplete bodegas vacíos en tabla');
                        const emptyAutocompletes = await page.evaluate(() => {
                            const inputs = document.querySelectorAll('#autocomplete_autocompleteInput');
                            const empties = [];
                            for (let i = 0; i < inputs.length; i++) {
                                const inp = inputs[i];
                                // Skip product search inputs which trigger the "Crear producto" modal
                                const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
                                if (placeholder.includes('buscar')) continue;
                                
                                // Only bodega inputs inside table rows
                                const inRow = inp.closest('tr') || inp.closest('.tabla-body');
                                if (inRow && (!inp.value || inp.value.trim() === '') && !inp.readOnly) {
                                    empties.push(i);
                                }
                            }
                            return empties;
                        });

                        for (const idx of emptyAutocompletes) {
                            log(`  → Llenando bodega autocomplete idx=${idx}`);
                            const input = page.locator('id=autocomplete_autocompleteInput').nth(idx);
                            try {
                                await page.evaluate((i) => {
                                    const inputs = document.querySelectorAll('#autocomplete_autocompleteInput');
                                    const inp = inputs[i];
                                    if (inp) {
                                        inp.scrollIntoView();
                                        inp.focus();
                                        inp.click();
                                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                        nativeSetter.call(inp, '');
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                    }
                                }, idx);
                                await page.waitForTimeout(500);
                                await page.keyboard.type('Sin asig', { delay: 80 });
                                await page.waitForTimeout(2000);
                                await page.keyboard.press('ArrowDown');
                                await page.waitForTimeout(300);
                                await page.keyboard.press('Enter');
                                await page.waitForTimeout(500);
                            } catch (e) {
                                log(`  ⚠️ Bodega idx=${idx} falló: ${e.message.slice(0, 60)}`);
                            }
                        }
                        if (emptyAutocompletes.length > 0) log(`✅ ${emptyAutocompletes.length} bodegas autocomplete llenadas`);

                        await page.waitForTimeout(1000);

                        // Close error toasts
                        await page.evaluate(() => {
                            document.querySelectorAll('.Toastify__toast, [class*="toast"]').forEach(el => {
                                try { el.remove(); } catch (e) { }
                            });
                        });
                        await page.waitForTimeout(500);

                        // Retry save
                        log('=== RETRY GUARDAR ===');
                        await page.locator('button:has-text("Guardar")').first().click({ force: true });
                        log('✅ Guardar re-intentado');

                        // Wait for result
                        await page.waitForTimeout(8000);
                        const urlAfterRetry = page.url();
                        if (urlAfterRetry === urlBeforeSave) {
                            const retryError = await page.evaluate(() => {
                                const toast = document.querySelector('.Toastify__toast--error');
                                if (toast) return toast.textContent;
                                const errs = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger, .alert-danger, [class*="alert"], [class*="toast"]');
                                const errorKeywords = ['obligatorio', 'inválid', 'existir', 'debe', 'requerido', 'falta', 'error', 'no se puede'];
                                for (const el of errs) {
                                    const t = el.textContent.trim().toLowerCase();
                                    if (t && errorKeywords.some(kw => t.includes(kw))) return el.textContent.trim();
                                }
                                return null;
                            });
                            if (retryError) throw new Error(`Error Siigo (después de bodega recovery): ${retryError}`);
                        }
                    } else {
                        // No empty bodegas — capture ALL validation details
                        const validationDetails = await page.evaluate(() => {
                            const details = [];
                            // Angular validation messages
                            const msgs = document.querySelectorAll('[class*="error"], [class*="invalid"], .text-danger, .help-block, [class*="obligator"]');
                            for (const m of msgs) {
                                const t = m.textContent.trim();
                                if (t && t.length > 2 && t.length < 200) details.push(t);
                            }
                            // Empty required fields
                            const required = document.querySelectorAll('[required], .ng-invalid');
                            for (const r of required) {
                                if (r.tagName === 'INPUT' && (!r.value || r.value === '')) {
                                    details.push(`Empty: ${r.id || r.name || r.placeholder || 'input'}`);
                                }
                                if (r.tagName === 'SELECT' && (!r.value || r.value === '')) {
                                    details.push(`Empty select: ${r.id || r.name || 'select'}`);
                                }
                            }
                            return details.slice(0, 10);
                        });
                        log(`📋 Validation details: ${JSON.stringify(validationDetails)}`);
                        throw new Error(`Error Siigo: ${saveError} | Detalles: ${validationDetails.join('; ')}`);
                    }
                }
            }

            // === CAPTURE NE CODE ===
            await page.waitForTimeout(3000);
            const urlFinal = page.url();
            const urlChanged = urlFinal !== urlBeforeSave;
            let siigoNoteCode = null;

            try {
                siigoNoteCode = await page.evaluate(() => {
                    const text = document.body.innerText;
                    // Only accept full NE-X-XXXXX format (confirmation page)
                    const m1 = text.match(/Nota de ensamble:\s*(NE-\d+-\d+)/i);
                    if (m1) return m1[1];
                    const m2 = text.match(/(NE-\d+-\d+)/);
                    if (m2) return m2[1];
                    // DO NOT use "Número XXXXX" — that's the form's auto-number, not proof of save
                    return null;
                });
                log(`📋 Nota: ${siigoNoteCode || 'No capturado'}`);
            } catch (e) {
                log('⚠️ No se pudo capturar NE');
            }

            // If we didn't get an NE code AND the URL didn't change, check for errors one more time
            if (!siigoNoteCode && !urlChanged) {
                const finalError = await page.evaluate(() => {
                    const allText = document.body.innerText.toLowerCase();
                    const errorKeywords = ['debe existir', 'obligatorio', 'error', 'no se puede', 'inválid', 'requerido', 'falta'];
                    for (const kw of errorKeywords) {
                        if (allText.includes(kw)) {
                            // Find the element containing this error
                            const alerts = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger, .alert-danger, [class*="alert"], [class*="toast"]');
                            for (const el of alerts) {
                                if (el.textContent.toLowerCase().includes(kw)) return el.textContent.trim();
                            }
                            return `Error detectado: contiene "${kw}"`;
                        }
                    }
                    return null;
                });
                if (finalError) {
                    log(`❌ Error final detectado: ${finalError}`);
                    throw new Error(`Error Siigo: ${finalError}`);
                }
            }

            // Screenshot
            const screenshotPath = path.join(screenshotDir, `siigo-assembly-${timestamp}.png`);
            try {
                require('fs').mkdirSync(screenshotDir, { recursive: true });
                await page.screenshot({ path: screenshotPath, fullPage: true });
            } catch (e) { /* ok */ }

            // Success = URL changed (redirect to confirmation) OR we captured a real NE code
            const success = !!siigoNoteCode || urlChanged;
            log(success ? `✅ NE CREADA: ${siigoNoteCode || '(URL changed)'}` : '⚠️ No se confirmó creación de NE');

            return {
                success,
                siigoNoteCode,
                url: page.url(),
                screenshotPath,
                logs: taskLogs,
                error: success ? null : 'No se capturó código NE - revisar screenshot',
                message: success
                    ? `Nota ${siigoNoteCode} creada para ${productName} (${quantity} uds)`
                    : `No se confirmó nota para ${productName}`
            };

        } catch (error) {
            log(`❌ Error: ${error.message}`);

            // Error screenshot
            const errPath = path.join(screenshotDir, `siigo-error-${timestamp}.png`);
            try {
                require('fs').mkdirSync(screenshotDir, { recursive: true });
                await page.screenshot({ path: errPath, fullPage: true });
            } catch (e) { /* ok */ }

            throw {
                message: error.message,
                screenshotPath: errPath,
                logs: taskLogs
            };
        }
    }

    /**
     * Execute inventory adjustment creation on the current page
     */
    async executeInventoryAdjustment({ productName, quantity, accountCode }) {
        const page = this.page;
        const screenshotDir = path.join(__dirname, '..', 'rpa-screenshots');
        const timestamp = Date.now();
        const taskLogs = [];
        const log = (msg) => { this.log(msg); taskLogs.push(msg); };

        log(`🚀 Creando Ajuste Inventario: ${productName} x${quantity} (Cuenta: ${accountCode})`);

        try {
            log('Navegando a Comprobante de Inventario...');
            await page.goto(INVENTORY_ADJUSTMENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(6000);
            // Verify we reached the adjustment form (not home page)
            const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
            if (pageText.includes('Qué deseas hacer') || pageText.includes('Accesos directos')) {
                log('⚠️ Redirigido a Inicio, reintentando navegación...');
                await page.goto(INVENTORY_ADJUSTMENT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(6000);
            }
            log('📍 URL actual: ' + page.url());

            // === TERCERO (NIT de la empresa) ===
            log('=== TERCERO ===');
            let terceroFilled = false;

            // Strategy 1: autocomplete input
            try {
                const terceroInput = page.locator('#autocomplete_autocompleteInput').first();
                await terceroInput.waitFor({ state: 'visible', timeout: 8000 });
                await terceroInput.click();
                await page.waitForTimeout(500);
                await terceroInput.pressSequentially('901878434', { delay: 100 });
                await page.waitForTimeout(4000);
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);
                const val = await terceroInput.inputValue().catch(() => '');
                if (val && val.length > 5) {
                    terceroFilled = true;
                    log('✅ Tercero seleccionado (autocomplete): ' + val);
                }
            } catch (e) {
                log('⚠️ Tercero autocomplete falló: ' + e.message.substring(0, 80));
            }

            // Strategy 2: search input with placeholder "Buscar"
            if (!terceroFilled) {
                try {
                    const searchInputs = page.locator('input[placeholder="Buscar"], input[placeholder="buscar"]');
                    const si = searchInputs.first();
                    await si.waitFor({ state: 'visible', timeout: 5000 });
                    await si.click();
                    await page.waitForTimeout(500);
                    await si.fill('');
                    await si.pressSequentially('901878434', { delay: 100 });
                    await page.waitForTimeout(4000);
                    await page.keyboard.press('ArrowDown');
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);
                    const val = await si.inputValue().catch(() => '');
                    if (val && val.length > 5) {
                        terceroFilled = true;
                        log('✅ Tercero seleccionado (search input): ' + val);
                    }
                } catch(e) {
                    log('⚠️ Tercero search input falló: ' + e.message.substring(0, 80));
                }
            }

            // Strategy 3: click on visible dropdown item containing NIT
            if (!terceroFilled) {
                try {
                    const clicked = await page.evaluate(() => {
                        const els = document.querySelectorAll('li, tr, div, span, a');
                        for (const el of els) {
                            if (el.textContent.includes('901878434') && el.offsetHeight > 0) {
                                el.click(); return true;
                            }
                        }
                        return false;
                    });
                    if (clicked) {
                        await page.waitForTimeout(2000);
                        terceroFilled = true;
                        log('✅ Tercero seleccionado (click directo)');
                    }
                } catch(e) {}
            }

            if (!terceroFilled) {
                log('❌ No se pudo llenar Tercero — el formulario no funcionará correctamente');
            }

            // Cerrar cualquier diálogo residual
            await page.evaluate(() => {
                document.querySelectorAll('.MuiDialog-root, .MuiModal-root, .MuiBackdrop-root').forEach(el => el.remove());
            });
            await page.waitForTimeout(1000);

            // === DIRECT ELEMENT SELECTION ===
            // Selección directa por índice/posición — NO depende de Tab order

            // 1. PRODUCTO — buscar primer autocomplete vacío visible
            log('=== PRODUCTO ===');
            const autocompletes = page.locator('#autocomplete_autocompleteInput');
            const count = await autocompletes.count();
            let productFilled = false;

            for (let i = 0; i < count; i++) {
                const ac = autocompletes.nth(i);
                try {
                    const isVisible = await ac.isVisible();
                    if (!isVisible) continue;
                    const val = await ac.inputValue();
                    if (!val || val === '') {
                        await ac.click({ timeout: 2000 });
                        await ac.pressSequentially(productName, { delay: 100 });
                        await page.waitForTimeout(3000);
                        await page.keyboard.press('ArrowDown');
                        await page.waitForTimeout(500);
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(2000);
                        const newVal = await ac.inputValue();
                        if (newVal && newVal.length > 3) {
                            log(`✅ Producto llenado en autocomplete #${i}: ${newVal}`);
                            productFilled = true;
                            break;
                        }
                    }
                } catch(e) {}
            }
            if (!productFilled) log('⚠️ No se pudo llenar el producto');

            // 2. BODEGA — buscar siguiente autocomplete vacío (después de Producto)
            log('=== BODEGA ===');
            let bodegaFilled = false;
            const bodegaACs = page.locator('#autocomplete_autocompleteInput');
            const bodegaCount = await bodegaACs.count();
            for (let i = 0; i < bodegaCount; i++) {
                const ac = bodegaACs.nth(i);
                try {
                    const isVis = await ac.isVisible();
                    if (!isVis) continue;
                    const val = await ac.inputValue();
                    if (!val || val === '') {
                        await ac.click({ timeout: 2000 });
                        await ac.fill('');
                        await page.waitForTimeout(300);
                        await page.keyboard.type('Sin asig', { delay: 100 });
                        await page.waitForTimeout(3000);
                        await page.keyboard.press('ArrowDown');
                        await page.waitForTimeout(500);
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(1500);
                        const newVal = await ac.inputValue();
                        if (newVal && newVal.length > 2) {
                            log(`✅ Bodega llenada en autocomplete #${i}: ${newVal}`);
                            bodegaFilled = true;
                            break;
                        }
                    }
                } catch(e) {}
            }
            if (!bodegaFilled) log('⚠️ Bodega no llenada');

            // 3. AUMENTA / DISMINUYE — evaluate sobre SELECTs visibles
            log('=== AUMENTA / DISMINUYE ===');
            const isNegative = Number(quantity) < 0;
            const selectOption = isNegative ? 'Disminuye' : 'Aumenta';
            await page.evaluate((opt) => {
                const selects = document.querySelectorAll('select');
                for (const s of selects) {
                    if (s.offsetHeight > 0) {
                        for (const o of s.options) {
                            if (o.text.toLowerCase().includes(opt.toLowerCase())) {
                                s.value = o.value;
                                s.dispatchEvent(new Event('change', { bubbles: true }));
                                return;
                            }
                        }
                    }
                }
            }, selectOption);
            await page.waitForTimeout(500);
            log(`✅ ${selectOption} seleccionado`);

            // 4. CANTIDAD — posicionamiento por column header
            log('=== CANTIDAD ===');
            const absQuantity = Math.abs(Number(quantity));

            // Strategy A: encontrar header "Cantidad", ubicar input por coordenada X
            const qtyEvalResult = await page.evaluate((qty) => {
                const headers = document.querySelectorAll('th, [class*="header"], [class*="Header"]');
                let cantidadX = null;
                for (const th of headers) {
                    if (th.textContent.trim() === 'Cantidad' && th.offsetHeight > 0) {
                        const rect = th.getBoundingClientRect();
                        cantidadX = rect.left + rect.width / 2;
                        break;
                    }
                }

                const inputs = document.querySelectorAll('#inputDecimal_siigoInputDecimal, input[id*="inputDecimal"]');
                let targetInput = null;
                let minDist = Infinity;

                for (const inp of inputs) {
                    if (inp.offsetHeight === 0) continue;
                    const rect = inp.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;

                    if (cantidadX !== null) {
                        const dist = Math.abs(centerX - cantidadX);
                        if (dist < minDist) {
                            minDist = dist;
                            targetInput = inp;
                        }
                    } else {
                        if (!targetInput || rect.left < targetInput.getBoundingClientRect().left) {
                            targetInput = inp;
                        }
                    }
                }

                if (!targetInput) return { ok: false, reason: 'no input found' };

                targetInput.focus();
                targetInput.click();
                targetInput.select();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(targetInput, String(qty));
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                targetInput.dispatchEvent(new Event('blur', { bubbles: true }));

                return { ok: true, value: targetInput.value, headerX: cantidadX, inputX: targetInput.getBoundingClientRect().left };
            }, absQuantity);
            log(`Cantidad evaluate result: ${JSON.stringify(qtyEvalResult)}`);

            // Strategy B: triple-click + type en el input más a la izquierda (backup)
            const qtyInputs = page.locator('#inputDecimal_siigoInputDecimal');
            const qtyCount = await qtyInputs.count();
            let qtyTarget = null;
            let minX = Infinity;
            for (let i = 0; i < qtyCount; i++) {
                const inp = qtyInputs.nth(i);
                try {
                    if (!(await inp.isVisible())) continue;
                    const box = await inp.boundingBox();
                    if (box && box.x < minX) {
                        minX = box.x;
                        qtyTarget = inp;
                    }
                } catch(e) {}
            }
            if (qtyTarget) {
                await qtyTarget.click({ clickCount: 3, force: true });
                await page.waitForTimeout(300);
                await page.keyboard.press('Backspace');
                await page.waitForTimeout(200);
                await qtyTarget.pressSequentially(String(absQuantity), { delay: 100 });
                await page.waitForTimeout(500);
                await page.keyboard.press('Tab');
                await page.waitForTimeout(1000);
                const finalVal = await qtyTarget.inputValue().catch(() => '');
                log(`✅ Cantidad (triple-click leftmost): ${finalVal}`);
            } else {
                log('⚠️ No se encontró input de Cantidad');
            }
            // Costo promedio y Costo total se auto-llenan — NO tocar

            // === CUENTA CONTABLE ===
            log('=== CUENTA CONTABLE ===');
            try {
                const code = accountCode || '71050504';
                let cuentaFilled = false;

                // Strategy 1: Click the search icon / "Buscar" input in the Cuenta contable column
                const searchInputs = page.locator('input[placeholder="Buscar"], input[placeholder="buscar"]');
                const searchCount = await searchInputs.count();
                for (let i = 0; i < searchCount; i++) {
                    const si = searchInputs.nth(i);
                    try {
                        if (await si.isVisible({ timeout: 1000 })) {
                            await si.click();
                            await page.waitForTimeout(500);
                            await si.fill('');
                            await si.pressSequentially(code, { delay: 100 });
                            await page.waitForTimeout(3000);
                            await page.keyboard.press('ArrowDown');
                            await page.waitForTimeout(500);
                            await page.keyboard.press('Enter');
                            await page.waitForTimeout(1500);
                            log(`✅ Cuenta contable llenada via search input #${i}: ${code}`);
                            cuentaFilled = true;
                            break;
                        }
                    } catch (e) {}
                }

                // Strategy 2: Look for empty autocomplete inputs (last ones)
                if (!cuentaFilled) {
                    const allAutos = page.locator('#autocomplete_autocompleteInput');
                    const autoCount = await allAutos.count();
                    for (let i = autoCount - 1; i >= 0; i--) {
                        const ac = allAutos.nth(i);
                        try {
                            if (await ac.isVisible() && (await ac.inputValue()) === '') {
                                await ac.click();
                                await ac.pressSequentially(code, { delay: 100 });
                                await page.waitForTimeout(3000);
                                await page.keyboard.press('ArrowDown');
                                await page.waitForTimeout(500);
                                await page.keyboard.press('Enter');
                                await page.waitForTimeout(1000);
                                const val = await ac.inputValue();
                                if (val && val.length > 3) {
                                    log(`✅ Cuenta contable llenada via autocomplete #${i}: ${val}`);
                                    cuentaFilled = true;
                                    break;
                                }
                            }
                        } catch (e) {}
                    }
                }

                // Strategy 3: Click directly on the "La cuenta contable es obligatoria" error text
                if (!cuentaFilled) {
                    try {
                        const errText = page.locator('text=La cuenta contable es obligatoria').first();
                        await errText.click({ timeout: 2000 });
                        await page.waitForTimeout(500);
                        const focusedInput = page.locator('input:focus').first();
                        await focusedInput.pressSequentially(code, { delay: 100 });
                        await page.waitForTimeout(3000);
                        await page.keyboard.press('ArrowDown');
                        await page.waitForTimeout(500);
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(1000);
                        log(`✅ Cuenta contable llenada via click en error`);
                        cuentaFilled = true;
                    } catch(e) {}
                }

                if (!cuentaFilled) {
                    log('⚠️ No se pudo llenar cuenta contable');
                }
            } catch (e) {
                log('⚠️ Error cuenta contable: ' + e.message);
            }

            // === LOTE DE PRODUCTO ===
            log('=== LOTE ===');
            try {
                const foundLote = await page.evaluate(() => {
                    const inputs = document.querySelectorAll('input');
                    for (const inp of inputs) {
                        const name = (inp.name || '').toLowerCase();
                        const id = (inp.id || '').toLowerCase();
                        const placeholder = (inp.placeholder || '').toLowerCase();
                        if ((name.includes('lote') || id.includes('lote') || placeholder.includes('lote') || placeholder.includes('lot')) && inp.offsetHeight > 0) {
                            inp.scrollIntoView();
                            inp.focus();
                            inp.value = 'AJUSTE';
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                });
                if (foundLote) {
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Tab');
                    log(`✅ Campo Lote detectado y llenado con: AJUSTE`);
                } else {
                    const loteInput = page.locator('input[placeholder*="Lote" i], input[id*="lote" i]').first();
                    if (await loteInput.isVisible({ timeout: 1000 })) {
                        await loteInput.fill('AJUSTE');
                        await page.waitForTimeout(300);
                        await page.keyboard.press('Tab');
                        log(`✅ Campo Lote llenado por fallback con: AJUSTE`);
                    }
                }
            } catch(e) {
                log(`⚠️ No se detectó o llenó campo Lote: ${e.message}`);
            }

            // 4. OBSERVACIONES Y CUENTA
            const obsText = `Ajuste automático RPA. Producto: ${productName} | Cuenta: ${accountCode} - ${new Date().toLocaleString()}`;
            try { await page.locator('textarea[placeholder*="bservacion"]').fill(obsText); } catch (e) {
                try { await page.locator('textarea').first().fill(obsText); } catch(e2) {}
            }

            // SCREENSHOT PRE-SAVE
            const preSavePath = path.join(screenshotDir, `siigo-adj-pre-save-${timestamp}.png`);
            try { await page.screenshot({ path: preSavePath, fullPage: true }); } catch(e) {}
            log('📸 Screenshot pre-save guardado');

            // GUARDAR
            log('=== GUARDAR ===');
            const urlBeforeSave = page.url();
            await page.locator('button:has-text("Guardar")').first().click({ force: true }).catch(() => {});
            
            // Wait for redirect
            await page.waitForTimeout(6000);
            const urlChanged = page.url() !== urlBeforeSave;
            let finalNote = null;

            if (urlChanged) {
                finalNote = await page.evaluate(() => {
                    const text = document.body.innerText;
                    // Try: "A-396", "AJ-123", "IE-123-456", "NE-123-456", "No. 396"
                    const m1 = text.match(/(?:Ajuste de inventario|Comprobante)[:\s]*([A-Z]+-\d+(?:-\d+)?)/i);
                    if (m1) return m1[1];
                    const m2 = text.match(/No\.\s*(\d+)/);
                    if (m2) return 'A-' + m2[1];
                    const m3 = text.match(/(A-\d+|AJ-\d+|IE-\d+|CE-\d+|NE-\d+)/i);
                    if (m3) return m3[1];
                    return null;
                });
                log('📄 Documento Siigo: ' + (finalNote || 'no detectado'));
            }

            const screenshotPath = path.join(screenshotDir, `siigo-adjustment-${timestamp}.png`);
            try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch (e) {}

            return {
                success: urlChanged,
                siigoNoteCode: finalNote,
                url: page.url(),
                screenshotPath,
                logs: taskLogs,
                error: urlChanged ? null : 'No se pudo verificar el guardado (URL no cambió)'
            };

        } catch (error) {
            log(`❌ Error: ${error.message}`);
            const errPath = path.join(screenshotDir, `siigo-adj-error-${timestamp}.png`);
            try { await page.screenshot({ path: errPath, fullPage: true }); } catch(e) {}
            throw { message: error.message, screenshotPath: errPath, logs: taskLogs };
        }
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            browserAlive: !!this.browser,
            isReady: this.isReady,
            isProcessing: this.isProcessing,
            queueLength: this.queue.length,
            recentLogs: this.logs.slice(-20)
        };
    }

    /**
     * Auto-retry scheduler: every 5 min, re-enqueue FAILED executions (max 3 auto-retries).
     */
    startAutoRetryScheduler() {
        const MAX_AUTO_RETRIES = 3;
        const INTERVAL_MS = 5 * 60 * 1000;
        const LOOKBACK_MS = 30 * 60 * 1000;

        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();

        this._autoRetryInterval = setInterval(async () => {
            try {
                if (this.isProcessing || this.queue.length > 0) {
                    this.log('🔁 Auto-retry: cola ocupada, esperando siguiente ciclo');
                    return;
                }

                const cutoff = new Date(Date.now() - LOOKBACK_MS);
                const failed = await prisma.rpaExecution.findMany({
                    where: {
                        status: 'FAILED',
                        autoRetryCount: { lt: MAX_AUTO_RETRIES },
                        completedAt: { gte: cutoff },
                    },
                    orderBy: { completedAt: 'asc' },
                });

                if (failed.length === 0) return;

                const seen = new Set();
                const toRetry = [];

                for (const exec of failed) {
                    // Dedup by product name — never retry two RPAs for the same product
                    if (seen.has(exec.productName)) continue;
                    seen.add(exec.productName);

                    // Skip if ANY RPA (same note, same product, or dispatched orphan) is already RUNNING or SUCCESS
                    const alreadyHandled = await prisma.rpaExecution.findFirst({
                        where: {
                            productName: exec.productName,
                            status: { in: ['SUCCESS', 'RUNNING'] },
                            startedAt: { gte: cutoff },
                        },
                    });
                    if (alreadyHandled) continue;

                    toRetry.push(exec);
                }

                if (toRetry.length === 0) return;
                this.log(`🔁 Auto-retry: ${toRetry.length} ejecución(es) a reintentar`);

                for (const exec of toRetry) {
                    const fresh = await prisma.rpaExecution.findUnique({ where: { id: exec.id } });
                    if (!fresh || fresh.status !== 'FAILED') continue;

                    const newRetryCount = fresh.autoRetryCount + 1;
                    this.log(`🔁 Auto-retry #${newRetryCount}/${MAX_AUTO_RETRIES}: ${exec.productName} (exec ${exec.id.slice(0, 8)})`);

                    await prisma.rpaExecution.update({
                        where: { id: exec.id },
                        data: {
                            status: 'RUNNING',
                            autoRetryCount: newRetryCount,
                            siigoNoteCode: null,
                            errorMessage: null,
                            logs: [],
                            screenshotPath: null,
                            siigoUrl: null,
                            completedAt: null,
                            durationMs: null,
                            startedAt: new Date(),
                        },
                    });

                    const prod = await prisma.product.findFirst({ where: { name: exec.productName }, select: { sku: true } });
                    const sku = prod?.sku || exec.productName;
                    const isAdjustment = exec.executionType === 'SIIGO_ADJUSTMENT';
                    let accountCode = '71050503';
                    if (isAdjustment && exec.observations) {
                        const match = exec.observations.match(/Ajuste contable:?\s*(\d+)/i);
                        if (match) accountCode = match[1];
                    }

                    const startTime = Date.now();
                    const taskPayload = isAdjustment
                        ? { type: 'adjustment', params: { productName: sku, quantity: exec.quantity, accountCode } }
                        : { type: 'assembly', params: { productName: sku, quantity: exec.quantity, assemblyType: exec.assemblyType || 'proceso', observations: exec.observations || '' } };

                    this.enqueue({
                        ...taskPayload,
                        executionId: exec.id,
                        resolve: async (result) => {
                            await prisma.rpaExecution.update({
                                where: { id: exec.id },
                                data: {
                                    status: result.success ? 'SUCCESS' : 'FAILED',
                                    siigoNoteCode: result.siigoNoteCode || null,
                                    siigoUrl: result.url || null,
                                    screenshotPath: result.screenshotPath || null,
                                    errorMessage: result.error || null,
                                    logs: result.logs || [],
                                    completedAt: new Date(),
                                    durationMs: Date.now() - startTime,
                                },
                            });
                        },
                        reject: async (err) => {
                            await prisma.rpaExecution.update({
                                where: { id: exec.id },
                                data: {
                                    status: 'FAILED',
                                    errorMessage: err.message,
                                    screenshotPath: err.screenshotPath || null,
                                    logs: err.logs || [],
                                    completedAt: new Date(),
                                    durationMs: Date.now() - startTime,
                                },
                            });
                        },
                    });
                }
            } catch (err) {
                this.log(`❌ Auto-retry error: ${err.message}`);
            }
        }, INTERVAL_MS);

        this.log(`⏱️ Auto-retry scheduler iniciado (cada ${INTERVAL_MS / 60000} min, max ${MAX_AUTO_RETRIES} reintentos)`);
    }
}

// Singleton
const manager = new SiigoBrowserManager();
manager.startAutoRetryScheduler();

module.exports = manager;

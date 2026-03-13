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
    async initialize() {
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
            await this.navigateToForm();

            this.isReady = true;
            this.log('✅ Browser listo y en formulario de ensamble');
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
                this.log('🚀 Lanzando browser efímero...');
                await this.initialize();

                // Execute the assembly note creation
                const result = await this.executeAssemblyNote(task.params);
                task.resolve(result);
            } catch (error) {
                this.log(`❌ Error en tarea: ${error.message || error}`);

                // If browser crashed, try ONE more time with a fresh browser
                if (!task._retried) {
                    this.log('🔄 Reintentando con browser fresco...');
                    task._retried = true;
                    try {
                        await this.cleanup();
                        await this.initialize();
                        const result = await this.executeAssemblyNote(task.params);
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
            // Also try the triple-click + type approach as backup
            if (!qtySet || qtySet === '1' || qtySet === '1.00') {
                log('⚠️ JS set no funcionó, intentando triple-click + type');
                const qtyInput = page.locator('#inputDecimal_siigoInputDecimal').first();
                await qtyInput.click({ clickCount: 3 }).catch(() => { });
                await page.waitForTimeout(300);
                await page.keyboard.press('Backspace');
                await page.waitForTimeout(300);
                await qtyInput.pressSequentially(String(quantity), { delay: 80 });
                await page.waitForTimeout(500);
                await page.click('body', { position: { x: 500, y: 400 } });
                await page.waitForTimeout(500);
                const qtyVal2 = await qtyInput.inputValue().catch(() => '');
                log(`✅ Cantidad (backup): ${qtyVal2}`);
            }
            await page.waitForTimeout(1000);

            // === PRODUCT BODEGA (only the product row, ingredients come from template) ===
            // ALWAYS force "Sin asignar" here because the Siigo template may have
            // overridden the bodega to MAQUILAS after loading ingredients.
            await page.waitForTimeout(3000); // Wait for template to load ingredients
            log('=== BODEGA PRODUCTO (forzar Sin asignar) ===');
            try {
                const bodegaInput = page.locator('id=autocomplete_autocompleteInput').nth(3);
                const bodegaVal = await bodegaInput.inputValue().catch(() => '');
                log(`  Bodega actual: "${bodegaVal}" — forzando "Sin asignar"`);
                await bodegaInput.click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(500);
                await bodegaInput.fill('');
                await page.waitForTimeout(500);
                await bodegaInput.pressSequentially('Sin asig', { delay: 100 });
                await page.waitForTimeout(3000);
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(1000);
                const bodegaVal2 = await bodegaInput.inputValue().catch(() => '');
                log(`✅ Bodega producto: ${bodegaVal2 || '(set via keyboard)'}`);
            } catch (e) {
                log(`⚠️ Bodega producto falló: ${e.message}`);
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
                            const inp = rows[r].querySelector('#autocomplete_autocompleteInput');
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

                // Check for errors
                const saveError = await page.evaluate(() => {
                    const toast = document.querySelector('.Toastify__toast--error');
                    if (toast) return toast.textContent;
                    const errs = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger');
                    for (const el of errs) {
                        const t = el.textContent.trim();
                        if (t.includes('obligatorio') || t.includes('inválid')) return t;
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
                                // Only bodega inputs inside table rows, not product or tercero
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
                                const errs = document.querySelectorAll('[class*="error"], [class*="Error"], .text-danger');
                                for (const el of errs) {
                                    const t = el.textContent.trim();
                                    if (t.includes('obligatorio') || t.includes('inválid')) return t;
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
            let siigoNoteCode = null;

            try {
                siigoNoteCode = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const m1 = text.match(/Nota de ensamble:\s*(NE-\d+-\d+)/i);
                    if (m1) return m1[1];
                    const m2 = text.match(/(NE-\d+-\d+)/);
                    if (m2) return m2[1];
                    const m3 = text.match(/Número\s+(\d{3,})/i);
                    if (m3) return m3[1];
                    return null;
                });
                log(`📋 Nota: ${siigoNoteCode || 'No capturado'}`);
            } catch (e) {
                log('⚠️ No se pudo capturar NE');
            }

            // Screenshot
            const screenshotPath = path.join(screenshotDir, `siigo-assembly-${timestamp}.png`);
            try {
                require('fs').mkdirSync(screenshotDir, { recursive: true });
                await page.screenshot({ path: screenshotPath, fullPage: true });
            } catch (e) { /* ok */ }

            const success = !!siigoNoteCode;
            log(success ? `✅ NE CREADA: ${siigoNoteCode}` : '⚠️ No se confirmó creación de NE');

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
}

// Singleton
const manager = new SiigoBrowserManager();

module.exports = manager;

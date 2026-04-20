const { chromium } = require('playwright');

(async () => {
    console.log('=== BODEGA FIX VERIFICATION TEST ===');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    try {
        // Login
        await page.goto('https://siigonube.siigo.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        console.log('Logging in...');
        await page.locator('input:visible').first().fill('Gerencia@poppingbobainternational.com');
        await page.waitForTimeout(300);
        await page.locator('input:visible').nth(1).fill('Naranjita2025*');
        await page.waitForTimeout(300);
        await page.locator('button:has-text("Continuar")').first().click();
        await page.waitForTimeout(8000);

        // Multi-company portal
        const ingresar = page.locator('button:has-text("Ingresar")');
        if (await ingresar.count() > 0) {
            console.log('Clicking Ingresar on company portal...');
            await ingresar.first().click();
            await page.waitForTimeout(8000);
        }

        // Navigate to assembly note
        console.log('Navigating to assembly note...');
        await page.goto('https://siigonube.siigo.com/#/assembly-note/1664', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        // Select product
        console.log('Selecting product...');
        const productInput = page.locator('id=autocomplete_autocompleteInput').first();
        await productInput.click();
        await productInput.fill('');
        await page.keyboard.type('PROCELIQUIPOPS01', { delay: 80 });
        await page.waitForTimeout(3000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(6000);

        // Take BEFORE screenshot
        await page.screenshot({ path: '/tmp/bodega_fix_before.png', fullPage: true });
        console.log('BEFORE screenshot saved');

        // === NOW TEST THE FIXED BODEGA CODE ===
        console.log('\n=== TESTING BODEGA FIX ===\n');

        const productTableLocator = page.locator('table').filter({ hasText: 'ensamblar' });
        const tableCount = await productTableLocator.count();
        console.log(`Product tables found: ${tableCount}`);

        const bodegaLocator = productTableLocator.locator('#autocomplete_autocompleteInput').nth(1);
        const bodegaCount = await productTableLocator.locator('#autocomplete_autocompleteInput').count();
        console.log(`Autocompletes in product table: ${bodegaCount}`);

        // Check current value
        const currentVal = await bodegaLocator.inputValue().catch(() => 'ERROR');
        console.log(`Current bodega value: "${currentVal}"`);

        // Try the clear button
        const clearBtn = productTableLocator.locator('siigo-autocomplete#warehouse .fa-remove').first();
        const clearBtnCount = await productTableLocator.locator('siigo-autocomplete#warehouse .fa-remove').count();
        console.log(`Clear buttons found: ${clearBtnCount}`);
        await clearBtn.click({ force: true, timeout: 2000 }).catch((e) => console.log(`Clear btn click: ${e.message.substring(0, 50)}`));
        await page.waitForTimeout(500);

        // Click the bodega input
        console.log('Clicking bodega input...');
        await bodegaLocator.click({ force: true });
        await page.waitForTimeout(500);

        // Clear and type
        console.log('Typing "Sin asig"...');
        await bodegaLocator.fill('');
        await page.waitForTimeout(300);
        await bodegaLocator.pressSequentially('Sin asig', { delay: 100 });
        await page.waitForTimeout(3000);

        // Take screenshot to see dropdown
        await page.screenshot({ path: '/tmp/bodega_fix_dropdown.png', fullPage: true });
        console.log('Dropdown screenshot saved');

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);

        // Verify
        const bodegaVerify = await bodegaLocator.inputValue().catch(() => 'ERROR');
        console.log(`\n=== RESULT: Bodega value after fix = "${bodegaVerify}" ===\n`);

        // Take AFTER screenshot
        await page.screenshot({ path: '/tmp/bodega_fix_after.png', fullPage: true });
        console.log('AFTER screenshot saved');

        // Cancel without saving
        console.log('Cancelling...');
        await page.locator('button:has-text("Cancelar")').first().click().catch(() => {});
        await page.waitForTimeout(2000);
        await page.locator('button:has-text("Aceptar"), button:has-text("Sí")').click({ timeout: 3000 }).catch(() => {});

    } catch (err) {
        console.error('Error:', err.message);
        await page.screenshot({ path: '/tmp/bodega_fix_error.png', fullPage: true }).catch(() => {});
    } finally {
        await browser.close();
        console.log('\n=== TEST COMPLETE ===');
    }
})();

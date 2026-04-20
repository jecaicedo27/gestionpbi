const { chromium } = require('playwright');

(async () => {
    console.log('=== BODEGA DOM INSPECTION TEST ===');
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

        // Multi-company portal - click "Ingresar" on the active company
        const ingresar = page.locator('button:has-text("Ingresar")');
        if (await ingresar.count() > 0) {
            console.log('Multi-company portal detected, clicking Ingresar...');
            await ingresar.first().click();
            await page.waitForTimeout(8000);
        }

        // Save session
        await context.storageState({ path: '/var/www/gestionpbi/backend/siigo_session.json' }).catch(() => {});

        // Navigate to assembly note
        console.log('Navigating to assembly note...');
        await page.goto('https://siigonube.siigo.com/#/assembly-note/1664', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        const autoCount = await page.locator('id=autocomplete_autocompleteInput').count();
        console.log(`Autocomplete inputs found: ${autoCount}`);
        
        if (autoCount === 0) {
            console.log('Retrying navigation...');
            await page.screenshot({ path: '/tmp/siigo_no_autocomplete.png', fullPage: true });
            // Maybe need to wait more or reload
            await page.reload();
            await page.waitForTimeout(5000);
            const autoCount2 = await page.locator('id=autocomplete_autocompleteInput').count();
            console.log(`After reload: ${autoCount2}`);
            if (autoCount2 === 0) {
                console.log('Still no autocomplete. Aborting.');
                return;
            }
        }

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

        console.log('\n=== DOM INSPECTION ===\n');

        const domInfo = await page.evaluate(() => {
            const results = {};
            const tables = document.querySelectorAll('table');
            results.totalTables = tables.length;

            let productTable = null;
            for (const t of tables) {
                const hdr = t.querySelector('tr');
                if (hdr && hdr.textContent.includes('ensamblar')) { productTable = t; break; }
            }
            if (!productTable) { productTable = tables[0]; results.note = 'Using first table'; }
            if (!productTable) { results.error = 'No tables found'; return results; }

            results.productTableHeaders = productTable.querySelector('tr')?.textContent?.trim()?.substring(0, 200);
            const rows = productTable.querySelectorAll('tr');
            results.rowCount = rows.length;

            for (let ri = 0; ri < Math.min(rows.length, 4); ri++) {
                const cells = rows[ri].querySelectorAll('td, th');
                const cellInfo = [];
                for (let ci = 0; ci < cells.length; ci++) {
                    const cell = cells[ci];
                    const info = { index: ci, text: cell.textContent.trim().substring(0, 40), selects: cell.querySelectorAll('select').length, inputs: cell.querySelectorAll('input').length, autocompletes: cell.querySelectorAll('[id*="autocomplete"]').length };
                    if (info.selects > 0) info.selectDetails = Array.from(cell.querySelectorAll('select')).map(s => ({ id: s.id, name: s.name, options: Array.from(s.options).slice(0, 8).map(o => o.text.substring(0, 40)), selectedText: s.selectedOptions?.[0]?.text || '' }));
                    if (info.inputs > 0) info.inputDetails = Array.from(cell.querySelectorAll('input')).map(inp => ({ id: inp.id, name: inp.name, type: inp.type, value: inp.value?.substring(0, 40) || '', visible: inp.offsetHeight > 0 }));
                    if (cell.textContent.includes('Bodega') || info.selects > 0 || ci >= 4) {
                        info.innerHTML = cell.innerHTML.substring(0, 800);
                        info.allChildTags = Array.from(cell.querySelectorAll('*')).map(el => ({ tag: el.tagName, id: el.id || '', class: (el.className?.toString?.() || '').substring(0, 80) }));
                    }
                    cellInfo.push(info);
                }
                results['row' + ri + '_cells'] = cellInfo;
            }

            // All selects on page
            const allSelects = document.querySelectorAll('select');
            results.allSelects = Array.from(allSelects).map(s => ({ id: s.id, name: s.name, optionsCount: s.options.length, first5: Array.from(s.options).slice(0, 5).map(o => o.text.substring(0, 40)), tableIndex: s.closest('table') ? Array.from(tables).indexOf(s.closest('table')) : -1, cellIndex: s.closest('td')?.cellIndex ?? -1 }));

            // All autocompletes
            const allAuto = document.querySelectorAll('#autocomplete_autocompleteInput');
            results.autocompleteCount = allAuto.length;
            results.autocompletes = Array.from(allAuto).map((a, i) => ({ idx: i, value: a.value?.substring(0, 50) || '', visible: a.offsetHeight > 0, tableIdx: a.closest('table') ? Array.from(tables).indexOf(a.closest('table')) : -1, cellIdx: a.closest('td')?.cellIndex ?? -1 }));

            return results;
        });

        console.log(JSON.stringify(domInfo, null, 2));
        await page.screenshot({ path: '/tmp/bodega_dom_test.png', fullPage: true });

        // Cancel without saving
        await page.locator('button:has-text("Cancelar")').first().click().catch(() => {});
        await page.waitForTimeout(2000);
        await page.locator('button:has-text("Aceptar"), button:has-text("Sí")').click({ timeout: 3000 }).catch(() => {});
    } catch (err) {
        console.error('Error:', err.message);
        await page.screenshot({ path: '/tmp/bodega_dom_error.png', fullPage: true }).catch(() => {});
    } finally {
        await browser.close();
        console.log('\n=== TEST COMPLETE ===');
    }
})();

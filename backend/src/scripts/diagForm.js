const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LOGIN_URL = 'https://siigonube.siigo.com/';
const SHOT_DIR = path.join(__dirname, '..', 'rpa-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    console.log('Navigating...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Dump ALL input elements and buttons
    const formInfo = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        const buttons = document.querySelectorAll('button');
        let info = '=== INPUTS ===\n';
        inputs.forEach((inp, i) => {
            info += `  Input ${i}: id="${inp.id}" name="${inp.name}" type="${inp.type}" placeholder="${inp.placeholder}" class="${inp.className.substring(0, 100)}" visible=${inp.offsetHeight > 0}\n`;
        });
        info += '=== BUTTONS ===\n';
        buttons.forEach((btn, i) => {
            info += `  Btn ${i}: id="${btn.id}" text="${btn.textContent.trim().substring(0, 50)}" type="${btn.type}" class="${btn.className.substring(0, 100)}" visible=${btn.offsetHeight > 0}\n`;
        });
        return info;
    });
    console.log(formInfo);

    await browser.close();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

const rpaQueue = require('../services/queueService');
const { chromium } = require('playwright');
const logger = require('../utils/logger');

// Define Task Processors
rpaQueue.process(async (job) => {
    const { type, data } = job.data;
    logger.info(`Processing RPA Task: ${type} (Job ${job.id})`);

    let browser;
    try {
        switch (type) {
            case 'SCREENSHOT_TEST':
                browser = await chromium.launch({ headless: true });
                const page = await browser.newPage();
                await page.goto(data.url || 'https://example.com');
                const title = await page.title();
                // In real world, we would save screenshot to disk/S3
                // await page.screenshot({ path: 'screenshot.png' });
                logger.info(`Visited ${data.url}, Title: ${title}`);
                return { title, status: 'Success' };

            case 'SYNC_EXTERNAL_ORDER':
                // Placeholder for future logic
                await new Promise(resolve => setTimeout(resolve, 2000));
                return { status: 'Synced' };

            default:
                throw new Error(`Unknown task type: ${type}`);
        }
    } catch (error) {
        logger.error(`RPA Error: ${error.message}`);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
});

logger.info('RPA Worker started and listening for jobs...');

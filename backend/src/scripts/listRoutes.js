const app = require('../app');
const listEndpoints = require('express-list-endpoints');

console.log('--- Express Routes ---');
try {
    const endpoints = listEndpoints(app);
    console.log(JSON.stringify(endpoints, null, 2));
} catch (e) {
    console.error("Error listing endpoints:", e.message);
}

// Also inspect the router directly
const router = require('../routes');
console.log('\n--- Router Stack Length ---');
console.log(router.stack ? router.stack.length : 'Router is not a standard router object');


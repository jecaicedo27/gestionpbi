const express = require('express');
const app = require('./src/app');

function printRoutes(stack, prefix = '') {
    stack.forEach(layer => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
            console.log(`${methods.padEnd(7)} ${prefix}${layer.route.path}`);
        } else if (layer.name === 'router' && layer.handle.stack) {
            let nextPrefix = prefix;
            // Attempt to find the path that mounted this router
            // This is tricky in Express 4 as it doesn't store the mount path easily accessible in the layer
            // However, we can look at the regex
            const regexPath = layer.regexp.toString();
            // Simple extraction for standard routes
            const match = regexPath.match(/^\/\^\\\/([a-zA-Z0-9_\-]+)\\\/\?\(\?=\\\/\|\$\)\/i$/);
            if (match) {
                nextPrefix = prefix + '/' + match[1];
            } else if (regexPath.includes('api')) {
                nextPrefix = prefix + '/api';
            }

            // For now, let's just assume standard structures from checking index.js
            // or just print what we can. 
            // Better approach: Since we know index.js is mounted at /api, let's just inspect that router specifically if we can.

            printRoutes(layer.handle.stack, nextPrefix);
        }
    });
}

console.log('--- REGISTERED ROUTES ---');
// app._router.stack contains the middleware stack. 
// Typically routes are added there.
// Since 'app' is the express application, we can inspect it.

if (app._router && app._router.stack) {
    printRoutes(app._router.stack);
} else {
    // If app is not initialized with routes yet, we might need to look at how it's exported.
    console.log("App router stack not found immediately.");
}

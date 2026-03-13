const app = require('./src/app');

function printRoutes(path, layer) {
    if (layer.route) {
        layer.route.stack.forEach(printRoutes.bind(null, path.concat(split(layer.route.path))));
    } else if (layer.name === 'router' && layer.handle.stack) {
        layer.handle.stack.forEach(printRoutes.bind(null, path.concat(split(layer.regexp))));
    } else if (layer.method) {
        console.log('%s /%s',
            layer.method.toUpperCase(),
            path.concat(split(layer.route.path)).filter(Boolean).join('/'));
    }
}

function split(thing) {
    if (typeof thing === 'string') {
        return thing.split('/');
    } else if (thing.fast_slash) {
        return '';
    } else {
        var match = thing.toString()
            .replace('\\/?', '')
            .replace('(?=\\/|$)', '$')
            .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^.*+?^${}()|[\]\\\/])*)\$\//)
        return match
            ? match[1].replace(/\\(.)/g, '$1').split('/')
            : '<complex:' + thing.toString() + '>';
    }
}

// Wait for app to initialize if needed, though usually app.js exports initialized express app
setTimeout(() => {
    if (app._router && app._router.stack) {
        console.log('--- REGISTERED ROUTES ---');
        app._router.stack.forEach(printRoutes.bind(null, []));
    } else {
        console.log('App initialized but _router not found or empty');
        console.log('App keys:', Object.keys(app));
    }
}, 1000);

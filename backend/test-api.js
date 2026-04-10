const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/inventory/lots/traceability?zone=PRODUCTION&limit=100',
  method: 'GET',
  headers: {
    // We don't have token, but wait, the endpoint is protected!
    // I can just mock the controller directly.
  }
};

const lotController = require('./src/controllers/lotController');
const res = { json: (data) => console.log(JSON.stringify(data[0])) };
const req = { query: { zone: 'PRODUCTION', limit: 1 } };
lotController.getTraceability(req, res);


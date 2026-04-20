const http = require('http');

http.get('http://localhost:3051/api/shifts/handoff/checklists', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log("Checklists Response:", data);
    });
}).on('error', err => console.log(err));

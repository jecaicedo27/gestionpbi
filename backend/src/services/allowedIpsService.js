const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const FILE_PATH = path.join(__dirname, '..', '..', 'data', 'allowed-ips.json');

let cache = { ips: [], mtimeMs: 0 };

function load() {
    try {
        const stat = fs.statSync(FILE_PATH);
        if (stat.mtimeMs === cache.mtimeMs) return cache.ips;
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        const data = JSON.parse(raw);
        cache = { ips: Array.isArray(data.ips) ? data.ips : [], mtimeMs: stat.mtimeMs };
    } catch (err) {
        if (err.code !== 'ENOENT') logger.error('allowed-ips read error:', err);
        cache = { ips: [], mtimeMs: 0 };
    }
    return cache.ips;
}

function save(ips) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({ ips }, null, 2));
    cache = { ips, mtimeMs: fs.statSync(FILE_PATH).mtimeMs };
}

function list() {
    return load().slice();
}

function isAllowed(ip) {
    if (!ip) return false;
    return load().some(entry => entry.ip === ip);
}

function add({ ip, label, addedBy }) {
    const ips = load();
    const existing = ips.find(e => e.ip === ip);
    if (existing) {
        existing.label = label || existing.label;
        existing.addedBy = addedBy || existing.addedBy;
        existing.updatedAt = new Date().toISOString();
        save(ips);
        return existing;
    }
    const entry = { ip, label: label || '', addedBy: addedBy || '', addedAt: new Date().toISOString() };
    ips.push(entry);
    save(ips);
    return entry;
}

function remove(ip) {
    const ips = load();
    const next = ips.filter(e => e.ip !== ip);
    if (next.length === ips.length) return false;
    save(next);
    return true;
}

module.exports = { list, isAllowed, add, remove };

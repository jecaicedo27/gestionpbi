const allowedIpsService = require('../services/allowedIpsService');
const { getClientIp } = require('../middleware/auth');
const logger = require('../utils/logger');

const list = async (req, res) => {
    res.json({ ips: allowedIpsService.list() });
};

const registerCurrent = async (req, res) => {
    const ip = getClientIp(req);
    if (!ip) return res.status(400).json({ error: 'No se pudo determinar la IP' });
    const label = (req.body?.label || 'Planta').toString().slice(0, 60);
    const entry = allowedIpsService.add({ ip, label, addedBy: req.user.email });
    logger.info(`Allowed IP registered: ${ip} (${label}) by ${req.user.email}`);
    res.json({ success: true, entry });
};

const addManual = async (req, res) => {
    const { ip, label } = req.body || {};
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.status(400).json({ error: 'IP inválida' });
    const entry = allowedIpsService.add({ ip, label: (label || '').toString().slice(0, 60), addedBy: req.user.email });
    logger.info(`Allowed IP added: ${ip} by ${req.user.email}`);
    res.json({ success: true, entry });
};

const remove = async (req, res) => {
    const { ip } = req.params;
    const ok = allowedIpsService.remove(ip);
    if (!ok) return res.status(404).json({ error: 'IP no encontrada' });
    logger.info(`Allowed IP removed: ${ip} by ${req.user.email}`);
    res.json({ success: true });
};

module.exports = { list, registerCurrent, addManual, remove };

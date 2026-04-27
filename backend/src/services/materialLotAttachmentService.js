const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const LOT_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'material-lot-attachments');

const ensureDirectory = async (dirPath) => {
    await fs.promises.mkdir(dirPath, { recursive: true });
};

const buildStoredName = (originalName = 'archivo') => {
    const ext = path.extname(originalName) || '';
    const safeBase = path.basename(originalName, ext)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 50) || 'archivo';

    return `lote_${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`;
};

const toRelativeUrl = (absolutePath) => {
    const relativePath = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join('/');
    return `/uploads/${relativePath}`;
};

const removeFileIfExists = async (absolutePath) => {
    try {
        await fs.promises.unlink(absolutePath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

const storeMaterialLotAttachment = async (materialLotId, file) => {
    const targetDir = path.join(LOT_UPLOAD_ROOT, materialLotId);
    await ensureDirectory(targetDir);

    const storedName = buildStoredName(file.originalname || 'archivo');
    const absolutePath = path.join(targetDir, storedName);
    await fs.promises.writeFile(absolutePath, file.buffer);

    return {
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype || null,
        sizeBytes: typeof file.size === 'number' ? file.size : null,
        url: toRelativeUrl(absolutePath),
        absolutePath
    };
};

const cleanupStoredMaterialLotFiles = async (storedFiles = []) => {
    for (const file of storedFiles) {
        if (file?.absolutePath) {
            await removeFileIfExists(file.absolutePath);
        }
    }
};

module.exports = {
    storeMaterialLotAttachment,
    cleanupStoredMaterialLotFiles
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const MICRO_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'micro');

const CATEGORY_FOLDER = {
    LAB_REPORT: 'reportes',
    PHOTO: 'imagenes',
    VIDEO: 'videos',
    DOCUMENT: 'documentos'
};

const FILE_PREFIX = {
    LAB_REPORT: 'informe',
    PHOTO: 'foto',
    VIDEO: 'video',
    DOCUMENT: 'adjunto'
};

const ensureDirectory = async (dirPath) => {
    await fs.promises.mkdir(dirPath, { recursive: true });
};

const buildStoredName = (originalName, category) => {
    const ext = path.extname(originalName || '') || '';
    const safeBase = path.basename(originalName || 'archivo', ext)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 50) || 'archivo';

    return `${FILE_PREFIX[category] || 'archivo'}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeBase}${ext}`;
};

const classifyAttachment = (file, isPrimaryReport = false) => {
    if (isPrimaryReport) return 'LAB_REPORT';
    if (file.mimetype?.startsWith('video/')) return 'VIDEO';
    return file.mimetype?.startsWith('image/') ? 'PHOTO' : 'DOCUMENT';
};

const relativeUrlFromAbsolutePath = (absolutePath) => {
    const relativePath = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join('/');
    return `/uploads/${relativePath}`;
};

const writeFileToSampleDirectory = async (sampleNumber, file, category) => {
    const targetDir = path.join(MICRO_UPLOAD_ROOT, sampleNumber, CATEGORY_FOLDER[category] || CATEGORY_FOLDER.DOCUMENT);
    await ensureDirectory(targetDir);

    const storedName = buildStoredName(file.originalname, category);
    const absolutePath = path.join(targetDir, storedName);
    await fs.promises.writeFile(absolutePath, file.buffer);

    return {
        category,
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype || null,
        sizeBytes: typeof file.size === 'number' ? file.size : null,
        url: relativeUrlFromAbsolutePath(absolutePath),
        absolutePath
    };
};

const writeBufferToSampleDirectory = async (sampleNumber, { buffer, originalName, mimeType = 'application/pdf' }, category) => {
    const targetDir = path.join(MICRO_UPLOAD_ROOT, sampleNumber, CATEGORY_FOLDER[category] || CATEGORY_FOLDER.DOCUMENT);
    await ensureDirectory(targetDir);

    const storedName = buildStoredName(originalName, category);
    const absolutePath = path.join(targetDir, storedName);
    await fs.promises.writeFile(absolutePath, buffer);

    return {
        category,
        originalName,
        storedName,
        mimeType,
        sizeBytes: Buffer.byteLength(buffer),
        url: relativeUrlFromAbsolutePath(absolutePath),
        absolutePath
    };
};

const storeMicroSampleFiles = async (sampleNumber, { reportFile = null, attachmentFiles = [] } = {}) => {
    const storedFiles = [];

    if (reportFile) {
        storedFiles.push(await writeFileToSampleDirectory(sampleNumber, reportFile, classifyAttachment(reportFile, true)));
    }

    for (const file of attachmentFiles) {
        storedFiles.push(await writeFileToSampleDirectory(sampleNumber, file, classifyAttachment(file)));
    }

    return storedFiles;
};

const storeGeneratedMicroReport = async (sampleNumber, { buffer, originalName, mimeType = 'application/pdf' }) => (
    writeBufferToSampleDirectory(sampleNumber, { buffer, originalName, mimeType }, 'LAB_REPORT')
);

const pruneEmptyDirectories = async (startDir, stopDir) => {
    let currentDir = startDir;
    const normalizedStopDir = path.resolve(stopDir);

    while (currentDir.startsWith(normalizedStopDir) && currentDir !== normalizedStopDir) {
        const entries = await fs.promises.readdir(currentDir);
        if (entries.length > 0) break;

        await fs.promises.rmdir(currentDir);
        currentDir = path.dirname(currentDir);
    }
};

const removeFileIfExists = async (absolutePath) => {
    try {
        await fs.promises.unlink(absolutePath);
        await pruneEmptyDirectories(path.dirname(absolutePath), MICRO_UPLOAD_ROOT);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

const cleanupStoredFiles = async (storedFiles = []) => {
    for (const file of storedFiles) {
        await removeFileIfExists(file.absolutePath);
    }
};

const deleteFilesByUrls = async (urls = []) => {
    for (const url of urls) {
        if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) continue;
        const absolutePath = path.join(UPLOAD_ROOT, url.replace('/uploads/', ''));
        await removeFileIfExists(absolutePath);
    }
};

module.exports = {
    storeMicroSampleFiles,
    storeGeneratedMicroReport,
    cleanupStoredFiles,
    deleteFilesByUrls
};

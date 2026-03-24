const PDFDocument = require('pdfkit');

const MM_TO_POINTS = 72 / 25.4;
const LABEL_WIDTH = 50 * MM_TO_POINTS;
const LABEL_HEIGHT = 40 * MM_TO_POINTS;
const TIMEZONE = 'America/Bogota';

const sanitizeText = (value, fallback = '') => {
    const normalized = `${value || ''}`.replace(/\s+/g, ' ').trim();
    return normalized || fallback;
};

const truncateText = (value, maxLength = 32) => {
    const normalized = sanitizeText(value);
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const formatIsoDateText = (value) => {
    const normalized = sanitizeText(value);
    if (!normalized) return '';

    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return normalized;

    return `${match[3]}/${match[2]}/${match[1]}`;
};

const formatTimeText = (value) => {
    const normalized = sanitizeText(value);
    if (!normalized) return '';

    const match = normalized.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return normalized;

    return `${match[1].padStart(2, '0')}:${match[2]}`;
};

const formatDateFromDateTime = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return parsed.toLocaleDateString('es-CO', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
};

const formatTimeFromDateTime = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return parsed.toLocaleTimeString('es-CO', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

const resolveLabelDate = (payload = {}) => {
    if (sanitizeText(payload.collectionDate)) {
        return formatIsoDateText(payload.collectionDate);
    }

    if (sanitizeText(payload.takenAt)) {
        return formatDateFromDateTime(payload.takenAt);
    }

    return '';
};

const resolveLabelTime = (payload = {}) => {
    if (sanitizeText(payload.collectionTime)) {
        return formatTimeText(payload.collectionTime);
    }

    if (sanitizeText(payload.takenAt)) {
        return formatTimeFromDateTime(payload.takenAt);
    }

    return '';
};

const drawField = (doc, {
    x,
    y,
    width,
    height,
    label,
    value,
    valueSize = 6.8
}) => {
    doc.roundedRect(x, y, width, height, 3).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold')
        .fontSize(4.4)
        .fillColor('#000000')
        .text(label, x + 3, y + 2, {
            width: width - 6,
            lineBreak: false
        });
    doc.font('Helvetica')
        .fontSize(valueSize)
        .fillColor('#000000')
        .text(value || '—', x + 3, y + 7, {
            width: width - 6,
            height: Math.max(0, height - 9),
            ellipsis: true
        });
};

const generateMicroSampleLabelPdf = async (payload = {}) => {
    const doc = new PDFDocument({
        size: [LABEL_WIDTH, LABEL_HEIGHT],
        margin: 0
    });

    const chunks = [];
    const labelTitle = truncateText(sanitizeText(payload.labelTitle, 'ETIQUETA MICRO'), 24);
    const sampleNumber = sanitizeText(payload.sampleNumber, 'PENDIENTE');
    const sampleIdentifier = sanitizeText(payload.sampleIdentifier);
    const sampleAlias = sanitizeText(payload.sampleAlias);
    const analysisLabel = sanitizeText(payload.analysisLabel);
    const traceabilityLine = sanitizeText(payload.traceabilityLine);
    const pointCode = sanitizeText(payload.pointCode);
    const pointName = sanitizeText(payload.pointName);
    const zoneName = sanitizeText(payload.zoneName);
    const lotNumber = sanitizeText(payload.lotNumber);
    const batchCode = sanitizeText(payload.batchCode);
    const shiftLabel = sanitizeText(payload.shiftLabel);
    const workContextLabel = sanitizeText(payload.workContextLabel);
    const laboratoryProfileLabel = sanitizeText(payload.laboratoryProfileLabel);
    const labName = sanitizeText(payload.labName);
    const sampleDescription = sanitizeText(payload.sampleDescription);
    const collectionDate = resolveLabelDate(payload);
    const collectionTime = resolveLabelTime(payload);

    const margin = 5;
    const gutter = 4;
    const contentWidth = LABEL_WIDTH - (margin * 2);
    const halfWidth = (contentWidth - gutter) / 2;
    const startX = margin;
    const rightX = margin + halfWidth + gutter;

    const identifier = truncateText(sampleIdentifier || sampleNumber, 18);
    const pointLine = truncateText(
        [sampleAlias, analysisLabel].filter(Boolean).join(' · ')
        || [pointCode, pointName].filter(Boolean).join(' · ')
        || 'Punto pendiente',
        34
    );
    const zoneLine = truncateText(
        [pointCode, pointName].filter(Boolean).join(' · ')
        || zoneName
        || sampleDescription
        || 'Sin zona visible',
        38
    );
    const traceLine = truncateText(
        traceabilityLine
        || [sampleNumber, laboratoryProfileLabel, labName].filter(Boolean).join(' · ')
        || 'Sin traza complementaria',
        36
    );

    const pdfBuffer = await new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT).fill('#ffffff');
        doc.roundedRect(1.5, 1.5, LABEL_WIDTH - 3, LABEL_HEIGHT - 3, 4).lineWidth(1.2).strokeColor('#000000').stroke();

        doc.roundedRect(startX, margin, contentWidth, 10, 3).fill('#000000');
        doc.font('Helvetica-Bold')
            .fontSize(6)
            .fillColor('#ffffff')
            .text(labelTitle, startX, margin + 2.2, {
                width: contentWidth,
                align: 'center'
            });

        doc.roundedRect(startX, 18, contentWidth, 13, 3).lineWidth(0.8).strokeColor('#000000').stroke();
        doc.font('Helvetica-Bold')
            .fontSize(4.5)
            .fillColor('#000000')
            .text('MUESTRA', startX + 3, 20, { width: 40, lineBreak: false });
        doc.font('Helvetica-Bold')
            .fontSize(identifier.length > 12 ? 10.5 : 11.5)
            .fillColor('#000000')
            .text(identifier, startX + 3, 21.2, {
                width: contentWidth - 6,
                align: 'right',
                lineBreak: false
            });

        doc.roundedRect(startX, 34, contentWidth, 12, 3).lineWidth(0.8).strokeColor('#000000').stroke();
        doc.font('Helvetica-Bold')
            .fontSize(6.3)
            .fillColor('#000000')
            .text(pointLine, startX + 3, 36.2, {
                width: contentWidth - 6,
                lineBreak: false
            });
        doc.font('Helvetica')
            .fontSize(4.8)
            .fillColor('#000000')
            .text(zoneLine, startX + 3, 41.1, {
                width: contentWidth - 6,
                lineBreak: false
            });

        drawField(doc, {
            x: startX,
            y: 49,
            width: halfWidth,
            height: 12,
            label: 'FECHA',
            value: collectionDate
        });
        drawField(doc, {
            x: rightX,
            y: 49,
            width: halfWidth,
            height: 12,
            label: 'HORA',
            value: collectionTime
        });
        drawField(doc, {
            x: startX,
            y: 64,
            width: halfWidth,
            height: 12,
            label: 'LOTE',
            value: truncateText(lotNumber, 18)
        });
        drawField(doc, {
            x: rightX,
            y: 64,
            width: halfWidth,
            height: 12,
            label: 'BATCH',
            value: truncateText(batchCode, 18)
        });
        drawField(doc, {
            x: startX,
            y: 79,
            width: halfWidth,
            height: 12,
            label: 'TURNO',
            value: truncateText(shiftLabel, 18)
        });
        drawField(doc, {
            x: rightX,
            y: 79,
            width: halfWidth,
            height: 12,
            label: 'CONTEXTO',
            value: truncateText(workContextLabel, 18)
        });
        drawField(doc, {
            x: startX,
            y: 94,
            width: contentWidth,
            height: 14,
            label: 'TRAZA / TIPO',
            value: traceLine,
            valueSize: 6.2
        });

        doc.end();
    });

    return pdfBuffer;
};

module.exports = {
    generateMicroSampleLabelPdf
};

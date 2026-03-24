const PDFDocument = require('pdfkit');
const { storeGeneratedMicroReport } = require('./microSampleFileService');
const { toIsoDate } = require('./microLabService');

const drawSectionTitle = (doc, title, y) => {
    doc.font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#0f172a')
        .text(title, 40, y);
    doc.moveTo(40, y + 15).lineTo(555, y + 15).strokeColor('#cbd5e1').lineWidth(1).stroke();
    return y + 24;
};

const ensurePageSpace = (doc, y, height = 80) => {
    const bottomLimit = doc.page.height - 55;
    if (y + height <= bottomLimit) return y;

    doc.addPage();
    return 40;
};

const writeKeyValuePair = (doc, label, value, x, y, width = 220) => {
    doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#334155')
        .text(`${label}:`, x, y, { width: 90, continued: true });
    doc.font('Helvetica')
        .fillColor('#111827')
        .text(` ${value || '—'}`, { width });
};

const formatStructuredValue = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (Array.isArray(value)) return value.map(item => formatStructuredValue(item)).join(', ');
    if (typeof value === 'object') {
        if (value.name) return value.name;
        return Object.entries(value)
            .filter(([, nestedValue]) => nestedValue !== null && nestedValue !== undefined && nestedValue !== '')
            .map(([key, nestedValue]) => `${key}: ${formatStructuredValue(nestedValue)}`)
            .join(' | ');
    }
    return `${value}`;
};

const buildStructuredBlockText = (data = {}, labels = {}, emptyText = 'Sin información registrada.') => {
    if (!data || typeof data !== 'object') return emptyText;

    const lines = Object.entries(data)
        .filter(([, value]) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))
        .map(([key, value]) => `${labels[key] || key}: ${formatStructuredValue(value)}`);

    return lines.length > 0 ? lines.join('\n') : emptyText;
};

const buildReadingsText = (readings = [], parameterMap = new Map()) => {
    if (!Array.isArray(readings) || readings.length === 0) return 'Sin lecturas registradas.';

    return readings.map(reading => {
        const parameterName = parameterMap.get(reading.parameterId)?.name || reading.parameterName || reading.parameterId || 'Parámetro';
        const pieces = [];

        if (reading.value !== null && reading.value !== undefined && reading.value !== '') {
            pieces.push(`valor: ${reading.value}`);
        }
        if (reading.valueText) {
            pieces.push(`texto: ${reading.valueText}`);
        }
        if (reading.isDetected !== null && reading.isDetected !== undefined) {
            pieces.push(`detección: ${reading.isDetected ? 'Detectado' : 'Ausente'}`);
        }
        if (reading.notes) {
            pieces.push(`nota: ${reading.notes}`);
        }

        return `${parameterName} (${pieces.join(' | ') || 'sin detalle'})`;
    }).join('\n');
};

const SAMPLE_TYPE_FIELD_LABELS = {
    referenceName: 'Referencia',
    processStage: 'Etapa',
    productReference: 'Producto',
    presentation: 'Presentación',
    flavor: 'Sabor',
    waterPoint: 'Punto de agua',
    waterSource: 'Fuente',
    preservationMethod: 'Preservación',
    sampleTemperatureC: 'Temperatura (°C)',
    surfaceName: 'Superficie / equipo',
    equipmentReference: 'Equipo',
    surfaceMethod: 'Método de muestreo',
    sampledAreaCm2: 'Área muestreada (cm²)',
    ambientArea: 'Área / ambiente',
    collectionMethod: 'Método de captura',
    exposureMinutes: 'Exposición (min)',
    airflowCondition: 'Condición del ambiente'
};

const SAMPLE_COLLECTION_FIELD_LABELS = {
    collectedAt: 'Fecha de toma',
    collectorName: 'Responsable',
    collectionMethod: 'Método / toma',
    collectionNotes: 'Observaciones de recolección',
    inoculationNotes: 'Inoculación / preparación',
    traceabilityNotes: 'Notas de trazabilidad'
};

const buildInternalSampleTypeText = (sampleTypeData = {}) => {
    if (Array.isArray(sampleTypeData?.sampleUnits) && sampleTypeData.sampleUnits.length > 0) {
        return sampleTypeData.sampleUnits.map((unit, index) => (
            [
                `${unit.label || `Muestra ${index + 1}`} (${unit.entityType || 'OTRO'})`,
                unit.sampleIdentifier ? `ID muestra: ${unit.sampleIdentifier}` : null,
                unit.analysisLabel ? `Análisis asignado: ${unit.analysisLabel}` : null,
                unit.purpose ? `Propósito: ${unit.purpose}` : null,
                buildStructuredBlockText(unit.fields, SAMPLE_TYPE_FIELD_LABELS, 'Sin ficha específica registrada.'),
                buildStructuredBlockText(unit.collectionData, SAMPLE_COLLECTION_FIELD_LABELS, 'Sin trazabilidad de toma registrada.')
            ].filter(Boolean).join('\n')
        )).join('\n\n');
    }

    const {
        sampleUnits,
        attachmentAssignments,
        activeSampleUnitId,
        ...legacyFields
    } = sampleTypeData || {};

    return buildStructuredBlockText(legacyFields, SAMPLE_TYPE_FIELD_LABELS, 'Sin ficha técnica específica registrada.');
};

const buildResultsText = (results = []) => {
    if (!Array.isArray(results) || results.length === 0) return 'Sin resultados finales cargados.';

    return results.map(result => {
        const value = result.value !== null && result.value !== undefined ? result.value : result.valueText || '—';
        const compliance = result.isCompliant === true
            ? 'Conforme'
            : result.isCompliant === false
                ? 'No conforme'
                : 'Sin evaluación';
        const method = result.parameter?.method ? ` | Método: ${result.parameter.method}` : '';
        const regulatoryRef = result.parameter?.regulatoryRef ? ` | Norma: ${result.parameter.regulatoryRef}` : '';

        return `${result.parameter?.name || result.parameterName || result.parameterId}: ${value} | ${compliance}${method}${regulatoryRef}`;
    }).join('\n');
};

const buildSupportAttachmentsText = (attachments = [], sampleTypeData = {}) => {
    const supportAttachments = (attachments || []).filter(attachment => attachment?.category !== 'LAB_REPORT');
    if (supportAttachments.length === 0) return 'Sin soportes adjuntos adicionales.';

    const sampleUnitLabelMap = new Map(
        (sampleTypeData?.sampleUnits || []).map((unit, index) => [
            unit.id,
            unit.label || unit.fields?.referenceName || `Muestra ${index + 1}`
        ])
    );
    const attachmentAssignments = sampleTypeData?.attachmentAssignments || {};

    return supportAttachments.map(attachment => {
        const attachmentType = attachment.category === 'PHOTO'
            ? 'Foto'
            : attachment.category === 'VIDEO'
                ? 'Video'
                : 'Documento';
        const assignedLabel = sampleUnitLabelMap.get(attachmentAssignments[attachment.id]);

        return `${attachmentType}${assignedLabel ? ` · ${assignedLabel}` : ''}: ${attachment.originalName || attachment.storedName || attachment.id}`;
    }).join('\n');
};

const generateInternalMicroReport = async ({ sample, samplingPoint, parameters = [], internalLogs = [], finalResults = [] }) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];
    const parameterMap = new Map(parameters.map(parameter => [parameter.id, parameter]));

    const pdfBuffer = await new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.rect(0, 0, doc.page.width, 92).fill('#0f766e');
        doc.font('Helvetica-Bold')
            .fontSize(24)
            .fillColor('#ffffff')
            .text('REPORTE INTERNO DE LABORATORIO', 40, 26);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#d1fae5')
            .text('GestionPBI · Control microbiológico en planta', 40, 58);

        let y = 110;
        y = drawSectionTitle(doc, 'Identificación', y);
        writeKeyValuePair(doc, 'Muestra', sample.sampleNumber, 40, y);
        writeKeyValuePair(doc, 'Reporte', sample.reportNumber, 315, y, 180);
        y += 18;
        writeKeyValuePair(doc, 'Punto', `${samplingPoint?.code || ''} ${samplingPoint?.name || ''}`.trim(), 40, y, 240);
        writeKeyValuePair(doc, 'Zona', sample.zoneName || samplingPoint?.zoneName || samplingPoint?.processArea || '—', 315, y, 180);
        y += 18;
        writeKeyValuePair(doc, 'Tipo', sample.laboratoryProfile, 40, y);
        writeKeyValuePair(doc, 'Turno', sample.shift, 180, y, 120);
        writeKeyValuePair(doc, 'Contexto', sample.workContext, 315, y, 180);
        y += 18;
        writeKeyValuePair(doc, 'Tomada el', sample.takenAt ? new Date(sample.takenAt).toLocaleString('es-CO') : '—', 40, y, 240);
        writeKeyValuePair(doc, 'Cerrada el', sample.closedAt ? new Date(sample.closedAt).toLocaleString('es-CO') : '—', 315, y, 180);
        y += 32;

        y = ensurePageSpace(doc, y, 110);
        y = drawSectionTitle(doc, 'Toma de muestra y observaciones iniciales', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(sample.notes || 'Sin observaciones iniciales.', 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 120);
        y = drawSectionTitle(doc, 'Recepción y aceptación', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildStructuredBlockText(sample.acceptanceData, {
                receivedAt: 'Fecha de ingreso',
                accepted: 'Aceptada',
                containerIntegrity: 'Integridad del envase',
                sampleCondition: 'Condición de la muestra',
                transportCondition: 'Transporte / cadena',
                chainOfCustodyRef: 'Cadena de custodia',
                sampleTemperatureC: 'Temperatura (°C)',
                sampleQuantity: 'Cantidad',
                quantityUnit: 'Unidad',
                conditionNotes: 'Observaciones',
                rejectionReason: 'Motivo de rechazo',
                receivedBy: 'Recibió'
            }, 'Sin recepción registrada.'), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 120);
        y = drawSectionTitle(doc, 'Ficha técnica de la muestra', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildInternalSampleTypeText(sample.sampleTypeData), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 140);
        y = drawSectionTitle(doc, 'Trazabilidad técnica del ensayo', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildStructuredBlockText(sample.analysisExecutionData, {
                methodCode: 'Método',
                methodVersion: 'Versión',
                analystName: 'Analista',
                equipmentName: 'Equipo',
                incubatorName: 'Incubador',
                mediaLot: 'Lote medio',
                diluentLot: 'Lote diluyente',
                plateBatch: 'Lote soporte',
                positiveControl: 'Control positivo',
                negativeControl: 'Control negativo',
                duplicatePerformed: 'Duplicado',
                acceptanceCriteria: 'Criterio de aceptación',
                incubationStartedAt: 'Inicio incubación',
                incubationEndedAt: 'Fin incubación',
                executionNotes: 'Notas',
                normativeRefs: 'Referencias normativas'
            }, 'Sin trazabilidad técnica registrada.'), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 150);
        y = drawSectionTitle(doc, 'Seguimiento diario', y);
        if (internalLogs.length === 0) {
            doc.font('Helvetica')
                .fontSize(10)
                .fillColor('#475569')
                .text('No se registraron bitácoras internas.', 40, y);
            y += 24;
        } else {
            internalLogs.forEach(log => {
                y = ensurePageSpace(doc, y, 120);
                doc.roundedRect(40, y, 515, 86, 8).fillAndStroke('#f8fafc', '#cbd5e1');
                doc.font('Helvetica-Bold')
                    .fontSize(10)
                    .fillColor('#0f172a')
                    .text(`Día ${log.dayNumber || '—'} · ${toIsoDate(log.logDate)}`, 52, y + 12);
                doc.font('Helvetica')
                    .fontSize(9)
                    .fillColor('#334155')
                    .text(`Registró: ${log.recordedBy?.name || 'Sistema'}`, 52, y + 28);
                doc.text(log.observations || 'Sin observaciones.', 52, y + 42, { width: 220 });
                doc.text(buildReadingsText(log.readings, parameterMap), 285, y + 12, { width: 250 });
                y += 98;
            });
        }

        y = ensurePageSpace(doc, y, 120);
        y = drawSectionTitle(doc, 'Resultados finales', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildResultsText(finalResults), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 100);
        y = drawSectionTitle(doc, 'Soportes y evidencias', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildSupportAttachmentsText(sample.attachments, sample.sampleTypeData), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 120);
        y = drawSectionTitle(doc, 'Desviaciones y CAPA', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(buildStructuredBlockText(sample.deviationData, {
                hasDeviation: 'Hubo desviación',
                category: 'Categoría',
                details: 'Detalle',
                immediateActions: 'Acciones inmediatas',
                capaPlan: 'Plan CAPA',
                productionImpact: 'Impacto en producción',
                linkedReference: 'Referencia vinculada',
                requiresHold: 'Requiere retención'
            }, 'Sin desviaciones documentadas.'), 40, y, { width: 515 });
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 120);
        y = drawSectionTitle(doc, 'Revisión técnica y aprobación', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(
                [
                    buildStructuredBlockText(sample.technicalReviewData, {
                        reviewedAt: 'Fecha revisión',
                        reviewDecision: 'Dictamen técnico',
                        releaseDecision: 'Decisión operativa',
                        reviewNotes: 'Observaciones',
                        normativeRefs: 'Referencias normativas',
                        reviewedBy: 'Revisó'
                    }, 'Sin revisión técnica registrada.'),
                    '',
                    buildStructuredBlockText(sample.approvalData, {
                        approvedAt: 'Fecha aprobación',
                        approvalNotes: 'Notas aprobación',
                        approvedBy: 'Aprobó'
                    }, 'Sin aprobación final registrada.')
                ].join('\n'),
                40,
                y,
                { width: 515 }
            );
        y = doc.y + 24;

        y = ensurePageSpace(doc, y, 90);
        y = drawSectionTitle(doc, 'Conclusión final', y);
        doc.font('Helvetica')
            .fontSize(10)
            .fillColor('#111827')
            .text(sample.finalConclusion || 'Sin conclusión final.', 40, y, { width: 515 });

        doc.font('Helvetica')
            .fontSize(8)
            .fillColor('#64748b')
            .text(`Documento generado automáticamente el ${new Date().toLocaleString('es-CO')}`, 40, 735, {
                width: 515,
                align: 'center'
            });

        doc.end();
    });

    return storeGeneratedMicroReport(sample.sampleNumber, {
        buffer: pdfBuffer,
        originalName: `${sample.reportNumber || sample.sampleNumber}_reporte_interno.pdf`
    });
};

module.exports = {
    generateInternalMicroReport
};

const { normalizeOptionalText } = require('./microLabService');

const DETECTION_SPEC_PATTERN = /\bAUSENTE\b|\bPRESENCIA\b|\bPRESENTE\b|DETECTAD|DETECTED|NO\s+DETECTADO|NOT\s+DETECTED/i;

const roundNumber = (value, decimals = 2) => (
    Number.isFinite(value) ? Number(value.toFixed(decimals)) : null
);

const hasConfiguredMicroCriteria = (parameter = {}) => (
    (parameter?.specMin !== null && parameter?.specMin !== undefined)
    || (parameter?.specMax !== null && parameter?.specMax !== undefined)
    || Boolean(normalizeOptionalText(parameter?.specText))
);

const buildDistinctValues = (collection = [], selector = (item) => item) => (
    Array.from(new Set(
        collection
            .map(selector)
            .map(value => normalizeOptionalText(value))
            .filter(Boolean)
    ))
);

const compareDataPoints = (left, right) => {
    const leftTime = Number(left?.timestamp || 0);
    const rightTime = Number(right?.timestamp || 0);
    if (leftTime !== rightTime) return leftTime - rightTime;

    return `${left?.sampleNumber || ''}`.localeCompare(`${right?.sampleNumber || ''}`);
};

const compareSeries = (left, right) => (
    `${left?.point?.processArea || ''}`.localeCompare(`${right?.point?.processArea || ''}`)
    || `${left?.point?.code || ''}`.localeCompare(`${right?.point?.code || ''}`)
);

const buildParameterMeta = (parameter = {}) => ({
    id: parameter?.id || null,
    code: parameter?.code || null,
    name: parameter?.name || null,
    unit: parameter?.unit || null,
    method: parameter?.method || null,
    specMin: parameter?.specMin ?? null,
    specMax: parameter?.specMax ?? null,
    specText: parameter?.specText || null,
    regulatoryRef: parameter?.regulatoryRef || null
});

const buildPointMeta = (point = {}) => ({
    id: point?.id || null,
    code: point?.code || null,
    name: point?.name || null,
    processArea: point?.processArea || null,
    zoneName: point?.zoneName || null,
    isEnvironmental: Boolean(point?.isEnvironmental)
});

const detectDataKind = ({ parameter = {}, rawPoints = [] } = {}) => {
    const specText = normalizeOptionalText(parameter?.specText) || '';
    const hasDetectionResult = rawPoints.some(point => point.isDetected !== null && point.isDetected !== undefined);

    if (hasDetectionResult || DETECTION_SPEC_PATTERN.test(specText)) {
        return 'qualitative';
    }

    return 'quantitative';
};

const buildScaleRecommendation = ({ dataKind, values = [] } = {}) => {
    if (dataKind === 'qualitative') {
        return {
            suggestedChart: 'bar',
            comparisonChart: 'stacked-bar',
            comparisonMode: 'detection-rate',
            xScaleType: 'category',
            yScaleType: 'linear',
            useLogScale: false,
            reason: 'Los resultados son binarios, así que se leen mejor como presencia/ausencia y como distribución porcentual por punto.'
        };
    }

    const finiteValues = values.filter(value => Number.isFinite(value));
    const positiveValues = finiteValues.filter(value => value > 0);
    const canUseLogScale = positiveValues.length >= 2
        && (Math.max(...positiveValues) / Math.max(Math.min(...positiveValues), 1)) >= 100;

    return {
        suggestedChart: 'line',
        comparisonChart: 'line',
        comparisonMode: 'shared-time-series',
        xScaleType: 'linear',
        yScaleType: canUseLogScale ? 'logarithmic' : 'linear',
        useLogScale: canUseLogScale,
        reason: canUseLogScale
            ? 'Los recuentos cambian varios órdenes de magnitud, por eso la comparación es más fiel en escala logarítmica.'
            : 'Los recuentos se mantienen en un rango comparable y se leen mejor con línea temporal sobre escala lineal.'
    };
};

const buildDisplayValue = (point, dataKind) => {
    if (dataKind === 'qualitative') {
        if (point.isDetected === true) return 'Detectado';
        if (point.isDetected === false) return 'Ausente';
        return 'Sin dato';
    }

    if (point.valueText) return point.valueText;
    if (point.value !== null && point.value !== undefined) return point.value;
    return 'Sin dato';
};

const buildRawDataPoint = (result = {}) => {
    const sample = result.sample || {};
    const point = buildPointMeta(sample.samplingPoint);
    const productionContextData = sample.productionContextData && typeof sample.productionContextData === 'object' && !Array.isArray(sample.productionContextData)
        ? sample.productionContextData
        : {};
    const valueText = normalizeOptionalText(result.valueText) || null;
    const value = Number.isFinite(result.value) ? result.value : null;
    const timestamp = sample.takenAt ? new Date(sample.takenAt).getTime() : null;

    return {
        key: `${result.sampleId || 'sample'}:${result.parameterId || 'parameter'}`,
        sampleId: result.sampleId || null,
        sampleNumber: sample.sampleNumber || null,
        date: sample.takenAt || null,
        timestamp,
        value,
        valueText,
        isDetected: result.isDetected ?? null,
        isCompliant: result.isCompliant ?? null,
        notes: normalizeOptionalText(result.notes) || null,
        point,
        workflowType: sample.workflowType || null,
        workContext: sample.workContext || null,
        shift: sample.shift || null,
        laboratoryProfile: sample.laboratoryProfile || null,
        lotNumber: normalizeOptionalText(sample.lotNumber) || null,
        batchCode: normalizeOptionalText(sample.batchCode) || null,
        zoneName: sample.zoneName || point.zoneName || null,
        processArea: point.processArea || null,
        entityType: normalizeOptionalText(productionContextData.entityType) || null,
        entityLabel: normalizeOptionalText(productionContextData.entityLabel) || null,
        isCensored: Boolean(valueText && /^[<>~≤≥]/.test(valueText)),
        qualifier: valueText && /^[<>~≤≥]/.test(valueText) ? valueText.trim().charAt(0) : null
    };
};

const buildDecoratedDataPoint = (rawPoint, dataKind) => ({
    ...rawPoint,
    chartValue: dataKind === 'qualitative'
        ? (rawPoint.isDetected === true ? 1 : rawPoint.isDetected === false ? 0 : null)
        : rawPoint.value,
    displayValue: buildDisplayValue(rawPoint, dataKind),
    statusTone: rawPoint.isCompliant === false || rawPoint.isDetected === true
        ? 'critical'
        : rawPoint.isCompliant === true || rawPoint.isDetected === false
            ? 'ok'
            : 'neutral'
});

const getLatestDataPoint = (dataPoints = []) => (
    [...dataPoints].sort(compareDataPoints).at(-1) || null
);

const buildSeriesSummary = ({ parameter, point, rawPoints = [] } = {}) => {
    const dataKind = detectDataKind({ parameter, rawPoints });
    const dataPoints = rawPoints
        .map(rawPoint => buildDecoratedDataPoint(rawPoint, dataKind))
        .sort(compareDataPoints);
    const numericValues = dataPoints
        .map(dataPoint => dataPoint.chartValue)
        .filter(value => Number.isFinite(value));
    const latestDataPoint = getLatestDataPoint(dataPoints);
    const evaluatedResults = dataPoints.filter(dataPoint => dataPoint.isCompliant !== null).length;
    const compliantResults = dataPoints.filter(dataPoint => dataPoint.isCompliant === true).length;
    const nonCompliantResults = dataPoints.filter(dataPoint => dataPoint.isCompliant === false).length;
    const detectedCount = dataPoints.filter(dataPoint => dataPoint.isDetected === true).length;
    const absentCount = dataPoints.filter(dataPoint => dataPoint.isDetected === false).length;
    const inconclusiveCount = dataPoints.length - detectedCount - absentCount;
    const recordCount = dataPoints.length;
    const scaleRecommendation = buildScaleRecommendation({ dataKind, values: numericValues });

    return {
        key: `${parameter?.id || parameter?.code || 'parameter'}::${point?.id || point?.code || 'point'}`,
        parameter,
        point,
        dataKind,
        qualitative: dataKind === 'qualitative',
        hasCriteria: hasConfiguredMicroCriteria(parameter),
        chartRecommendation: {
            ...scaleRecommendation,
            yAxisLabel: dataKind === 'qualitative' ? 'Resultado cualitativo' : (parameter?.unit || 'Valor')
        },
        recordCount,
        evaluatedResults,
        compliantResults,
        nonCompliantResults,
        resultsWithoutCriteria: recordCount - evaluatedResults,
        evaluationCoverageRate: recordCount > 0 ? roundNumber((evaluatedResults / recordCount) * 100, 1) : null,
        complianceRate: evaluatedResults > 0 ? roundNumber((compliantResults / evaluatedResults) * 100, 1) : null,
        detectedCount,
        absentCount,
        inconclusiveCount,
        detectionRate: recordCount > 0 ? roundNumber((detectedCount / recordCount) * 100, 1) : null,
        latestCapture: latestDataPoint?.date || null,
        latestValue: latestDataPoint?.chartValue ?? null,
        latestDisplayValue: latestDataPoint?.displayValue ?? null,
        latestSampleNumber: latestDataPoint?.sampleNumber || null,
        minValue: dataKind === 'quantitative' && numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxValue: dataKind === 'quantitative' && numericValues.length > 0 ? Math.max(...numericValues) : null,
        avgValue: dataKind === 'quantitative' && numericValues.length > 0
            ? roundNumber(numericValues.reduce((accumulator, value) => accumulator + value, 0) / numericValues.length, 2)
            : null,
        contexts: {
            workflowTypes: buildDistinctValues(dataPoints, dataPoint => dataPoint.workflowType),
            workContexts: buildDistinctValues(dataPoints, dataPoint => dataPoint.workContext),
            shifts: buildDistinctValues(dataPoints, dataPoint => dataPoint.shift),
            laboratoryProfiles: buildDistinctValues(dataPoints, dataPoint => dataPoint.laboratoryProfile),
            entityTypes: buildDistinctValues(dataPoints, dataPoint => dataPoint.entityType),
            entityLabels: buildDistinctValues(dataPoints, dataPoint => dataPoint.entityLabel)
        },
        dataPoints
    };
};

const buildComparisonGroup = ({ parameter, series = [] } = {}) => {
    const orderedSeries = [...series].sort(compareSeries);
    const allDataPoints = orderedSeries.flatMap(item => item.dataPoints || []);
    const dataKind = orderedSeries[0]?.dataKind || detectDataKind({ parameter, rawPoints: allDataPoints });
    const numericValues = allDataPoints
        .map(dataPoint => dataPoint.chartValue)
        .filter(value => Number.isFinite(value));
    const latestDataPoint = getLatestDataPoint(allDataPoints);
    const scaleRecommendation = buildScaleRecommendation({ dataKind, values: numericValues });
    const totalRecords = allDataPoints.length;
    const detectedCount = allDataPoints.filter(dataPoint => dataPoint.isDetected === true).length;
    const absentCount = allDataPoints.filter(dataPoint => dataPoint.isDetected === false).length;
    const pointSummaries = orderedSeries.map(item => ({
        seriesKey: item.key,
        point: item.point,
        recordCount: item.recordCount,
        latestCapture: item.latestCapture,
        latestValue: item.latestValue,
        latestDisplayValue: item.latestDisplayValue,
        latestSampleNumber: item.latestSampleNumber,
        detectedCount: item.detectedCount,
        absentCount: item.absentCount,
        inconclusiveCount: item.inconclusiveCount,
        detectionRate: item.detectionRate,
        minValue: item.minValue,
        maxValue: item.maxValue,
        avgValue: item.avgValue,
        complianceRate: item.complianceRate
    }));

    return {
        key: parameter?.id || parameter?.code || 'parameter',
        parameter,
        dataKind,
        qualitative: dataKind === 'qualitative',
        hasCriteria: hasConfiguredMicroCriteria(parameter),
        chartRecommendation: {
            ...scaleRecommendation,
            yAxisLabel: dataKind === 'qualitative' ? '% de resultados' : (parameter?.unit || 'Valor')
        },
        pointCount: orderedSeries.length,
        totalRecords,
        latestCapture: latestDataPoint?.date || null,
        latestDisplayValue: latestDataPoint?.displayValue ?? null,
        latestSampleNumber: latestDataPoint?.sampleNumber || null,
        detectedCount,
        absentCount,
        inconclusiveCount: totalRecords - detectedCount - absentCount,
        detectionRate: totalRecords > 0 ? roundNumber((detectedCount / totalRecords) * 100, 1) : null,
        minValue: dataKind === 'quantitative' && numericValues.length > 0 ? Math.min(...numericValues) : null,
        maxValue: dataKind === 'quantitative' && numericValues.length > 0 ? Math.max(...numericValues) : null,
        processAreas: buildDistinctValues(orderedSeries, item => item.point?.processArea),
        workContexts: buildDistinctValues(allDataPoints, dataPoint => dataPoint.workContext),
        laboratoryProfiles: buildDistinctValues(allDataPoints, dataPoint => dataPoint.laboratoryProfile),
        pointSummaries,
        series: orderedSeries
    };
};

const buildTrendSummary = ({ trends = [], comparisonGroups = [] } = {}) => {
    const allDataPoints = trends.flatMap(trend => trend.dataPoints || []);
    const latestDataPoint = getLatestDataPoint(allDataPoints);
    const evaluatedCount = allDataPoints.filter(dataPoint => dataPoint.isCompliant !== null).length;

    return {
        seriesCount: trends.length,
        comparisonGroupCount: comparisonGroups.length,
        totalRecords: allDataPoints.length,
        pointsCovered: new Set(trends.map(trend => trend.point?.id || trend.point?.code).filter(Boolean)).size,
        quantitativeSeriesCount: trends.filter(trend => trend.dataKind === 'quantitative').length,
        qualitativeSeriesCount: trends.filter(trend => trend.dataKind === 'qualitative').length,
        criteriaReadySeriesCount: trends.filter(trend => trend.hasCriteria).length,
        evaluatedCount,
        resultsWithoutCriteria: allDataPoints.length - evaluatedCount,
        latestCapture: latestDataPoint?.date || null,
        latestSampleNumber: latestDataPoint?.sampleNumber || null
    };
};

const buildMicroTrendPayload = ({ results = [] } = {}) => {
    const groupedSeries = new Map();

    results.forEach(result => {
        const parameter = buildParameterMeta(result.parameter);
        const point = buildPointMeta(result.sample?.samplingPoint);
        const key = `${parameter.id || parameter.code || 'parameter'}::${point.id || point.code || 'point'}`;
        const current = groupedSeries.get(key) || {
            key,
            parameter,
            point,
            rawPoints: []
        };

        current.rawPoints.push(buildRawDataPoint(result));
        groupedSeries.set(key, current);
    });

    const trends = Array.from(groupedSeries.values())
        .map(series => buildSeriesSummary(series))
        .sort((left, right) => (
            `${left?.parameter?.name || ''}`.localeCompare(`${right?.parameter?.name || ''}`)
            || compareSeries(left, right)
        ));

    const comparisonSeries = new Map();
    trends.forEach(trend => {
        const key = trend.parameter?.id || trend.parameter?.code || trend.key;
        const current = comparisonSeries.get(key) || {
            parameter: trend.parameter,
            series: []
        };

        current.series.push(trend);
        comparisonSeries.set(key, current);
    });

    const comparisonGroups = Array.from(comparisonSeries.values())
        .map(group => buildComparisonGroup(group))
        .sort((left, right) => `${left?.parameter?.name || ''}`.localeCompare(`${right?.parameter?.name || ''}`));

    return {
        summary: buildTrendSummary({ trends, comparisonGroups }),
        trends,
        comparisonGroups
    };
};

module.exports = {
    buildMicroTrendPayload
};

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    LogarithmicScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    LogarithmicScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const DATE_TICK_FORMATTER = new Intl.DateTimeFormat('es-CO', {
    month: 'short',
    day: 'numeric'
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
});

const NUMBER_FORMATTER = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 2
});

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('es-CO', {
    notation: 'compact',
    maximumFractionDigits: 1
});

const DAY_MS = 24 * 60 * 60 * 1000;

export const TREND_COLORS = [
    'rgb(8, 145, 178)',
    'rgb(234, 88, 12)',
    'rgb(37, 99, 235)',
    'rgb(22, 163, 74)',
    'rgb(217, 119, 6)',
    'rgb(220, 38, 38)',
    'rgb(14, 165, 233)',
    'rgb(126, 34, 206)'
];

export const formatShortDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : DATE_TICK_FORMATTER.format(date);
};

export const formatDateTimeLabel = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMATTER.format(date);
};

export const formatValueLabel = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return `${value}`;
    if (!Number.isFinite(value)) return '—';
    return Math.abs(value) >= 1000 ? COMPACT_NUMBER_FORMATTER.format(value) : NUMBER_FORMATTER.format(value);
};

export const formatSpecText = (parameter = {}) => {
    if (parameter.specText) return parameter.specText;

    if (parameter.specMin !== null && parameter.specMin !== undefined && parameter.specMax !== null && parameter.specMax !== undefined) {
        return `m: ${formatValueLabel(parameter.specMin)} · M: ${formatValueLabel(parameter.specMax)}`;
    }

    if (parameter.specMax !== null && parameter.specMax !== undefined) {
        return `Límite: ${formatValueLabel(parameter.specMax)}`;
    }

    return 'Sin criterio configurado';
};

export const getDataKindLabel = (dataKind) => (
    dataKind === 'qualitative' ? 'Cualitativo' : 'Cuantitativo'
);

export const getSeriesChartLabel = (item = {}) => {
    if (item.dataKind === 'qualitative') return 'Barras binarias';
    if (item.chartRecommendation?.useLogScale) return 'Línea logarítmica';
    return 'Línea temporal';
};

export const getComparisonChartLabel = (item = {}) => {
    if (item.chartRecommendation?.comparisonMode === 'detection-rate') return 'Barras 100% apiladas';
    if (item.chartRecommendation?.useLogScale) return 'Comparativo logarítmico';
    return 'Comparativo temporal';
};

export const formatContextList = (values = []) => (
    values && values.length > 0 ? values.join(' · ') : '—'
);

const resolveObservationColor = (baseColor, observation = {}) => {
    if (observation.isDetected === true || observation.isCompliant === false) return 'rgb(220, 38, 38)';
    if (observation.isDetected === false || observation.isCompliant === true) return 'rgb(22, 163, 74)';
    return baseColor;
};

const buildReferenceDataset = ({ label, value, color, timestamps = [] }) => {
    if (value === null || value === undefined) return null;

    const uniqueTimestamps = Array.from(new Set(
        timestamps.filter(timestamp => Number.isFinite(timestamp))
    )).sort((left, right) => left - right);

    if (uniqueTimestamps.length === 0) return null;

    const firstTimestamp = uniqueTimestamps[0];
    const lastTimestamp = uniqueTimestamps.at(-1);
    const referencePoints = firstTimestamp === lastTimestamp
        ? [
            { x: firstTimestamp - (DAY_MS / 2), y: value },
            { x: lastTimestamp + (DAY_MS / 2), y: value }
        ]
        : [
            { x: firstTimestamp, y: value },
            { x: lastTimestamp, y: value }
        ];

    return {
        label,
        data: referencePoints,
        borderColor: color,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
        spanGaps: true,
        isThreshold: true
    };
};

const buildThresholdDatasets = (parameter = {}, timestamps = []) => {
    const datasets = [];

    if (parameter.specMin !== null && parameter.specMin !== undefined) {
        const dataset = buildReferenceDataset({
            label: `Límite m (${formatValueLabel(parameter.specMin)})`,
            value: parameter.specMin,
            color: 'rgba(234, 179, 8, 0.9)',
            timestamps
        });
        if (dataset) datasets.push(dataset);
    }

    if (parameter.specMax !== null && parameter.specMax !== undefined) {
        const dataset = buildReferenceDataset({
            label: `Límite M (${formatValueLabel(parameter.specMax)})`,
            value: parameter.specMax,
            color: 'rgba(220, 38, 38, 0.7)',
            timestamps
        });
        if (dataset) datasets.push(dataset);
    }

    return datasets;
};

const buildObservationLines = (raw = {}) => {
    const lines = [];

    if (raw.displayValue !== null && raw.displayValue !== undefined && raw.displayValue !== '') {
        lines.push(`Resultado: ${formatValueLabel(raw.displayValue)}`);
    }
    if (raw.sampleNumber) lines.push(`Muestra: ${raw.sampleNumber}`);
    if (raw.point?.code) lines.push(`Punto: ${raw.point.code}`);
    if (raw.processArea) lines.push(`Área: ${raw.processArea}`);
    if (raw.lotNumber) lines.push(`Lote: ${raw.lotNumber}`);
    if (raw.workflowType) lines.push(`Flujo: ${raw.workflowType}`);
    if (raw.isCensored && raw.valueText) lines.push(`Reporte: ${raw.valueText}`);
    if (raw.isCompliant === true) lines.push('Conforme');
    if (raw.isCompliant === false) lines.push('No conforme');

    return lines;
};

const buildTimeScale = (title) => ({
    type: 'linear',
    title: {
        display: true,
        text: title,
        font: { size: 11 }
    },
    ticks: {
        callback: (value) => formatShortDate(Number(value)),
        maxTicksLimit: 8
    },
    grid: {
        display: false
    }
});

const buildNumericYAxis = (item = {}) => ({
    type: item.chartRecommendation?.useLogScale ? 'logarithmic' : 'linear',
    beginAtZero: !item.chartRecommendation?.useLogScale,
    title: {
        display: true,
        text: item.chartRecommendation?.useLogScale
            ? `${item.parameter?.unit || 'Valor'} (escala log)`
            : (item.parameter?.unit || 'Valor'),
        font: { size: 11 }
    },
    ticks: {
        callback: (value) => formatValueLabel(Number(value))
    },
    grid: {
        color: 'rgba(148, 163, 184, 0.16)'
    }
});

export const buildSeriesChartModel = (series, color) => {
    if (series.dataKind === 'qualitative') {
        const dataset = {
            label: series.point?.code || series.parameter?.name,
            data: (series.dataPoints || []).map(dataPoint => ({
                x: dataPoint.sampleNumber || formatShortDate(dataPoint.date),
                y: dataPoint.chartValue,
                ...dataPoint
            })),
            backgroundColor: (series.dataPoints || []).map(dataPoint => resolveObservationColor(color, dataPoint)),
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 44
        };

        return {
            type: 'bar',
            data: {
                datasets: [dataset]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const raw = items[0]?.raw || {};
                                return `${raw.sampleNumber || 'Resultado'} · ${formatShortDate(raw.date)}`;
                            },
                            label: (context) => {
                                const raw = context.raw || {};
                                return `${context.dataset.label}: ${raw.displayValue || 'Sin dato'}`;
                            },
                            afterLabel: (context) => buildObservationLines(context.raw || {})
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'category',
                        title: {
                            display: true,
                            text: 'Muestra',
                            font: { size: 11 }
                        },
                        grid: { display: false }
                    },
                    y: {
                        min: -0.1,
                        max: 1.1,
                        ticks: {
                            stepSize: 1,
                            callback: (value) => {
                                if (Number(value) === 0) return 'Ausente';
                                if (Number(value) === 1) return 'Detectado';
                                return '';
                            }
                        },
                        title: {
                            display: true,
                            text: 'Resultado cualitativo',
                            font: { size: 11 }
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.16)'
                        }
                    }
                }
            }
        };
    }

    const numericPoints = (series.dataPoints || [])
        .filter(dataPoint => Number.isFinite(dataPoint.chartValue))
        .map(dataPoint => ({
            x: dataPoint.timestamp,
            y: dataPoint.chartValue,
            ...dataPoint
        }));
    const timestamps = numericPoints.map(point => point.x);
    const datasets = [
        {
            label: series.point?.code || series.parameter?.name,
            data: numericPoints,
            borderColor: color,
            backgroundColor: `${color}1A`,
            fill: false,
            tension: 0.22,
            pointRadius: numericPoints.map(dataPoint => (dataPoint.isCensored ? 5 : 4)),
            pointHoverRadius: 6,
            pointStyle: numericPoints.map(dataPoint => (dataPoint.isCensored ? 'triangle' : 'circle')),
            pointBackgroundColor: numericPoints.map(dataPoint => resolveObservationColor(color, dataPoint)),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: true
        },
        ...buildThresholdDatasets(series.parameter, timestamps)
    ];

    return {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: datasets.length > 1,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 18,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const raw = items[0]?.raw || {};
                            return formatDateTimeLabel(raw.date || items[0]?.parsed?.x);
                        },
                        label: (context) => {
                            if (context.dataset.isThreshold) {
                                return `${context.dataset.label}: ${formatValueLabel(context.parsed.y)}`;
                            }

                            const raw = context.raw || {};
                            return `${context.dataset.label}: ${formatValueLabel(raw.displayValue ?? context.parsed.y)}`;
                        },
                        afterLabel: (context) => (
                            context.dataset.isThreshold ? '' : buildObservationLines(context.raw || {})
                        )
                    }
                }
            },
            scales: {
                x: buildTimeScale('Fecha de muestra'),
                y: buildNumericYAxis(series)
            }
        }
    };
};

export const buildComparisonChartModel = (group) => {
    if (group.dataKind === 'qualitative') {
        const pointSummaries = group.pointSummaries || [];
        const labels = pointSummaries.map(summary => [
            summary.point?.code || 'Sin punto',
            summary.point?.processArea || summary.point?.name || ''
        ]);

        return {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Ausente',
                        data: pointSummaries.map(summary => (
                            summary.recordCount > 0
                                ? Number((((summary.absentCount || 0) / summary.recordCount) * 100).toFixed(1))
                                : 0
                        )),
                        backgroundColor: 'rgba(22, 163, 74, 0.88)',
                        borderRadius: 10,
                        borderSkipped: false,
                        stack: 'distribution'
                    },
                    {
                        label: 'Detectado',
                        data: pointSummaries.map(summary => (
                            summary.recordCount > 0
                                ? Number((((summary.detectedCount || 0) / summary.recordCount) * 100).toFixed(1))
                                : 0
                        )),
                        backgroundColor: 'rgba(220, 38, 38, 0.85)',
                        borderRadius: 10,
                        borderSkipped: false,
                        stack: 'distribution'
                    },
                    {
                        label: 'Sin dato',
                        data: pointSummaries.map(summary => (
                            summary.recordCount > 0
                                ? Number((((summary.inconclusiveCount || 0) / summary.recordCount) * 100).toFixed(1))
                                : 0
                        )),
                        backgroundColor: 'rgba(148, 163, 184, 0.8)',
                        borderRadius: 10,
                        borderSkipped: false,
                        stack: 'distribution'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 18,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const summary = pointSummaries[items[0]?.dataIndex];
                                return `${summary?.point?.code || 'Sin punto'} · ${summary?.point?.name || ''}`;
                            },
                            label: (context) => `${context.dataset.label}: ${formatValueLabel(context.parsed.y)}%`,
                            afterLabel: (context) => {
                                const summary = pointSummaries[context.dataIndex];
                                if (!summary) return '';

                                return [
                                    `Registros: ${summary.recordCount || 0}`,
                                    `Detectado: ${summary.detectedCount || 0}`,
                                    `Ausente: ${summary.absentCount || 0}`,
                                    `Sin dato: ${summary.inconclusiveCount || 0}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        title: {
                            display: true,
                            text: 'Puntos comparables',
                            font: { size: 11 }
                        }
                    },
                    y: {
                        stacked: true,
                        min: 0,
                        max: 100,
                        ticks: {
                            callback: (value) => `${value}%`
                        },
                        title: {
                            display: true,
                            text: '% de resultados',
                            font: { size: 11 }
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.16)'
                        }
                    }
                }
            }
        };
    }

    const series = group.series || [];
    const datasets = series.map((seriesItem, index) => {
        const color = TREND_COLORS[index % TREND_COLORS.length];
        const numericPoints = (seriesItem.dataPoints || [])
            .filter(dataPoint => Number.isFinite(dataPoint.chartValue))
            .map(dataPoint => ({
                x: dataPoint.timestamp,
                y: dataPoint.chartValue,
                ...dataPoint
            }));

        return {
            label: seriesItem.point?.code || seriesItem.point?.name || `Serie ${index + 1}`,
            data: numericPoints,
            borderColor: color,
            backgroundColor: `${color}14`,
            fill: false,
            tension: 0.2,
            pointRadius: numericPoints.map(dataPoint => (dataPoint.isCensored ? 5 : 4)),
            pointHoverRadius: 6,
            pointStyle: numericPoints.map(dataPoint => (dataPoint.isCensored ? 'triangle' : 'circle')),
            pointBackgroundColor: numericPoints.map(dataPoint => resolveObservationColor(color, dataPoint)),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: true
        };
    });

    const timestamps = series.flatMap(seriesItem => (
        (seriesItem.dataPoints || []).map(dataPoint => dataPoint.timestamp)
    ));

    const thresholdDatasets = buildThresholdDatasets(group.parameter, timestamps);
    const mergedDatasets = [...datasets, ...thresholdDatasets];

    return {
        type: 'line',
        data: { datasets: mergedDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 18,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const raw = items[0]?.raw || {};
                            return formatDateTimeLabel(raw.date || items[0]?.parsed?.x);
                        },
                        label: (context) => {
                            if (context.dataset.isThreshold) {
                                return `${context.dataset.label}: ${formatValueLabel(context.parsed.y)}`;
                            }

                            const raw = context.raw || {};
                            return `${context.dataset.label}: ${formatValueLabel(raw.displayValue ?? context.parsed.y)}`;
                        },
                        afterLabel: (context) => (
                            context.dataset.isThreshold ? '' : buildObservationLines(context.raw || {})
                        )
                    }
                }
            },
            scales: {
                x: buildTimeScale('Fecha compartida de muestreo'),
                y: buildNumericYAxis(group)
            }
        }
    };
};

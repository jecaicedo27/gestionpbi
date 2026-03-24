const { PrismaClient } = require('@prisma/client');
const {
    deriveScheduleEntryStatus,
    normalizeOptionalText
} = require('../services/microLabService');

const prisma = new PrismaClient();

const hasConfiguredCriteria = (parameter = {}) => (
    (parameter.specMin !== null && parameter.specMin !== undefined)
    || (parameter.specMax !== null && parameter.specMax !== undefined)
    || Boolean(normalizeOptionalText(parameter.specText))
);

const hasPhotoEvidence = (sample = {}) => (
    (sample.attachments || []).some(attachment => (
        attachment.category === 'PHOTO'
        || attachment.mimeType?.startsWith('image/')
        || /\.(png|jpe?g|webp|heic|heif)$/i.test(attachment.originalName || '')
    ))
);

async function main() {
    const [points, parameters, samples, scheduleEntries] = await Promise.all([
        prisma.microSamplingPoint.findMany({
            include: {
                _count: {
                    select: {
                        samples: true,
                        scheduleEntries: true
                    }
                }
            },
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }]
        }),
        prisma.microParameter.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' }
        }),
        prisma.microSample.findMany({
            include: {
                samplingPoint: { select: { code: true, name: true } },
                results: { include: { parameter: true } },
                attachments: true,
                scheduleEntry: true
            },
            orderBy: { takenAt: 'desc' }
        }),
        prisma.microScheduleEntry.findMany({
            include: {
                samplingPoint: { select: { code: true, name: true } },
                sample: { select: { id: true, status: true, workflowType: true } }
            },
            orderBy: [{ plannedDate: 'desc' }, { plannedTime: 'desc' }]
        })
    ]);

    const parametersWithoutCriteria = parameters.filter(parameter => !hasConfiguredCriteria(parameter));
    const externalSamples = samples.filter(sample => sample.workflowType !== 'INTERNAL');
    const externalWithoutPhotoEvidence = externalSamples.filter(sample => !hasPhotoEvidence(sample));
    const samplesWithoutSchedule = samples.filter(sample => !sample.scheduleEntry);
    const samplesWithoutReport = samples.filter(sample => !sample.attachments.some(attachment => attachment.category === 'LAB_REPORT'));
    const resultsWithoutCriteria = samples.flatMap(sample => (
        (sample.results || [])
            .filter(result => result.isCompliant === null)
            .map(result => ({
                sampleNumber: sample.sampleNumber,
                pointCode: sample.samplingPoint?.code || 'SIN-PUNTO',
                parameterCode: result.parameter?.code || 'SIN-PARAMETRO'
            }))
    ));

    const scheduleAudit = scheduleEntries.reduce((summary, entry) => {
        const derivedStatus = deriveScheduleEntryStatus(entry.sample, entry);
        summary[derivedStatus] = (summary[derivedStatus] || 0) + 1;
        return summary;
    }, {});

    const pointCoverage = points.map(point => ({
        code: point.code,
        zoneCode: point.zoneCode,
        isActive: point.isActive,
        samples: point._count.samples,
        scheduleEntries: point._count.scheduleEntries
    }));

    const report = {
        generatedAt: new Date().toISOString(),
        counts: {
            points: points.length,
            activePoints: points.filter(point => point.isActive).length,
            parameters: parameters.length,
            samples: samples.length,
            scheduleEntries: scheduleEntries.length
        },
        integrity: {
            parametersWithoutCriteria: parametersWithoutCriteria.map(parameter => ({
                code: parameter.code,
                name: parameter.name
            })),
            externalSamplesWithoutPhotoEvidence: {
                count: externalWithoutPhotoEvidence.length,
                sampleNumbers: externalWithoutPhotoEvidence.slice(0, 20).map(sample => sample.sampleNumber)
            },
            samplesWithoutSchedule: {
                count: samplesWithoutSchedule.length,
                sampleNumbers: samplesWithoutSchedule.slice(0, 20).map(sample => sample.sampleNumber)
            },
            samplesWithoutReport: {
                count: samplesWithoutReport.length,
                sampleNumbers: samplesWithoutReport.slice(0, 20).map(sample => sample.sampleNumber)
            },
            resultsWithoutCriteria: {
                count: resultsWithoutCriteria.length,
                examples: resultsWithoutCriteria.slice(0, 20)
            }
        },
        schedule: {
            derivedStatusSummary: scheduleAudit
        },
        points: pointCoverage
    };

    console.log(JSON.stringify(report, null, 2));
}

main()
    .catch(async (error) => {
        console.error('Micro audit failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

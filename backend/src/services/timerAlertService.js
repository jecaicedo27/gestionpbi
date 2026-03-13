/**
 * timerAlertService.js — Cron that checks for expired production timers
 * and pushes alerts to all connected frontend clients via Socket.IO.
 *
 * Checks every 15 seconds for:
 * - Cocción timers: processParameters.timerState.startedAt + timerMinutes
 * - Esferificación timers if needed (future)
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

function startTimerAlertCron(io) {
    if (!io) {
        logger.warn('⏰ Timer Alert Service: No io instance, skipping');
        return;
    }

    logger.info('⏰ Timer Alert Service: Started (every 15s)');

    setInterval(async () => {
        try {
            // Find all EXECUTING assembly notes
            const executingNotes = await prisma.assemblyNote.findMany({
                where: { status: 'EXECUTING' },
                select: {
                    id: true,
                    noteNumber: true,
                    stageName: true,
                    processParameters: true,
                    productionBatch: {
                        select: {
                            batchNumber: true,
                            flavor: true,
                        }
                    }
                }
            });

            for (const note of executingNotes) {
                const params = note.processParameters || {};

                // ── Check cocción timer ──
                const ts = params.timerState;
                if (ts && ts.startedAt && !ts.acknowledged && !ts.globalAlerted) {
                    const timerMinutes = params.timerMinutes || 0;
                    if (timerMinutes > 0) {
                        const elapsed = (Date.now() - ts.startedAt) / 1000;
                        const durationSec = timerMinutes * 60;
                        if (elapsed >= durationSec) {
                            // Timer expired! Emit global alert
                            const alertPayload = {
                                noteId: note.id,
                                noteNumber: note.noteNumber,
                                batchNumber: note.productionBatch?.batchNumber || '',
                                flavor: note.productionBatch?.flavor || '',
                                stageName: note.stageName || '',
                                alertType: 'COCCION',
                                targetTemp: params.targetTemperature || '',
                                tempUnit: params.temperatureUnit || '°C',
                                timerMinutes,
                                timestamp: new Date().toISOString(),
                            };

                            io.emit('production:timer-alarm', alertPayload);

                            // ── Web Push notification (works even with screen locked) ──
                            try {
                                const { sendPushToAll } = require('./webPushService');
                                const pushTypeName = alertPayload.alertType === 'COCCION'
                                    ? `Cocción ${alertPayload.targetTemp}${alertPayload.tempUnit} · ${alertPayload.timerMinutes} min`
                                    : 'Timer finalizado';
                                sendPushToAll({
                                    title: '🔔 ¡TIEMPO COMPLETADO!',
                                    body: `${pushTypeName}\n${alertPayload.batchNumber} ${alertPayload.flavor || ''} — ${alertPayload.stageName}`,
                                    tag: `timer-${note.id}`,
                                    data: { noteId: note.id, url: `/assembly-execution/${note.id}` },
                                });
                            } catch (pushErr) {
                                logger.warn(`Push send error: ${pushErr.message}`);
                            }
                            logger.info(`🔔 Timer Alert: Cocción expired for ${note.noteNumber} (${note.productionBatch?.flavor})`);

                            // Mark as globally alerted to prevent re-emitting
                            await prisma.assemblyNote.update({
                                where: { id: note.id },
                                data: {
                                    processParameters: {
                                        ...params,
                                        timerState: { ...ts, globalAlerted: true }
                                    }
                                }
                            });
                        }
                    }
                }

                // ── Check esferificación timer (if running for too long, optional future) ──
                // Currently esferificación doesn't have a fixed duration,
                // so no automatic alarm. Could add one if needed.
            }
        } catch (err) {
            // Don't crash the cron, just log
            if (!String(err.message).includes('ECONNREFUSED')) {
                logger.error(`⏰ Timer Alert cron error: ${err.message}`);
            }
        }
    }, 15000); // every 15 seconds

    // ── Listen for acknowledgment from any client ──
    io.on('connection', (socket) => {
        socket.on('production:timer-ack', async (data) => {
            try {
                const { noteId } = data || {};
                if (!noteId) return;

                const note = await prisma.assemblyNote.findUnique({
                    where: { id: noteId },
                    select: { processParameters: true }
                });
                if (!note) return;

                const params = note.processParameters || {};
                const ts = params.timerState || {};

                await prisma.assemblyNote.update({
                    where: { id: noteId },
                    data: {
                        processParameters: {
                            ...params,
                            timerState: { ...ts, acknowledged: true, globalAlerted: true }
                        }
                    }
                });

                // Notify all clients to dismiss this alarm
                io.emit('production:timer-dismissed', { noteId });
                logger.info(`🔔 Timer Alert: Acknowledged for note ${noteId}`);
            } catch (err) {
                logger.error(`Timer ack error: ${err.message}`);
            }
        });
    });
}

module.exports = { startTimerAlertCron };

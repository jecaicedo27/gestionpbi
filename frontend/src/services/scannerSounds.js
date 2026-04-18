/**
 * scannerSounds.js — Web Audio API beeps for the picking scanner
 *
 * SUCCESS: short high-pitch beep  (like a real barcode gun)
 * ERROR:   two low-pitch beeps    (warning / item already done / overcount)
 */

let _ctx = null;

function getCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
}

function beep(frequency, duration, volume = 0.4, type = 'square') {
    try {
        const ctx = getCtx();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration);
    } catch {
        /* AudioContext unavailable in some environments — fail silently */
    }
}

/** Single high-pitched beep — scan accepted ✅ */
export function playSuccess() {
    beep(1200, 0.12, 0.35, 'square');
}

/** Double low-pitched beep — scan rejected / already complete ❌ */
export function playError() {
    beep(300, 0.15, 0.4, 'square');
    setTimeout(() => beep(300, 0.15, 0.4, 'square'), 220);
}

/** Ascending three-note fanfare — item just reached 100%! 🎉 */
export function playItemComplete() {
    beep(800, 0.12, 0.45, 'square');
    setTimeout(() => beep(1050, 0.12, 0.45, 'square'), 150);
    setTimeout(() => beep(1400, 0.25, 0.5, 'square'), 300);
}

/** Descending two-tone alarm — item already 100% complete, don't scan more ⚠️ */
export function playAlreadyDone() {
    beep(800, 0.18, 0.5, 'square');
    setTimeout(() => beep(250, 0.25, 0.5, 'square'), 220);
}

/** Urgent triple-beep alarm — stock in wrong zone, needs transfer 🔶 */
export function playZoneWarning() {
    beep(600, 0.15, 0.5, 'square');
    setTimeout(() => beep(400, 0.15, 0.5, 'square'), 200);
    setTimeout(() => beep(600, 0.15, 0.5, 'square'), 400);
}

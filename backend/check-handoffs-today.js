const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const today = new Date('2026-04-15T00:00:00.000Z');
    const yesterday = new Date('2026-04-14T00:00:00.000Z');
    
    const handoffs = await prisma.shiftHandoff.findMany({
        where: { date: { in: [yesterday, today] } },
        include: {
            deliveredBy: { select: { name: true } },
            outgoingLeader: { select: { name: true } },
            incomingLeader: { select: { name: true } }
        },
        orderBy: { deliveredAt: 'asc' }
    });

    if (handoffs.length === 0) {
        console.log('❌ No se encontraron entregas para hoy ni ayer.');
        return prisma.$disconnect();
    }

    // Group by date + shift
    const groups = {};
    for (const h of handoffs) {
        const key = h.date.toISOString().split('T')[0] + '__' + h.outgoingShift;
        if (!groups[key]) groups[key] = [];
        groups[key].push(h);
    }

    for (const groupKey of Object.keys(groups)) {
        const items = groups[groupKey];
        const parts = groupKey.split('__');
        const dateStr = parts[0];
        const shift = parts[1];
        
        console.log('');
        console.log('══════════════════════════════════════════════════════════');
        console.log(`  📅 ${dateStr}  —  Turno saliente: ${shift}`);
        console.log('══════════════════════════════════════════════════════════');
        
        for (let i = 0; i < items.length; i++) {
            const h = items[i];
            const toCol = (d) => d ? new Date(d.getTime() - 5*3600000).toISOString().substring(11,19) : '—';
            const st = h.status === 'APPROVED' ? '✅' : h.status === 'PENDING_INCOMING' ? '🟡' : h.status === 'PENDING' ? '🟠' : '🔴';
            
            console.log('');
            console.log(`  ${i+1}. ${st} ${h.deliveredBy.name}`);
            console.log(`     Área: ${h.area}  |  Estado: ${h.status}`);
            console.log(`     Hora entrega: ${toCol(h.deliveredAt)}`);
            console.log(`     Líder saliente: ${h.outgoingLeader?.name || '—'}  (${toCol(h.outgoingLeaderAt)})`);
            console.log(`     Líder entrante: ${h.incomingLeader?.name || '—'}  (${toCol(h.incomingLeaderAt)})`);
            
            if (h.auditLog && Array.isArray(h.auditLog) && h.auditLog.length > 0) {
                console.log('     📋 Auditoría:');
                for (const a of h.auditLog) {
                    const at = new Date(new Date(a.at).getTime() - 5*3600000).toISOString().substring(11,19);
                    const ip = (a.ip || '—').substring(0, 25);
                    console.log(`       → ${a.action} por ${a.name} @ ${at} | IP: ${ip}`);
                }
            } else {
                console.log('     📋 Auditoría: (sin registro de auditoría)');
            }
        }
        
        const approved = items.filter(h => h.status === 'APPROVED').length;
        const pending = items.filter(h => h.status !== 'APPROVED').length;
        console.log('');
        console.log(`  📊 Resultado: ${approved}/${items.length} aprobadas` + (pending > 0 ? ` | ${pending} pendientes` : ' ✅ TODO COMPLETO'));
        console.log('──────────────────────────────────────────────────────────');
    }
    
    await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });

const fs = require('fs');
const file = '/var/www/gestionpbi/backend/src/controllers/kardexController.js';
let content = fs.readFileSync(file, 'utf8');

const anchor = `        // 3. Fetch AuditLogs (AUTO_RECONCILE)`;
const newCode = `        // 4. Fetch Assembly Outputs (INGRESO NATIVO)
        const productionOutputs = await prisma.assemblyNote.findMany({
            where: { productId, status: 'COMPLETED' },
            include: { completedBy: { select: { name: true } }, processType: { select: { name: true } } }
        });
        
        const formattedOutputs = productionOutputs.map(note => {
            // Only non-finished products natively enter production zone stock here
            return {
                id: note.id,
                date: note.completedAt || note.updatedAt,
                reference: \`Producción \${note.processType?.name || 'Ensamble'} # \${note.noteNumber}\`,
                user: note.completedBy?.name || 'Sistema',
                operation: 'INGRESO RESULTANTE',
                delta: Math.abs(note.actualQuantity || 0),
                type: 'NOTE_OUTPUT'
            };
        });

        // Combine and sort chronologically (oldest first for running balance)
        const allTransactions = [...formattedTransfers, ...formattedConsumptions, ...formattedAudits, ...formattedOutputs].sort((a, b) => new Date(a.date) - new Date(b.date));`;

if (content.includes(anchor)) {
    content = content.replace(`        // Combine and sort chronologically (oldest first for running balance)
        const allTransactions = [...formattedTransfers, ...formattedConsumptions, ...formattedAudits].sort((a, b) => new Date(a.date) - new Date(b.date));`, '');
    content = content.replace(anchor, newCode + '\n\n' + anchor);
    fs.writeFileSync(file, content, 'utf8');
    console.log('kardexController patched');
} else {
    console.log('anchor not found');
}

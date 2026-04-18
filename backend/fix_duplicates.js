const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Starting consolidation...");
    const sessions = await prisma.inventoryCountSession.findMany({
        where: { month: '2026-04' },
        include: { lines: true }
    });

    let mergedCount = 0;

    for (const session of sessions) {
        // Group lines by productId + lotNumber
        const groups = {};
        for (const line of session.lines) {
            const key = \`\${line.productId}-\${line.lotNumber}\`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(line);
        }

        for (const key in groups) {
            const lines = groups[key];
            if (lines.length > 1) {
                // We have duplicates!
                console.log(\`Found \${lines.length} duplicates for \${key} in session \${session.id}\`);
                
                // Sort by updated descending so we keep the most recent line's data if needed, but actually we SUM physicalQty?
                // Wait, if the user added 24, then 48, are they additive or was 48 the replacement that got inserted as duplicate?
                // The UI when you type in a box replaces the value. It DOES NOT ADD.
                // So the latest timestamp is the CORRECT final value!
                lines.sort((a, b) => b.updatedAt - a.updatedAt);
                
                const masterLine = lines[0]; // Most recent line is the correct intended amount by the user
                const linesToDelete = lines.slice(1);
                
                console.log(\`Keeping line \${masterLine.id} with qty \${masterLine.physicalQty}. Deleting \${linesToDelete.length} obsolete lines.\`);
                
                for (const delLine of linesToDelete) {
                    await prisma.inventoryCountLine.delete({ where: { id: delLine.id } });
                    mergedCount++;
                }
            }
        }
    }
    console.log(\`Done. Merged \${mergedCount} duplicates.\`);
}

main().catch(console.error).finally(() => prisma.\$disconnect());

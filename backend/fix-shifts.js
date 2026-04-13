const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const monday = new Date('2026-04-13T05:00:00.000Z');
    let week = await prisma.shiftWeek.findUnique({ where: { weekStart: monday } });
    if (!week) {
        week = await prisma.shiftWeek.create({
            data: { weekStart: monday, weekEnd: new Date('2026-04-19T04:59:59.999Z') }
        });
    }

    const employees = await prisma.shiftEmployee.findMany();
    const eMap = {};
    employees.forEach(e => {
        eMap[e.name.toLowerCase()] = e;
    });

    const findEmp = (search) => {
        const found = Object.values(eMap).find(e => e.name.toLowerCase().includes(search.toLowerCase()));
        if (!found) console.log('Not found:', search);
        return found;
    };

    const targetAssignments = [
        { search: 'Dubier', shift: 'MANANA' },
        { search: 'Gabriel', shift: 'MANANA' },
        { search: 'Francisco', shift: 'MANANA' },
        { search: 'Jhoan', shift: 'TARDE' },
        { search: 'Claudia', shift: 'TARDE' },
        { search: 'Yonathan', shift: 'TARDE' },
        { search: 'Luis Fernando', shift: 'TARDE' },
        { search: 'Drilly', shift: 'NOCHE' },
        { search: 'Kelvin', shift: 'NOCHE' },
        { search: 'Canchila', shift: 'NOCHE' },
        { search: 'Alberto', shift: 'MANANA' },
        { search: 'Melgizo', shift: 'TARDE' },
        { search: 'Carlos Mu', shift: 'NOCHE' },
        { search: 'David', shift: 'MANANA' },
        { search: 'Karen', shift: 'TARDE' },
        { search: 'Ximena', shift: 'NOCHE' },
        { search: 'Hugo', shift: 'DIURNO' },
        { search: 'Ledy', shift: 'DIURNO' }
    ];

    await prisma.shiftAssignment.deleteMany({ where: { weekId: week.id } });

    for (const a of targetAssignments) {
        const e = findEmp(a.search);
        if (e) {
            await prisma.shiftAssignment.create({
                data: {
                    weekId: week.id,
                    employeeId: e.id,
                    area: e.area,
                    shift: a.shift
                }
            });
            console.log('Assigned', e.name, 'to', a.shift);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());

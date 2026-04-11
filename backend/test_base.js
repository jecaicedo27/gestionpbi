const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const tmpl = await prisma.assemblyTemplate.findFirst({
        where: { product: { name: 'BASE SIROPE CLASICA' }, isActive: true },
        include: { stages: { include: { inputs: { include: { product: true } } } } }
    });
    console.log(tmpl ? tmpl.templateCode : 'Not found');
    if(tmpl) {
        tmpl.stages.forEach(s => {
            console.log(s.stageName);
            s.inputs.forEach(i => console.log('  ', i.product?.name, i.quantityPerUnit, i.unit));
        });
    }
}
main().finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const noteId = 'eaefad45-d02a-4663-bd14-01982abf8f75';
  const formula = await p.formula.findFirst({
      where: { product: { name: 'COMPUESTO COCO' }, isActive: true },
      include: { items: true, product: { select: { id: true, name: true } } }
  });
  if (!formula) {
      console.log('No encontré fórmula activa para COMPUESTO COCO');
      return;
  }

  const note = await p.assemblyNote.findUnique({ where: { id: noteId } });
  if (!note) return;

  let factor = 1;
  if (formula.baseQuantity && formula.baseQuantity > 0) {
      factor = note.targetQuantity / formula.baseQuantity;
  }

  await p.$transaction(async (tx) => {
      await tx.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: noteId } });

      for (const fItem of formula.items) {
          await tx.assemblyNoteItem.create({
              data: {
                  assemblyNoteId: noteId,
                  componentId: fItem.ingredientId,
                  componentType: fItem.ingredientType || 'RAW_MATERIAL',
                  plannedQuantity: fItem.quantity * factor,
                  unit: fItem.unit || 'gramo',
                  createdAt: new Date(),
              }
          });
      }
      
      await tx.assemblyNote.update({
          where: { id: noteId },
          data: { productId: formula.productId, stageName: 'Ensamble Siigo de ' + formula.product.name }
      });

      console.log('OK: Nota eaefad... actualizada a COCO con ' + formula.items.length + ' items.');
      console.log('Factor escala: ' + factor);
      
      const newItems = await tx.assemblyNoteItem.findMany({ where: { assemblyNoteId: noteId }, include: { component: { select: { name: true } } } });
      newItems.forEach(i => console.log(' - ' + i.component?.name + ': ' + i.plannedQuantity + ' ' + i.unit));
  });
}
main().catch(console.error).finally(() => p.$disconnect());

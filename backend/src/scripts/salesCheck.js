const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const dists = await p.user.findMany({ where: { role: 'DISTRIBUIDOR' }, select: { name: true, discountPercent: true } });
  const dm = {};
  dists.forEach(d => { dm[d.name] = d.discountPercent / 100; });

  const moves = await p.movement.findMany({
    where: { type: 'VTA', date: { gte: new Date('2025-01-01'), lt: new Date('2026-01-01') }, customerName: { not: null } },
    select: { quantity: true, customerName: true, product: { select: { price: true } } }
  });

  // Calculate per-distributor benefit
  const bc = {};
  for (const m of moves) {
    const name = m.customerName || '__NULL__';
    const bruto = (m.quantity || 0) * (m.product?.price || 0);
    const rate = dm[name] || 0;
    const marketRate = 0.25;
    const extraRate = Math.max(0, rate - marketRate);
    const benefit = bruto * extraRate;
    
    if (!(name in bc)) bc[name] = { bruto: 0, benefit: 0, rate, extraRate };
    bc[name].bruto += bruto;
    bc[name].benefit += benefit;
  }

  // Only distributors with discounts
  const distEntries = Object.entries(bc).filter(([_, v]) => v.rate > 0).sort((a, b) => b[1].benefit - a[1].benefit);

  // Ownership mapping (equity %)
  const OWNERSHIP = {
    'PERLAS EXPLOSIVAS COLOMBIA SAS': [
      { name: 'Jose Leandro Caicedo', equity: 19.1 },
      { name: 'Luis Guillermo Caicedo', equity: 19.1 },
      { name: 'Wilmer Javier Caicedo', equity: 19.1 },
      { name: 'Jhon Edisson Caicedo', equity: 19.1 },
    ],
    'TOPPING FROZEN': [{ name: 'Angelo Rojas', equity: 10.84 }],
    'ESFERAS EXPLOSIVAS': [{ name: 'Ines Benavides', equity: 4.0 }],
    'EXPLOSION DE SABORES': [
      { name: 'Tatiana Benavides', equity: 1.0 },
      { name: 'Marleni Benavides', equity: 1.0 },
      { name: 'Jose Alexander Cordoba', equity: 0.5 },
      { name: 'Cristian Daniel', equity: 0.5 },
      { name: 'Vicente Benavides', equity: 1.0 },
    ],
    'MARIBEL ERAZO': [{ name: 'Maribel Erazo', equity: 0.91 }],
    'BURBUJAS EXPLOSIVAS': [
      { name: 'Ximena Benavides', equity: 0.5 },
      { name: 'John Hermes Pantoja', equity: 0.5 },
    ],
  };

  const SILENT = [
    { name: 'Martha Benavides', equity: 1.45 },
    { name: 'Julian Carrillo', equity: 1.01 },
    { name: 'Jackeline', equity: 0.50 },
  ];
  const currentSilentEquity = SILENT.reduce((s, so) => s + so.equity, 0); // 2.96%

  const totalBenefitPool = distEntries.reduce((s, [_, v]) => s + v.benefit, 0);
  const utilidadNeta = 232081506;

  console.log('=== ANALISIS DE INCENTIVOS: ¿Le conviene dejar de distribuir? ===\n');
  console.log('Pool Beneficio Distribuidor total:', Math.round(totalBenefitPool / 1e6) + 'M/año');
  console.log('Socios silenciosos actuales:', currentSilentEquity + '%');
  console.log('');

  // For each distributor, calculate: what happens if they STOP distributing?
  console.log('=== ESCENARIO POR DISTRIBUIDOR ===\n');

  for (const [distName, distData] of distEntries) {
    const owners = OWNERSHIP[distName];
    if (!owners) continue;
    const totalOwnerEquity = owners.reduce((s, o) => s + o.equity, 0);
    
    console.log(`── ${distName} (equity total: ${totalOwnerEquity}%) ──`);
    console.log(`   Beneficio distribuidora: ${Math.round(distData.benefit / 1e6)}M/año (${(distData.extraRate * 100).toFixed(1)}% extra sobre bruto ${Math.round(distData.bruto / 1e6)}M)`);

    // CURRENT: as distributor
    const currentDividend = utilidadNeta * (totalOwnerEquity / 100);
    const currentDistBenefit = distData.benefit;
    const currentTotal = currentDividend + currentDistBenefit;

    console.log(`   COMO DISTRIBUIDOR:`);
    console.log(`     Dividendo: ${Math.round(currentDividend / 1e6)}M + Beneficio: ${Math.round(currentDistBenefit / 1e6)}M = TOTAL: ${Math.round(currentTotal / 1e6)}M/año (${Math.round(currentTotal / 12 / 1e6)}M/mes)`);

    // IF SILENT: what bonus would they get at different rates?
    // Pool stays the same (someone else distributes), they join silent pool
    const newSilentEquity = currentSilentEquity + totalOwnerEquity;
    
    console.log(`   SI DEJA DE DISTRIBUIR (se une a silenciosos, pool sube a ${newSilentEquity.toFixed(2)}%):`);
    
    for (const rate of [0.5, 1, 2, 3, 5]) {
      const bonusPool = totalBenefitPool * (rate / 100);
      const theirShare = bonusPool * (totalOwnerEquity / newSilentEquity);
      const silentTotal = currentDividend + theirShare;
      const diff = silentTotal - currentTotal;
      const worthy = diff > 0 ? '⛔ LE CONVIENE DEJAR DE DISTRIBUIR!' : '✅ Le conviene seguir distribuyendo';
      console.log(`     Rate ${rate}%: Dividendo ${Math.round(currentDividend/1e6)}M + Bono ${Math.round(theirShare/1e6)}M = ${Math.round(silentTotal/1e6)}M/año | Dif vs actual: ${Math.round(diff/1e6)}M | ${worthy}`);
    }

    // Break-even rate
    // currentDistBenefit = totalBenefitPool * (breakEvenRate/100) * (totalOwnerEquity / newSilentEquity)
    const breakEvenRate = (currentDistBenefit / (totalBenefitPool * (totalOwnerEquity / newSilentEquity))) * 100;
    console.log(`   📊 RATE DE QUIEBRE: ${breakEvenRate.toFixed(1)}% (a partir de ahí le conviene ser silencioso)`);
    console.log('');
  }

  // Special analysis: BURBUJAS (smallest)
  console.log('\n=== ALERTA ESPECIAL: BURBUJAS EXPLOSIVAS ===');
  const burbujas = bc['BURBUJAS EXPLOSIVAS'];
  if (burbujas) {
    const burbujasEquity = 1.0;  // 0.5 + 0.5
    const burbujasDiv = utilidadNeta * (burbujasEquity / 100);
    const burbujasBenefit = burbujas.benefit;
    const burbujasTotal = burbujasDiv + burbujasBenefit;
    
    console.log(`Beneficio por distribuir: ${Math.round(burbujasBenefit / 1e6)}M/año (${Math.round(burbujasBenefit / 12 / 1e6)}M/mes)`);
    console.log(`Dividendo: ${Math.round(burbujasDiv / 1e6)}M/año`);
    console.log(`Total actual: ${Math.round(burbujasTotal / 1e6)}M/año`);
    
    const newSilent = currentSilentEquity + burbujasEquity;
    for (const rate of [0.5, 1, 2, 3]) {
      const pool = totalBenefitPool * (rate / 100);
      const share = pool * (burbujasEquity / newSilent);
      const silentT = burbujasDiv + share;
      console.log(`  Rate ${rate}%: Bono ${Math.round(share/1e6)}M → Total ${Math.round(silentT/1e6)}M vs actual ${Math.round(burbujasTotal/1e6)}M (dif: ${Math.round((silentT - burbujasTotal)/1e6)}M)`);
    }
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

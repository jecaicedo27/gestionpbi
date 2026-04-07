const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

/**
 * GET /analytics/sales/by-client
 * Returns comprehensive sales analytics aggregated by customer.
 * 
 * Data sources:
 * - Movement (type='VTA') for historical sales (2025+), grouped by customerName
 * - Order + OrderItem for detailed product breakdowns on registered distributors
 * - User (role=DISTRIBUIDOR) for commercial data (discount, NIT, etc.)
 * 
 * Admin-only endpoint.
 */
// Standard market discount any buyer would get (25%)
const MARKET_DISCOUNT_PERCENT = 25;
const MARKET_DISCOUNT_RATE = MARKET_DISCOUNT_PERCENT / 100;

exports.getSalesByClient = async (req, res) => {
    try {
        const { year } = req.query; // Optional year filter

        // ─── 1. Fetch VTA movements with product info ───
        const movementWhere = { type: 'VTA', customerName: { not: null } };
        if (year) {
            const y = parseInt(year);
            movementWhere.date = {
                gte: new Date(`${y}-01-01`),
                lt: new Date(`${y + 1}-01-01`)
            };
        }

        const movements = await prisma.movement.findMany({
            where: movementWhere,
            select: {
                date: true,
                quantity: true,
                customerName: true,
                documentNumber: true,
                product: {
                    select: {
                        id: true,
                        sku: true,
                        name: true,
                        price: true,
                        taxes: true,
                        flavor: true,
                        group: { select: { name: true } }
                    }
                }
            }
        });

        // ─── 2. Fetch all distributors/users with commercial metadata ───
        const distributors = await prisma.user.findMany({
            where: { OR: [{ role: 'DISTRIBUIDOR' }, { discountPercent: { gt: 0 } }] },
            select: {
                id: true,
                name: true,
                nit: true,
                idType: true,
                discountPercent: true,
                reteFuente: true,
                active: true,
                createdAt: true
            }
        });

        // Map distributor name -> metadata (case-insensitive)
        const distMap = {};
        distributors.forEach(d => {
            distMap[d.name.toUpperCase()] = d;
        });

        // ─── 3. Aggregate movements by customerName ───
        const customerAggMap = {};
        const allYears = new Set();

        movements.forEach(mov => {
            const name = mov.customerName;
            const orderDate = new Date(mov.date);
            const orderYear = orderDate.getFullYear();
            const monthKey = orderDate.toISOString().substring(0, 7);
            const docNum = mov.documentNumber;
            const qty = mov.quantity || 0;
            const unitPrice = mov.product?.price || 0;

            allYears.add(orderYear);

            if (!customerAggMap[name]) {
                customerAggMap[name] = {
                    customerName: name,
                    invoices: new Set(),
                    totalUnits: 0,
                    totalRevenueBruto: 0,
                    firstDate: orderDate,
                    lastDate: orderDate,
                    yearlyMap: {},
                    monthlyMap: {},
                    productMap: {},
                    flavorMap: {},
                    segmentMap: {}
                };
            }

            const agg = customerAggMap[name];
            agg.invoices.add(docNum);

            if (orderDate < agg.firstDate) agg.firstDate = orderDate;
            if (orderDate > agg.lastDate) agg.lastDate = orderDate;

            // Distributor discount
            const dist = distMap[name?.toUpperCase()];
            const discountRate = (dist?.discountPercent || 0) / 100;

            // ─── Use base price (sin impuestos) for all revenue calculations ───
            // product.price includes ALL taxes (IVA 19% + Ultra 20% + Bebidas)
            // Siigo formula: base = price / (1 + IVA% + Ultra% + ...)
            const taxes = mov.product?.taxes || [];
            const ivaRate = (taxes.find(t => t.type === 'IVA')?.percentage || 0) / 100;
            const ultraRate = (taxes.find(t => t.type === 'Comestibles ultraprocesados')?.percentage || 0) / 100;
            const bebidaRate = (taxes.find(t => t.type === 'Bebidas azucaradas')?.percentage || 0) / 100;
            const totalTaxRate = ivaRate + ultraRate + bebidaRate;
            const baseUnitPrice = unitPrice / (1 + totalTaxRate);
            const lineBruto = qty * baseUnitPrice;           // venta bruta = Siigo Vr. Unitario × qty
            const lineDiscount = lineBruto * discountRate;   // descuento sobre base
            const lineNeto = lineBruto - lineDiscount;       // neto = Siigo Subtotal

            agg.totalUnits += qty;
            agg.totalRevenueBruto += lineBruto;

            // Partner benefit: extra savings beyond the standard 25% market discount
            const marketDiscount = lineBruto * MARKET_DISCOUNT_RATE;
            const partnerBenefitLine = Math.max(0, lineDiscount - marketDiscount);

            if (!agg.yearlyMap[orderYear]) {
                agg.yearlyMap[orderYear] = { orders: new Set(), units: 0, revenueBruto: 0, discount: 0, revenueNeto: 0, partnerBenefit: 0 };
            }
            agg.yearlyMap[orderYear].orders.add(docNum);
            agg.yearlyMap[orderYear].units += qty;
            agg.yearlyMap[orderYear].revenueBruto += lineBruto;
            agg.yearlyMap[orderYear].discount += lineDiscount;
            agg.yearlyMap[orderYear].revenueNeto += lineNeto;
            agg.yearlyMap[orderYear].partnerBenefit += partnerBenefitLine;

            // Monthly
            if (!agg.monthlyMap[monthKey]) {
                agg.monthlyMap[monthKey] = { month: monthKey, orders: new Set(), units: 0, revenue: 0 };
            }
            agg.monthlyMap[monthKey].orders.add(docNum);
            agg.monthlyMap[monthKey].units += qty;
            agg.monthlyMap[monthKey].revenue += lineNeto;

            // Product ranking
            const pKey = mov.product?.sku || 'UNKNOWN';
            if (!agg.productMap[pKey]) {
                agg.productMap[pKey] = { sku: pKey, name: mov.product?.name || 'Desconocido', units: 0, revenue: 0 };
            }
            agg.productMap[pKey].units += qty;
            agg.productMap[pKey].revenue += lineNeto;

            // Flavor ranking
            const flavor = mov.product?.flavor || 'Otros';
            if (!agg.flavorMap[flavor]) {
                agg.flavorMap[flavor] = { flavor, units: 0, revenue: 0 };
            }
            agg.flavorMap[flavor].units += qty;
            agg.flavorMap[flavor].revenue += lineNeto;

            // Segment breakdown
            const groupName = mov.product?.group?.name || 'OTROS';
            // Normalize to LIQUIPOPS / GENIALITY / OTROS
            const segment = groupName.toUpperCase().includes('LIQUIPOPS') ? 'LIQUIPOPS' :
                            groupName.toUpperCase().includes('GENIALITY') ? 'GENIALITY' : 'OTROS';
            if (!agg.segmentMap[segment]) {
                agg.segmentMap[segment] = { segment, units: 0, revenue: 0 };
            }
            agg.segmentMap[segment].units += qty;
            agg.segmentMap[segment].revenue += lineNeto;
        });

        // ─── 4. Aggregate REAL fiscal data from Siigo by customer ───
        const siigoByCustomer = year
            ? await prisma.$queryRaw`
                SELECT customer_name as "customerName",
                    COALESCE(SUM(unit_price * quantity), 0)::float as "ventaBruta",
                    COALESCE(SUM(discount_value), 0)::float as "descuentos",
                    COALESCE(SUM(subtotal), 0)::float as "subtotal",
                    COALESCE(SUM(line_total), 0)::float as "totalFacturado"
                FROM siigo_invoice_items
                WHERE EXTRACT(YEAR FROM invoice_date) = ${parseInt(year)}
                GROUP BY customer_name`
            : await prisma.$queryRaw`
                SELECT customer_name as "customerName",
                    COALESCE(SUM(unit_price * quantity), 0)::float as "ventaBruta",
                    COALESCE(SUM(discount_value), 0)::float as "descuentos",
                    COALESCE(SUM(subtotal), 0)::float as "subtotal",
                    COALESCE(SUM(line_total), 0)::float as "totalFacturado"
                FROM siigo_invoice_items
                WHERE invoice_date >= '2025-01-01'
                GROUP BY customer_name`;
        const siigoFiscalMap = {};
        siigoByCustomer.forEach(row => {
            siigoFiscalMap[row.customerName?.toUpperCase()] = row;
        });

        // ─── 5. Build client objects ───
        let globalTotalRevenue = 0;
        let globalTotalUnits = 0;
        let globalTotalOrders = 0;

        const clients = Object.values(customerAggMap).map(agg => {
            const dist = distMap[agg.customerName?.toUpperCase()];
            const discountRate = (dist?.discountPercent || 0) / 100;

            // Use REAL Siigo fiscal data when available
            const siigoData = siigoFiscalMap[agg.customerName?.toUpperCase()];
            const totalRevenueBruto = siigoData ? Math.round(siigoData.ventaBruta) : Math.round(agg.totalRevenueBruto);
            const totalDiscount = siigoData ? Math.round(siigoData.descuentos) : Math.round(agg.totalRevenueBruto * discountRate);
            const totalRevenueNeto = siigoData ? Math.round(siigoData.subtotal) : (totalRevenueBruto - totalDiscount);

            // Partner Benefit: extra savings beyond market 25%
            const extraDiscountRate = Math.max(0, discountRate - MARKET_DISCOUNT_RATE);
            const totalPartnerBenefit = Math.round(totalRevenueBruto * extraDiscountRate);
            const totalInvoices = agg.invoices.size;

            // Frequency
            const daysBetween = Math.max(1, Math.ceil((agg.lastDate - agg.firstDate) / (1000 * 60 * 60 * 24)));
            const avgOrderFrequencyDays = totalInvoices > 1 ? Math.round(daysBetween / (totalInvoices - 1)) : null;
            const daysSinceLastOrder = Math.ceil((new Date() - agg.lastDate) / (1000 * 60 * 60 * 24));

            // Yearly breakdown — convert Sets to counts
            const yearlyBreakdown = {};
            Object.entries(agg.yearlyMap).forEach(([y, data]) => {
                yearlyBreakdown[y] = {
                    orders: data.orders.size,
                    units: data.units,
                    revenueBruto: Math.round(data.revenueBruto),
                    discount: Math.round(data.discount),
                    revenueNeto: Math.round(data.revenueNeto),
                    partnerBenefit: Math.round(data.partnerBenefit || 0)
                };
            });

            // Monthly trend
            const monthlyTrend = Object.values(agg.monthlyMap)
                .sort((a, b) => a.month.localeCompare(b.month))
                .map(m => ({ month: m.month, orders: m.orders.size, units: m.units, revenue: Math.round(m.revenue) }));

            // Top products
            const topProducts = Object.values(agg.productMap)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 10)
                .map(p => ({ ...p, revenue: Math.round(p.revenue) }));

            // Top flavors
            const topFlavors = Object.values(agg.flavorMap)
                .sort((a, b) => b.revenue - a.revenue)
                .map(f => ({ ...f, revenue: Math.round(f.revenue) }));

            // Segment breakdown
            const segmentBreakdown = {};
            Object.values(agg.segmentMap).forEach(s => {
                segmentBreakdown[s.segment] = { units: s.units, revenue: Math.round(s.revenue) };
            });

            // Globals
            globalTotalRevenue += totalRevenueNeto;
            globalTotalUnits += agg.totalUnits;
            globalTotalOrders += totalInvoices;

            return {
                id: dist?.id || agg.customerName,
                name: agg.customerName,
                nit: dist?.nit || null,
                idType: dist?.idType === '13' ? 'NIT' : (dist?.idType === '12' ? 'Cédula' : (dist ? 'N/A' : null)),
                personType: dist ? (dist.reteFuente ? 'Persona Jurídica' : 'Persona Natural') : 'Externo',
                discountPercent: dist?.discountPercent || 0,
                active: dist?.active ?? true,
                memberSince: dist?.createdAt || agg.firstDate,
                isRegistered: !!dist,
                totalOrders: totalInvoices,
                totalUnits: agg.totalUnits,
                totalRevenueBruto,
                totalDiscount: Math.round(totalDiscount),
                totalRevenueNeto: Math.round(totalRevenueNeto),
                totalPartnerBenefit,
                partnerBenefitPercent: extraDiscountRate > 0 ? Math.round(extraDiscountRate * 10000) / 100 : 0,
                marketDiscountPercent: MARKET_DISCOUNT_PERCENT,
                avgTicket: totalInvoices > 0 ? Math.round(totalRevenueNeto / totalInvoices) : 0,
                avgOrderFrequencyDays,
                daysSinceLastOrder,
                firstOrderDate: agg.firstDate,
                lastOrderDate: agg.lastDate,
                yearlyBreakdown,
                monthlyTrend,
                topProducts,
                topFlavors,
                segmentBreakdown
            };
        });

        // ─── 5. Participation % ───
        clients.forEach(c => {
            c.participationPercent = globalTotalRevenue > 0
                ? Math.round((c.totalRevenueNeto / globalTotalRevenue) * 10000) / 100
                : 0;
        });

        // Sort by revenue descending
        clients.sort((a, b) => b.totalRevenueNeto - a.totalRevenueNeto);

        // ─── 6. Global KPIs ───
        const sortedYears = Array.from(allYears).sort((a, b) => b - a);
        const activeClients = clients.filter(c => c.active && c.totalOrders > 0).length;
        const registeredClients = clients.filter(c => c.isRegistered).length;
        const avgDiscount = (() => {
            const withDiscount = clients.filter(c => c.discountPercent > 0);
            if (withDiscount.length === 0) return 0;
            return Math.round((withDiscount.reduce((sum, c) => sum + c.discountPercent, 0) / withDiscount.length) * 100) / 100;
        })();
        const topClient = clients.length > 0 ? clients[0] : null;
        const avgFrequency = (() => {
            const withFreq = clients.filter(c => c.avgOrderFrequencyDays !== null);
            if (withFreq.length === 0) return null;
            return Math.round(withFreq.reduce((s, c) => s + c.avgOrderFrequencyDays, 0) / withFreq.length);
        })();

        // Global partner benefit
        const totalPartnerBenefit = clients.reduce((sum, c) => sum + (c.totalPartnerBenefit || 0), 0);

        // ─── Fiscal breakdown from SiigoInvoiceItem (exact Siigo data) ───
        const fiscalWhere = {};
        if (year) {
            const y = parseInt(year);
            fiscalWhere.invoiceDate = {
                gte: new Date(`${y}-01-01`),
                lt: new Date(`${y + 1}-01-01`)
            };
        }
        const fiscalAgg = await prisma.siigoInvoiceItem.aggregate({
            where: fiscalWhere,
            _sum: {
                unitPrice: true,
                subtotal: true,
                discountValue: true,
                ivaValue: true,
                ultraValue: true,
                bebidasValue: true,
                lineTotal: true
            },
            _count: true
        });
        // Also compute gross (unitPrice × qty) since aggregate can't do multiplication
        let fiscalRaw = null;
        try {
            if (year) {
                const yStart = new Date(`${parseInt(year)}-01-01`);
                const yEnd = new Date(`${parseInt(year) + 1}-01-01`);
                fiscalRaw = await prisma.$queryRaw`
                    SELECT 
                        COALESCE(SUM(unit_price * quantity), 0) as "ventaBruta",
                        COALESCE(SUM(discount_value), 0) as "descuentos",
                        COALESCE(SUM(subtotal), 0) as "subtotal",
                        COALESCE(SUM(iva_value), 0) as "iva",
                        COALESCE(SUM(ultra_value), 0) as "ultraprocesados",
                        COALESCE(SUM(bebidas_value), 0) as "bebidas",
                        COALESCE(SUM(line_total), 0) as "totalFacturado",
                        COUNT(*)::int as "totalItems"
                    FROM siigo_invoice_items
                    WHERE invoice_date >= ${yStart} AND invoice_date < ${yEnd}
                `;
            } else {
                fiscalRaw = await prisma.$queryRaw`
                    SELECT 
                        COALESCE(SUM(unit_price * quantity), 0) as "ventaBruta",
                        COALESCE(SUM(discount_value), 0) as "descuentos",
                        COALESCE(SUM(subtotal), 0) as "subtotal",
                        COALESCE(SUM(iva_value), 0) as "iva",
                        COALESCE(SUM(ultra_value), 0) as "ultraprocesados",
                        COALESCE(SUM(bebidas_value), 0) as "bebidas",
                        COALESCE(SUM(line_total), 0) as "totalFacturado",
                        COUNT(*)::int as "totalItems"
                    FROM siigo_invoice_items
                `;
            }
        } catch (e) {
            logger.error('Fiscal raw query error:', e.message);
        }

        // Fallback: use aggregate if raw query fails
        const fiscal = fiscalRaw?.[0] || null;
        const fiscalData = fiscal ? {
            ventaBruta: Math.round(Number(fiscal.ventaBruta)),
            descuentosComerciales: Math.round(Number(fiscal.descuentos)),
            subtotal: Math.round(Number(fiscal.subtotal)),
            iva: Math.round(Number(fiscal.iva)),
            ultraprocesados: Math.round(Number(fiscal.ultraprocesados)),
            bebidasAzucaradas: Math.round(Number(fiscal.bebidas)),
            totalImpuestos: Math.round(Number(fiscal.iva) + Number(fiscal.ultraprocesados) + Number(fiscal.bebidas)),
            totalFacturado: Math.round(Number(fiscal.totalFacturado)),
            itemCount: fiscal.totalItems
        } : {
            ventaBruta: Math.round(fiscalAgg._sum.subtotal + fiscalAgg._sum.discountValue || 0),
            descuentosComerciales: Math.round(fiscalAgg._sum.discountValue || 0),
            subtotal: Math.round(fiscalAgg._sum.subtotal || 0),
            iva: Math.round(fiscalAgg._sum.ivaValue || 0),
            ultraprocesados: Math.round(fiscalAgg._sum.ultraValue || 0),
            bebidasAzucaradas: Math.round(fiscalAgg._sum.bebidasValue || 0),
            totalImpuestos: Math.round((fiscalAgg._sum.ivaValue || 0) + (fiscalAgg._sum.ultraValue || 0) + (fiscalAgg._sum.bebidasValue || 0)),
            totalFacturado: Math.round(fiscalAgg._sum.lineTotal || 0),
            itemCount: fiscalAgg._count
        };

        res.json({
            kpis: {
                activeClients,
                registeredClients,
                totalClients: clients.length,
                totalRevenue: fiscalData?.subtotal || Math.round(globalTotalRevenue),
                totalUnits: globalTotalUnits,
                totalOrders: globalTotalOrders,
                avgDiscount,
                avgFrequencyDays: avgFrequency,
                topClientName: topClient?.name || 'N/A',
                topClientRevenue: topClient?.totalRevenueNeto || 0,
                totalPartnerBenefit: Math.round(totalPartnerBenefit),
                marketDiscountPercent: MARKET_DISCOUNT_PERCENT,
                fiscal: fiscalData
            },
            availableYears: sortedYears,
            clients
        });

    } catch (error) {
        logger.error('Error in getSalesByClient:', error);
        res.status(500).json({ error: 'Error obteniendo análisis de ventas por cliente' });
    }
};

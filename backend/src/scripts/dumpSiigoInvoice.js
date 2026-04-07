const siigo = require('../services/siigoService');

async function run() {
    try {
        await siigo.authenticate();
        
        console.log('Buscando factura App (FV-1-6)...');
        const appRes = await siigo.apiClient.get('/v1/invoices?name=FV-1-6');
        const appInvoice = appRes.data?.results?.[0];
        
        console.log('Buscando factura Manual (FV-2-1076)...');
        const manRes = await siigo.apiClient.get('/v1/invoices?name=FV-2-1076');
        const manInvoice = manRes.data?.results?.[0];

        if (appInvoice) {
            console.log("\n================ [ APP FV-1-6 ] ================");
            console.log("Items:");
            appInvoice.items.forEach((item, i) => {
                let discRow = item.discount || 0;
                let price = item.price || 0;
                let qty = item.quantity || 0;
                let expectedDiscount = Math.round(price * qty * 0.348 * 100) / 100;
                console.log(`  ${String(i).padStart(2)}: ${item.description.substring(0,30).padEnd(30)} | Qty: ${qty} | P.Base: ${price} | DescReported: $${discRow} | Expected34.8%: $${expectedDiscount} | DIFF: $${Math.abs(discRow - expectedDiscount).toFixed(2)}`);
            });
            console.log(">>> Total Bruto:", appInvoice.total?.gross_value);
            console.log(">>> Total Descuento:", appInvoice.total?.discount_value);
        } else {
            console.log("No se pudo hallar FV-1-6");
        }

        if (manInvoice) {
            console.log("\n================ [ MANUAL FV-2-1076 ] ================");
            console.log("Items:");
            let manTotalDiscountMissing = 0;
            manInvoice.items.forEach((item, i) => {
                let discRow = item.discount || 0;
                let price = item.price || 0;
                let qty = item.quantity || 0;
                let expectedDiscount = Math.round(price * qty * 0.348 * 100) / 100;
                let diff = Math.abs(discRow - expectedDiscount);
                manTotalDiscountMissing += diff;
                if (diff > 1) {
                    console.log(`  🚨 ${String(i).padStart(2)}: ${item.description.substring(0,30).padEnd(30)} | Qty: ${qty} | P.Base: ${price} | DescReportado: $${discRow} | Esperado(34.8%): $${expectedDiscount} | ERROR: Faltan $${diff.toFixed(2)}`);
                } else {
                    console.log(`  ${String(i).padStart(2)}: ${item.description.substring(0,30).padEnd(30)} | Qty: ${qty} | OK`);
                }
            });
            console.log(">>> Total Bruto:", manInvoice.total?.gross_value);
            console.log(">>> Total Descuento:", manInvoice.total?.discount_value);
            console.log(">>> DESCUENTO FALTANTE TOTAL EN MANUAL:", manTotalDiscountMissing.toFixed(2));
        } else {
             console.log("No se pudo hallar FV-2-1076");
        }
        
    } catch(e) {
        console.error("Error:", e.response?.data || e.message);
    }
}
run();

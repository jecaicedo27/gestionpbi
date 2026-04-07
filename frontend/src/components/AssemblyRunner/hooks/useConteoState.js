import { useState } from 'react';

/**
 * useConteoState
 * Manages per-product actual counts for the CONTEO step,
 * plus the list of partial "carriots" delivered to empaque,
 * and photo evidence per product.
 */
export function useConteoState() {
    const [conteoActuals, setConteoActuals] = useState({}); // { productId: actualUnits }
    const [conteoPhotos, setConteoPhotos] = useState({});   // { productId: photoUrl }
    const [carriots, setCarriots] = useState([]);            // CarritoEntry[]

    const setConteoActual = (productId, value) => {
        setConteoActuals(prev => ({ ...prev, [productId]: value }));
    };

    const setConteoPhoto = (productId, url) => {
        setConteoPhotos(prev => ({ ...prev, [productId]: url }));
    };

    /**
     * Add a new carrito locally and auto-sum conteoActuals.
     * @param {string} productId
     * @param {string} productName
     * @param {number} qty   (1–150)
     * @returns CarritoEntry
     */
    const addCarritoLocal = (productId, productName, qty) => {
        const newEntry = {
            id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            productId,
            productName,
            qty: parseInt(qty, 10),
            carritoNum: null, // will be set below
            timestamp: new Date().toISOString(),
            receivedAt: null,
        };

        setCarriots(prev => {
            // Give it a number scoped to this product
            const sameProduct = prev.filter(c => c.productId === productId);
            newEntry.carritoNum = sameProduct.length + 1;
            const updated = [...prev, newEntry];

            // Auto-update the running total for this product
            const total = updated
                .filter(c => c.productId === productId)
                .reduce((s, c) => s + c.qty, 0);
            setConteoActuals(p => ({ ...p, [productId]: total }));

            return updated;
        });

        return newEntry;
    };

    /** Remove a carrito and recalculate totals. */
    const removeCarritoLocal = (carritoId) => {
        setCarriots(prev => {
            const updated = prev.filter(c => c.id !== carritoId);
            // Recalculate every product sum
            const sums = {};
            updated.forEach(c => { sums[c.productId] = (sums[c.productId] || 0) + c.qty; });
            setConteoActuals(sums);
            return updated;
        });
    };

    /**
     * Pre-load carriots (e.g. from processParameters when resuming a session).
     * Syncs conteoActuals from the loaded list.
     */
    const preloadCarriots = (list) => {
        const clean = list || [];
        setCarriots(clean);
        if (clean.length > 0) {
            const sums = {};
            clean.forEach(c => { sums[c.productId] = (sums[c.productId] || 0) + c.qty; });
            setConteoActuals(sums);
        }
    };

    const reset = () => { setConteoActuals({}); setConteoPhotos({}); setCarriots([]); };

    return {
        conteoActuals, setConteoActual,
        conteoPhotos, setConteoPhoto,
        carriots, addCarritoLocal, removeCarritoLocal, preloadCarriots,
        reset,
    };
}

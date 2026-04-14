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
    const addCarritoLocal = (productId, productName, qty, productionPhotoUrl = null) => {
        const newEntry = {
            id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            productId,
            productName,
            qty: parseInt(qty, 10),
            carritoNum: null, // will be set below
            timestamp: new Date().toISOString(),
            receivedAt: null,
            productionPhotoUrl,
        };

        setCarriots(prev => {
            // Numero siguiente = máximo número ya usado en cualquier carrito + 1
            // (si se elimina un carrito y se crea otro, no reutiliza el número)
            const maxNum = prev.reduce((m, c) => Math.max(m, c.carritoNum || 0), 0);
            newEntry.carritoNum = maxNum + 1;
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

    const preloadPhotos = (photos) => {
        if (photos) setConteoPhotos(photos);
    };

    const preloadActuals = (actuals) => {
        if (actuals) setConteoActuals(actuals);
    };

    /** Update an existing carrito (e.g. mark as printed) */
    const updateCarritoLocal = (carritoId, updates) => {
        setCarriots(prev => prev.map(c => c.id === carritoId ? { ...c, ...updates } : c));
    };

    const reset = () => { setConteoActuals({}); setConteoPhotos({}); setCarriots([]); };

    return {
        conteoActuals, setConteoActual,
        conteoPhotos, setConteoPhoto,
        carriots, addCarritoLocal, removeCarritoLocal, updateCarritoLocal, preloadCarriots,
        preloadPhotos, preloadActuals,
        reset,
    };
}

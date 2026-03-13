import { useState } from 'react';

/**
 * useConteoState
 * Manages the per-product actual counts for the CONTEO step.
 */
export function useConteoState() {
    const [conteoActuals, setConteoActuals] = useState({}); // { productId: actualUnits }

    const setConteoActual = (productId, value) => {
        setConteoActuals(prev => ({ ...prev, [productId]: value }));
    };

    const reset = () => setConteoActuals({});

    return { conteoActuals, setConteoActual, reset };
}

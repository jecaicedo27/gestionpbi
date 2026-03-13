import { useState } from 'react';

/**
 * useEmpaqueState
 * Manages all EMPAQUE-related state: defective count, per-tarro photo URLs, defect reasons.
 */
export function useEmpaqueState() {
    const [empaqueDefective, setEmpaqueDefective] = useState(0);
    const [empaquePhotoUrls, setEmpaquePhotoUrls] = useState([]); // string[] — one per defective tarro
    const [empaqueDefectReasons, setEmpaqueDefectReasons] = useState([]); // { cause, description }[]

    const setPhotoUrl = (index, url) => {
        setEmpaquePhotoUrls(prev => {
            const arr = [...prev];
            arr[index] = url;
            return arr;
        });
    };

    const setDefectReason = (index, field, value) => {
        setEmpaqueDefectReasons(prev => {
            const arr = [...prev];
            arr[index] = { ...arr[index], [field]: value };
            return arr;
        });
    };

    const reset = () => {
        setEmpaqueDefective(0);
        setEmpaquePhotoUrls([]);
        setEmpaqueDefectReasons([]);
    };

    return {
        empaqueDefective,
        setEmpaqueDefective,
        empaquePhotoUrls,
        setPhotoUrl,
        empaqueDefectReasons,
        setDefectReason,
        reset,
    };
}

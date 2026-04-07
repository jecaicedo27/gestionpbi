import { useState, useCallback, useRef } from 'react';
import api from '../../../services/api';

/**
 * useEmpaqueState
 * Manages all EMPAQUE-related state: defective count, per-tarro photo URLs, defect reasons.
 * NOW WITH AUTO-PERSISTENCE: every change is debounced-saved to processParameters.empaque_draft
 * so tablet screen-lock / F5 doesn't lose data.
 */
export function useEmpaqueState() {
    const [empaqueDefective, setEmpaqueDefectiveRaw] = useState(0);
    const [empaquePhotoUrls, setEmpaquePhotoUrls] = useState([]); // string[] — one per defective tarro
    const [empaqueDefectReasons, setEmpaqueDefectReasons] = useState([]); // { cause, description }[]

    // Ref to noteId for persistence calls
    const noteIdRef = useRef(null);
    const saveTimerRef = useRef(null);

    // ── Debounced auto-save to backend ──
    const persistDraft = useCallback((defective, photos, reasons) => {
        if (!noteIdRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            try {
                await api.patch(`/assembly-notes/${noteIdRef.current}`, {
                    processParameters: {
                        empaque_draft: {
                            defective_qty: defective,
                            photo_urls: photos,
                            defect_reasons: reasons,
                            saved_at: new Date().toISOString(),
                        }
                    }
                });
                console.log('[useEmpaqueState] Draft saved OK — defective:', defective);
            } catch (e) {
                console.warn('[useEmpaqueState] Draft save failed:', e.message);
            }
        }, 800); // 800ms debounce — fast enough for user, not too many API calls
    }, []);

    // ── Wrapped setters that trigger auto-save ──
    const setEmpaqueDefective = useCallback((val) => {
        setEmpaqueDefectiveRaw(val);
        // Need to read latest photos+reasons from state — use functional pattern
        setEmpaquePhotoUrls(photos => {
            setEmpaqueDefectReasons(reasons => {
                persistDraft(val, photos, reasons);
                return reasons;
            });
            return photos;
        });
    }, [persistDraft]);

    const setPhotoUrl = useCallback((index, url) => {
        setEmpaquePhotoUrls(prev => {
            const arr = [...prev];
            arr[index] = url;
            // Trigger save after photo set
            setEmpaqueDefectiveRaw(def => {
                setEmpaqueDefectReasons(reasons => {
                    persistDraft(def, arr, reasons);
                    return reasons;
                });
                return def;
            });
            return arr;
        });
    }, [persistDraft]);

    const setDefectReason = useCallback((index, field, value) => {
        setEmpaqueDefectReasons(prev => {
            const arr = [...prev];
            arr[index] = { ...arr[index], [field]: value };
            // Trigger save after reason set
            setEmpaqueDefectiveRaw(def => {
                setEmpaquePhotoUrls(photos => {
                    persistDraft(def, photos, arr);
                    return photos;
                });
                return def;
            });
            return arr;
        });
    }, [persistDraft]);

    // ── Restore from saved draft (called from Wizard useEffect) ──
    const restoreFromDraft = useCallback((draft) => {
        if (!draft) return;
        if (draft.defective_qty != null) setEmpaqueDefectiveRaw(draft.defective_qty);
        if (Array.isArray(draft.photo_urls)) setEmpaquePhotoUrls(draft.photo_urls);
        if (Array.isArray(draft.defect_reasons)) setEmpaqueDefectReasons(draft.defect_reasons);
        console.log('[useEmpaqueState] Restored from draft — defective:', draft.defective_qty, 'photos:', draft.photo_urls?.length);
    }, []);

    // ── Set noteId for persistence (called from Wizard) ──
    const setNoteId = useCallback((id) => {
        noteIdRef.current = id;
    }, []);

    const reset = () => {
        setEmpaqueDefectiveRaw(0);
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
        restoreFromDraft,
        setNoteId,
        reset,
    };
}

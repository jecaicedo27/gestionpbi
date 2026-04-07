import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

/* ─── premix definitions (match existing templates) ─── */
const PREMIXES = [
    {
        name: 'Azúcar Inverter Glucosa',
        code: 'TMPL-AZINV-001',
        emoji: '🍯',
        gradient: 'from-amber-500 to-orange-600',
        shadow: 'shadow-amber-200',
        description: 'Ácido cítrico + Azúcar + Glucosa + Agua',
    },
    {
        name: 'Azúcar Invertida Fructosa',
        code: 'TMPL-FRUCT-001',
        emoji: '🍬',
        gradient: 'from-orange-400 to-red-500',
        shadow: 'shadow-orange-200',
        description: 'Agua + Azúcar + Ácido Cítrico + Fructosa',
    },
    {
        name: 'Premezcla Gomas',
        code: 'TMPL003',
        emoji: '🧪',
        gradient: 'from-purple-500 to-indigo-600',
        shadow: 'shadow-purple-200',
        description: 'Goma Guar + Azúcar + Celulosa + CMC',
    },
    {
        name: 'Premezcla Calcio',
        code: 'TMPL002',
        emoji: '🦴',
        gradient: 'from-cyan-500 to-teal-600',
        shadow: 'shadow-cyan-200',
        description: 'Lactato + Cloruro de Calcio',
    },
    {
        name: 'Premezcla Conservantes',
        code: 'TMPL-PRECONS-001',
        emoji: '🛡️',
        gradient: 'from-rose-500 to-pink-600',
        shadow: 'shadow-rose-200',
        description: 'Sorbato de Potasio + Benzoato de Sodio',
    },
    {
        name: 'Protónico',
        code: 'TMPL005',
        emoji: '⚡',
        gradient: 'from-yellow-400 to-amber-500',
        shadow: 'shadow-yellow-200',
        description: 'Agua + Aminoácidos + Colágeno + Ácido Cítrico',
    },
    {
        name: 'Alginato Preparado',
        code: 'TMPL007',
        emoji: '🌊',
        gradient: 'from-blue-500 to-sky-600',
        shadow: 'shadow-blue-200',
        description: 'Agua + Alginato de Sodio',
    },
    {
        name: 'Premezcla Calcio Dióxido',
        code: 'TMPL110',
        emoji: '🦴',
        gradient: 'from-lime-500 to-green-600',
        shadow: 'shadow-lime-200',
        description: 'Lactato + Cloruro de Calcio + Dióxido de Titanio',
    },
    {
        name: 'Premezcla Gomas Especial',
        code: 'TMPL048',
        emoji: '🧪',
        gradient: 'from-fuchsia-500 to-purple-600',
        shadow: 'shadow-fuchsia-200',
        description: 'Gomas especiales para fórmula Dióxido',
    },
];

const PROCESSES = [
    {
        name: 'Base Liquipops',
        code: 'TMPL-BASELIQ-001',
        emoji: '🧊',
        gradient: 'from-indigo-500 to-blue-700',
        shadow: 'shadow-indigo-200',
        description: 'Agua + Calcio + Gomas + Azúcar + Glucosa + Conservantes',
    },
    {
        name: 'Base Liquipops Dióxido',
        code: 'TMPL-BASELIQ-001-v2',
        emoji: '⚪',
        gradient: 'from-emerald-500 to-teal-700',
        shadow: 'shadow-emerald-200',
        description: 'Calcio Dióxido + Gomas + Azúcar + Glucosa + Color Verde + Dióxido Titanio',
    },
];

const SABORIZACIONES = [
    {
        name: 'Saborización Maracuyá',
        code: 'TMPL065',
        emoji: '🧪',
        gradient: 'from-orange-500 to-amber-600',
        shadow: 'shadow-orange-200',
        description: 'Base Sirope + Ác. Cítrico + Colorantes + Sabores + Antiespumante',
    },
];

const SIROPES_GENIALITY = [
    {
        name: 'Sirope Maracuyá 1000 ML',
        code: 'TMPL066',
        emoji: '🍋',
        gradient: 'from-yellow-500 to-amber-600',
        shadow: 'shadow-yellow-200',
        description: 'Tarro Corbatín + Saborización Maracuyá + Foil + Etiqueta',
    },
    {
        name: 'Sirope Maracuyá 360 ML',
        code: 'TMPL067',
        emoji: '🍋',
        gradient: 'from-yellow-400 to-orange-500',
        shadow: 'shadow-orange-200',
        description: 'Tarro 360ml + Saborización Maracuyá + Foil + Etiqueta',
    },
];

/* Dynamic flavor metadata for auto-assigned emoji & colors */
const FLAVOR_META = {
    'FRESA': { emoji: '🍓', color: 'linear-gradient(135deg, #ef4444, #dc2626)' },
    'BLUEBERRY': { emoji: '🫐', color: 'linear-gradient(135deg, #7c3aed, #6d28d9)' },
    'CAFÉ': { emoji: '☕', color: 'linear-gradient(135deg, #78350f, #92400e)' },
    'CAFE': { emoji: '☕', color: 'linear-gradient(135deg, #78350f, #92400e)' },
    'CEREZA': { emoji: '🍒', color: 'linear-gradient(135deg, #be123c, #9f1239)' },
    'CHAMOY': { emoji: '🌶️', color: 'linear-gradient(135deg, #c2410c, #9a3412)' },
    'CHICLE': { emoji: '🪄', color: 'linear-gradient(135deg, #ec4899, #db2777)' },
    'COCO': { emoji: '🥥', color: 'linear-gradient(135deg, #f5f5f4, #a8a29e)' },
    'ICE PINK': { emoji: '🧊', color: 'linear-gradient(135deg, #f472b6, #ec4899)' },
    'LYCHE': { emoji: '🍑', color: 'linear-gradient(135deg, #fda4af, #fb7185)' },
    'MANGO': { emoji: '🥭', color: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    'MANGO BICHE': { emoji: '🥭', color: 'linear-gradient(135deg, #84cc16, #65a30d)' },
    'MANZANA VERDE': { emoji: '🍏', color: 'linear-gradient(135deg, #22c55e, #16a34a)' },
    'MARACUYA': { emoji: '🍋', color: 'linear-gradient(135deg, #eab308, #ca8a04)' },
    'SANDIA': { emoji: '🍉', color: 'linear-gradient(135deg, #f43f5e, #e11d48)' },
};
const DEFAULT_META = { emoji: '🧪', color: 'linear-gradient(135deg, #6366f1, #8b5cf6)' };

/** Extract flavor from template name, e.g. "Producción COMPUESTO CAFÉ" → "CAFÉ" */
const extractFlavor = (name) => {
    const m = name.match(/(?:COMPUESTO|PROTECCION)\s+(.+)/i);
    return m ? m[1].trim().toUpperCase() : '';
};

const FLAVORS = Object.keys(FLAVOR_META);
const ESFERIFICACION_TEMPLATE = 'TMPL-MM8BO73P';

export default function PremixQuickPanel() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(null);
    const [quantities, setQuantities] = useState({});     // code → number of batches
    const [selectedFlavor, setSelectedFlavor] = useState(FLAVORS[0]); // for generic esferificación
    const [activeTab, setActiveTab] = useState('liquipops'); // 'liquipops' | 'geniality'

    const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
    const isQuimico = user?.role?.toUpperCase() === 'QUIMICO';
    const isProduccion = user?.role?.toUpperCase() === 'PRODUCCION';
    const canSeeSecretFormulas = isAdmin || isQuimico;

    // Premezclas: Producción can see them EXCEPT Protónico
    // Protónico, Compuestos, Esferas → Admin/Quimico only
    const premezclasToShow = canSeeSecretFormulas
        ? PREMIXES
        : isProduccion
            ? PREMIXES.filter(p => !p.name.toLowerCase().includes('protónico'))
            : [];

    // ── Active-batch conflict dialog state ────────────────────
    const [conflictDialog, setConflictDialog] = useState(null);
    // { premix, activeBatches: [ { id, batchNumber, status, firstNoteId, progress } ] }

    /* fetch all templates to get their IDs */
    useEffect(() => {
        api.get('/assembly-templates?all=true')
            .then(r => setTemplates(r.data || []))
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    /* ── Derive COMPUESTOS & PROTECCIONES dynamically from templates ── */
    const COMPUESTOS = templates
        .filter(t => t.isActive && /COMPUESTO/i.test(t.templateName))
        .map(t => {
            const flavor = extractFlavor(t.templateName);
            const meta = FLAVOR_META[flavor] || DEFAULT_META;
            return { name: t.templateName.replace(/^Producci.n\s*/i, ''), code: t.templateCode, emoji: meta.emoji, description: t.product?.name || flavor };
        });

    const PROTECCIONES = templates
        .filter(t => t.isActive && /PROTECCION/i.test(t.templateName))
        .map(t => {
            const flavor = extractFlavor(t.templateName);
            const meta = FLAVOR_META[flavor] || DEFAULT_META;
            return { name: t.templateName.replace(/^Producci.n\s*/i, ''), code: t.templateCode, emoji: meta.emoji, description: t.product?.name || flavor };
        });



    /* match code → template */
    const getTemplate = (code) =>
        templates.find(t => t.templateCode === code);

    /* start premix via quick-start */
    const handleStart = async (premix, forceNew = false) => {
        const template = getTemplate(premix.code);
        if (!template) return alert(`Template ${premix.code} no encontrado`);

        // ── Check for active batches first (unless forcing new) ──
        if (!forceNew) {
            try {
                const res = await api.get(`/production-batches?productId=${template.productId}&active=true`);
                const active = (res.data || []).filter(b =>
                    !['COMPLETED', 'FAILED'].includes(b.status)
                );
                if (active.length > 0) {
                    // Build conflict info
                    const batches = active.map(b => ({
                        id: b.id,
                        batchNumber: b.batchNumber,
                        status: b.status,
                        firstNoteId: b.assemblyNotes?.[0]?.id || null,
                        totalNotes: b.assemblyNotes?.length || 0,
                        completedNotes: b.assemblyNotes?.filter(n => n.status === 'COMPLETED').length || 0,
                    }));
                    setConflictDialog({ premix, activeBatches: batches });
                    return;
                }
            } catch {
                // If check fails, proceed anyway
            }
        }

        setStarting(premix.code);
        setConflictDialog(null);
        try {
            const res = await api.post('/assembly-notes/quick-start', {
                templateId: template.id,
                userId: user?.id,
                quantity: quantities[premix.code] || 1,
                ...(premix.flavorKey ? { flavorKey: premix.flavorKey } : {}),
            });
            const noteId = res.data?.firstNoteId;
            if (noteId) {
                navigate(`/assembly-execution/${noteId}`);
            }
        } catch (err) {
            console.error(err);
            alert('Error al iniciar: ' + (err.response?.data?.error || err.message));
        } finally {
            setStarting(null);
        }
    };

    /* Continue an existing batch */
    const handleContinue = (batch) => {
        setConflictDialog(null);
        if (batch.firstNoteId) {
            navigate(`/assembly-execution/${batch.firstNoteId}`);
        } else {
            navigate('/production/operator');
        }
    };

    /* Delete existing batch and start fresh */
    const handleDeleteAndStart = async (premix, batchId) => {
        if (!confirm('¿Seguro que deseas eliminar el bache existente? Esta acción no se puede deshacer.')) return;
        try {
            await api.delete(`/production-batches/${batchId}`);
        } catch (err) {
            alert('Error al eliminar: ' + (err.response?.data?.error || err.message));
            return;
        }
        setConflictDialog(null);
        handleStart(premix, true);
    };

    return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 50%, #f5f0ff 100%)', padding: '0.75rem' }}>
            {/* Header + Tabs */}
            <div style={{ margin: '0 0 1rem' }}>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                    🏭 Panel de Producción
                </h1>
                <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                    Prepara insumos intermedios y productos finales bajo demanda
                </p>
                {/* Tab bar — large and prominent */}
                <div style={{ display: 'flex', gap: 0, marginTop: '.75rem', background: '#e2e8f0', borderRadius: 14, padding: 4 }}>
                    {[
                        { key: 'liquipops', label: '🧊 Perlas Liquipops', color: '#4f46e5', lightBg: '#eef2ff' },
                        { key: 'geniality', label: '🍯 Siropes Geniality', color: '#d97706', lightBg: '#fffbeb' },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                flex: 1,
                                padding: '.75rem 1rem',
                                borderRadius: 11,
                                border: 'none',
                                background: activeTab === tab.key ? tab.color : 'transparent',
                                color: activeTab === tab.key ? '#fff' : '#64748b',
                                fontWeight: 800,
                                fontSize: '1.05rem',
                                cursor: 'pointer',
                                transition: 'all .25s ease',
                                boxShadow: activeTab === tab.key ? '0 4px 12px rgba(0,0,0,.15)' : 'none',
                                letterSpacing: '.01em',
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ════════ LIQUIPOPS TAB ════════ */}
            {activeTab === 'liquipops' && (<>

            {/* Grid of cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '0.75rem',
            }}>
                {premezclasToShow.map((premix) => {
                    const template = getTemplate(premix.code);
                    const tid = template?.id;
                    const isStarting = starting === premix.code;

                    return (
                        <div
                            key={premix.code}
                            style={{
                                background: '#fff',
                                borderRadius: 10,
                                overflow: 'hidden',
                                boxShadow: '0 4px 24px rgba(0,0,0,.06)',
                                transition: 'transform .2s, box-shadow .2s',
                                cursor: 'pointer',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}
                        >
                            {/* Gradient header with emoji */}
                            <div style={{
                                background: {
                                    'TMPL-AZINV-001': 'linear-gradient(135deg, #f59e0b, #ea580c)',
                                    'TMPL-FRUCT-001': 'linear-gradient(135deg, #fb923c, #ef4444)',
                                    'TMPL003': 'linear-gradient(135deg, #a855f7, #4f46e5)',
                                    'TMPL002': 'linear-gradient(135deg, #06b6d4, #0d9488)',
                                    'TMPL-PRECONS-001': 'linear-gradient(135deg, #f43f5e, #ec4899)',
                                    'TMPL005': 'linear-gradient(135deg, #facc15, #f59e0b)',
                                    'TMPL007': 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
                                    'TMPL-BASELIQ-001': 'linear-gradient(135deg, #4f46e5, #1e40af)',
                                    'TMPL110': 'linear-gradient(135deg, #84cc16, #16a34a)',
                                    'TMPL048': 'linear-gradient(135deg, #d946ef, #9333ea)',
                                }[premix.code] || 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                padding: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                            }}>
                                <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{premix.name}</div>
                                    <div style={{ fontSize: '.65rem', color: 'rgba(255,255,255,.7)', fontFamily: 'monospace' }}>{premix.code}</div>
                                </div>
                            </div>

                            {/* Body */}
                            <div style={{ padding: '0.75rem' }}>
                                <p style={{ fontSize: '.65rem', color: '#64748b', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {premix.description}
                                </p>

                                {/* Quantity selector */}
                                <div style={{ marginBottom: '.5rem' }}>
                                    <label style={{ fontSize: '.65rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                        Cantidad de lotes
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.35rem' }}>
                                        <button
                                            onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))}
                                            style={{
                                                width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0',
                                                background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                        >−</button>
                                        <input
                                            type="number"
                                            min="1"
                                            max="100"
                                            value={quantities[premix.code] || 1}
                                            onChange={e => {
                                                const v = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                                                setQuantities(prev => ({ ...prev, [premix.code]: v }));
                                            }}
                                            style={{
                                                flex: 1, textAlign: 'center', fontSize: '1rem', fontWeight: 700,
                                                border: '2px solid #e2e8f0', borderRadius: 8, padding: '.25rem',
                                                color: '#1e293b', outline: 'none',
                                            }}
                                            onFocus={e => e.target.style.borderColor = '#6366f1'}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                        <button
                                            onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))}
                                            style={{
                                                width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0',
                                                background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                        >+</button>
                                    </div>
                                </div>

                                <button
                                    onClick={() => handleStart(premix)}
                                    disabled={loading || isStarting || !tid}
                                    style={{
                                        width: '100%',
                                        padding: '.4rem',
                                        borderRadius: 8,
                                        border: 'none',
                                        background: tid
                                            ? 'linear-gradient(135deg, #10b981, #059669)'
                                            : '#e2e8f0',
                                        color: tid ? '#fff' : '#94a3b8',
                                        fontWeight: 700,
                                        fontSize: '.8rem',
                                        cursor: tid && !isStarting ? 'pointer' : 'not-allowed',
                                        transition: 'opacity .2s',
                                        opacity: isStarting ? .7 : 1,
                                    }}
                                >
                                    {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🚀 Preparar' : '⚠️ Template no encontrado'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── PROCESSES section ── (visible to all authorized roles) */}
            {(canSeeSecretFormulas || isProduccion) && PROCESSES.length > 0 && (
                <>
                    <div style={{ margin: '1.5rem 0 0.75rem' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                            🏭 Procesos
                        </h2>
                        <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                            Producción de productos intermedios y finales
                        </p>
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: '0.75rem',
                    }}>
                        {PROCESSES.map((premix) => {
                            const template = getTemplate(premix.code);
                            const tid = template?.id;
                            const isStarting = starting === premix.code;

                            return (
                                <div
                                    key={premix.code}
                                    style={{
                                        background: '#fff',
                                        borderRadius: 10,
                                        overflow: 'hidden',
                                        boxShadow: '0 4px 24px rgba(0,0,0,.06)',
                                        transition: 'transform .2s, box-shadow .2s',
                                        cursor: 'pointer',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}
                                >
                                    <div style={{
                                        background: {
                                            'TMPL-BASELIQ-001': 'linear-gradient(135deg, #4f46e5, #1e40af)',
                                            'TMPL-BASELIQ-001-v2': 'linear-gradient(135deg, #10b981, #0d9488)',
                                            'TMPL064': 'linear-gradient(135deg, #d97706, #b45309)',
                                        }[premix.code] || 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        padding: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                    }}>
                                        <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.5rem 0.75rem' }}>
                                        <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{premix.description}</p>
                                        <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                            <button
                                                onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))}
                                                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            >−</button>
                                            <input
                                                type="number" min="1" max="100"
                                                value={quantities[premix.code] || 1}
                                                onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))}
                                                style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }}
                                            />
                                            <button
                                                onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))}
                                                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            >+</button>
                                        </div>
                                        <button
                                            onClick={() => handleStart(premix)}
                                            disabled={loading || isStarting || !tid}
                                            style={{
                                                width: '100%', padding: '.4rem', borderRadius: 8, border: 'none',
                                                background: tid ? 'linear-gradient(135deg, #4f46e5, #1e40af)' : '#e2e8f0',
                                                color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem',
                                                cursor: tid && !isStarting ? 'pointer' : 'not-allowed',
                                                transition: 'opacity .2s', opacity: isStarting ? .7 : 1,
                                            }}
                                        >
                                            {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🏭 Iniciar proceso' : '⚠️ Template no encontrado'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
            </>
            )}

            {/* ── COMPUESTOS section ── (Admin/Quimico only) */}
            {canSeeSecretFormulas && COMPUESTOS.length > 0 && (
                <>
                    <div style={{ margin: '1.5rem 0 0.75rem' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                            🍓 Compuestos
                        </h2>
                        <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                            Base saborizada por cada sabor
                        </p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                        {COMPUESTOS.map((premix) => {
                            const template = getTemplate(premix.code);
                            const tid = template?.id;
                            const isStarting = starting === premix.code;
                            const flavor = extractFlavor(premix.name);
                            const bg = (FLAVOR_META[flavor] || DEFAULT_META).color;
                            return (
                                <div key={premix.code} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                    <div style={{ background: bg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.5rem 0.75rem' }}>
                                        <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{premix.description}</p>
                                        <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                            <input type="number" min="1" max="100" value={quantities[premix.code] || 1} onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                        </div>
                                        <button onClick={() => handleStart(premix)} disabled={loading || isStarting || !tid}
                                            style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: tid ? bg : '#e2e8f0', color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: tid && !isStarting ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStarting ? .7 : 1 }}>
                                            {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🍓 Preparar' : '⚠️ Template no encontrado'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* ── ESFERAS section ── (Admin/Quimico only) */}
            {canSeeSecretFormulas && (
            <>
                <div style={{ margin: '1.5rem 0 0.75rem' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                        ⚪ Esferas
                    </h2>
                    <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                        Esferificación — un solo proceso genérico para todos los sabores
                    </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                    {(() => {
                        const esfTemplate = getTemplate(ESFERIFICACION_TEMPLATE);
                        const esfTid = esfTemplate?.id;
                        const isStartingEsf = starting === ESFERIFICACION_TEMPLATE;
                        const esfBg = 'linear-gradient(135deg, #14b8a6, #0d9488)';
                        return (
                            <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                <div style={{ background: esfBg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '1.2rem' }}>⚪</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>Esferas {selectedFlavor}</div>
                                        <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{ESFERIFICACION_TEMPLATE}</div>
                                    </div>
                                </div>
                                <div style={{ padding: '0.5rem 0.75rem' }}>
                                    <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3 }}>Alginato + Compuesto {selectedFlavor}</p>
                                    <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Sabor</label>
                                    <select value={selectedFlavor} onChange={e => setSelectedFlavor(e.target.value)}
                                        style={{ width: '100%', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.8rem', fontWeight: 600, marginBottom: '.5rem', marginTop: '.15rem', outline: 'none', cursor: 'pointer' }}>
                                        {FLAVORS.map(f => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                    <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [ESFERIFICACION_TEMPLATE]: Math.max(1, (prev[ESFERIFICACION_TEMPLATE] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                        <input type="number" min="1" max="100" value={quantities[ESFERIFICACION_TEMPLATE] || 1} onChange={e => setQuantities(prev => ({ ...prev, [ESFERIFICACION_TEMPLATE]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [ESFERIFICACION_TEMPLATE]: Math.min(100, (prev[ESFERIFICACION_TEMPLATE] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    </div>
                                    <button onClick={() => handleStart({ code: ESFERIFICACION_TEMPLATE, flavorKey: selectedFlavor })} disabled={loading || isStartingEsf || !esfTid}
                                        style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: esfTid ? esfBg : '#e2e8f0', color: esfTid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: esfTid && !isStartingEsf ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStartingEsf ? .7 : 1 }}>
                                        {isStartingEsf ? '⏳ Iniciando...' : loading ? 'Cargando...' : esfTid ? `⚪ Preparar Esferas ${selectedFlavor}` : '⚠️ Template no encontrado'}
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </>
            )}

            {/* ── PROTECCIÓN section ── (visible to all authorized roles) */}
            {(canSeeSecretFormulas || isProduccion) && (<>
                <div style={{ margin: '1.5rem 0 0.75rem' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                        🛡️ Protección
                    </h2>
                    <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                        Baño ácido — cada sabor tiene su propia fórmula
                    </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                    {PROTECCIONES.map((premix) => {
                        const template = getTemplate(premix.code);
                        const tid = template?.id;
                        const isStarting = starting === premix.code;
                        const flavor = extractFlavor(premix.name);
                        const bg = (FLAVOR_META[flavor] || { color: 'linear-gradient(135deg, #f97316, #ea580c)' }).color;
                        return (
                            <div key={premix.code} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                <div style={{ background: bg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                        <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                    </div>
                                </div>
                                <div style={{ padding: '0.5rem 0.75rem' }}>
                                    <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{premix.description}</p>
                                    <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                        <input type="number" min="1" max="100" value={quantities[premix.code] || 1} onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    </div>
                                    <button onClick={() => handleStart(premix)} disabled={loading || isStarting || !tid}
                                        style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: tid ? bg : '#e2e8f0', color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: tid && !isStarting ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStarting ? .7 : 1 }}>
                                        {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🛡️ Preparar' : '⚠️ Template no encontrado'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>)}

            {/* ═══ END LIQUIPOPS TAB ═══ */}
            </>)}

            {/* ════════ GENIALITY TAB ════════ */}
            {activeTab === 'geniality' && (<>

            {/* ── BASE SIROPE process ── */}
            <>
                <div style={{ margin: '0 0 0.75rem' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                        🏭 Proceso Base
                    </h2>
                    <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                        Base intermedia para todas las saborizaciones
                    </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {[{ name: 'Base Sirope Clásica', code: 'TMPL064', emoji: '🍯', description: 'Gomas + Sucralosa + Azúcar + Agua + Sorbato + Fructosa' }].map((premix) => {
                        const template = getTemplate(premix.code);
                        const tid = template?.id;
                        const isStarting = starting === premix.code;
                        const bg = 'linear-gradient(135deg, #d97706, #b45309)';
                        return (
                            <div key={premix.code} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                <div style={{ background: bg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                        <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                    </div>
                                </div>
                                <div style={{ padding: '0.5rem 0.75rem' }}>
                                    <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3 }}>{premix.description}</p>
                                    <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                        <input type="number" min="1" max="100" value={quantities[premix.code] || 1} onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                        <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    </div>
                                    <button onClick={() => handleStart(premix)} disabled={loading || isStarting || !tid}
                                        style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: tid ? bg : '#e2e8f0', color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: tid && !isStarting ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStarting ? .7 : 1 }}>
                                        {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🏭 Iniciar proceso' : '⚠️ Template no encontrado'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>

            {/* ── SABORIZACIONES section ── */}
            {SABORIZACIONES.length > 0 && (
                <>
                    <div style={{ margin: '1.5rem 0 0.75rem' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                            🧪 Saborizaciones
                        </h2>
                        <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                            Proceso intermedio — Base sirope + sabor + colorantes
                        </p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                        {SABORIZACIONES.map((premix) => {
                            const template = getTemplate(premix.code);
                            const tid = template?.id;
                            const isStarting = starting === premix.code;
                            const bg = 'linear-gradient(135deg, #ea580c, #c2410c)';
                            return (
                                <div key={premix.code} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                    <div style={{ background: bg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.5rem 0.75rem' }}>
                                        <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{premix.description}</p>
                                        <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                            <input type="number" min="1" max="100" value={quantities[premix.code] || 1} onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                        </div>
                                        <button onClick={() => handleStart(premix)} disabled={loading || isStarting || !tid}
                                            style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: tid ? bg : '#e2e8f0', color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: tid && !isStarting ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStarting ? .7 : 1 }}>
                                            {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🧪 Saborizar' : '⚠️ Template no encontrado'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* ── SIROPES GENIALITY section ── */}
            {SIROPES_GENIALITY.length > 0 && (
                <>
                    <div style={{ margin: '1.5rem 0 0.75rem' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                            🍯 Siropes Geniality
                        </h2>
                        <p style={{ color: '#64748b', margin: '.15rem 0 0', fontSize: '.8rem' }}>
                            Producto terminado — Siropes embotellados
                        </p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                        {SIROPES_GENIALITY.map((premix) => {
                            const template = getTemplate(premix.code);
                            const tid = template?.id;
                            const isStarting = starting === premix.code;
                            const bg = {
                                'TMPL066': 'linear-gradient(135deg, #eab308, #ca8a04)',
                                'TMPL067': 'linear-gradient(135deg, #f59e0b, #ea580c)',
                            }[premix.code] || 'linear-gradient(135deg, #eab308, #ca8a04)';
                            return (
                                <div key={premix.code} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.06)', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.12)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.06)'; }}>
                                    <div style={{ background: bg, padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.2rem' }}>{premix.emoji}</span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: '#fff', fontWeight: 700, fontSize: '.9rem', lineHeight: 1.2 }}>{premix.name}</div>
                                            <div style={{ color: 'rgba(255,255,255,.75)', fontSize: '.65rem' }}>{premix.code}</div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.5rem 0.75rem' }}>
                                        <p style={{ color: '#64748b', fontSize: '.65rem', margin: '0 0 .3rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{premix.description}</p>
                                        <label style={{ fontWeight: 600, fontSize: '.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>Cantidad de Lotes</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '.3rem 0 .5rem' }}>
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, (prev[premix.code] || 1) - 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                            <input type="number" min="1" max="100" value={quantities[premix.code] || 1} onChange={e => setQuantities(prev => ({ ...prev, [premix.code]: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))} style={{ width: 50, textAlign: 'center', padding: '.3rem', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: '.9rem', fontWeight: 700, outline: 'none' }} />
                                            <button onClick={() => setQuantities(prev => ({ ...prev, [premix.code]: Math.min(100, (prev[premix.code] || 1) + 1) }))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '1rem', fontWeight: 700, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                        </div>
                                        <button onClick={() => handleStart(premix)} disabled={loading || isStarting || !tid}
                                            style={{ width: '100%', padding: '.4rem', borderRadius: 8, border: 'none', background: tid ? bg : '#e2e8f0', color: tid ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: '.8rem', cursor: tid && !isStarting ? 'pointer' : 'not-allowed', transition: 'opacity .2s', opacity: isStarting ? .7 : 1 }}>
                                            {isStarting ? '⏳ Iniciando...' : loading ? 'Cargando...' : tid ? '🍯 Iniciar proceso' : '⚠️ Template no encontrado'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* ═══ END GENIALITY TAB ═══ */}
            </>)}

            {/* ── Conflict dialog (active batch exists) ── */}
            {conflictDialog && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }} onClick={() => setConflictDialog(null)}>
                    <div style={{
                        background: '#fff', borderRadius: 20, padding: '2rem', maxWidth: 460, width: '90%',
                        boxShadow: '0 20px 60px rgba(0,0,0,.3)',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                            <span style={{ fontSize: '3rem' }}>⚠️</span>
                            <h3 style={{ margin: '.5rem 0 .25rem', fontSize: '1.2rem', fontWeight: 700, color: '#1e293b' }}>
                                Proceso en Curso
                            </h3>
                            <p style={{ color: '#64748b', fontSize: '.9rem', margin: 0 }}>
                                Ya existe {conflictDialog.activeBatches.length === 1 ? 'un bache activo' : `${conflictDialog.activeBatches.length} baches activos`} de <strong>{conflictDialog.premix.name}</strong>
                            </p>
                        </div>

                        {/* List active batches */}
                        <div style={{ marginBottom: '1.25rem', maxHeight: 280, overflowY: 'auto' }}>
                            {conflictDialog.activeBatches.map(b => (
                                <div key={b.id} style={{
                                    background: '#f8fafc', borderRadius: 10, padding: '.75rem 1rem',
                                    border: '1px solid #e2e8f0', marginBottom: '.5rem',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '.8rem', fontWeight: 700, color: '#4f46e5' }}>
                                            {b.batchNumber}
                                        </div>
                                        <div style={{ fontSize: '.75rem', color: '#64748b' }}>
                                            {b.completedNotes}/{b.totalNotes} etapas completadas
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '.4rem' }}>
                                        <button
                                            onClick={() => handleContinue(b)}
                                            style={{
                                                background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8,
                                                padding: '.4rem .75rem', fontWeight: 600, fontSize: '.8rem', cursor: 'pointer'
                                            }}
                                        >
                                            ▶ Continuar
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (!confirm(`¿Eliminar bache ${b.batchNumber}?`)) return;
                                                try {
                                                    await api.delete(`/production-batches/${b.id}`);
                                                    const remaining = conflictDialog.activeBatches.filter(x => x.id !== b.id);
                                                    if (remaining.length === 0) {
                                                        setConflictDialog(null);
                                                    } else {
                                                        setConflictDialog({ ...conflictDialog, activeBatches: remaining });
                                                    }
                                                } catch (err) {
                                                    alert('Error: ' + (err.response?.data?.error || err.message));
                                                }
                                            }}
                                            style={{
                                                background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 8,
                                                padding: '.4rem .5rem', fontWeight: 600, fontSize: '.8rem', cursor: 'pointer'
                                            }}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                            <button
                                onClick={() => handleStart(conflictDialog.premix, true)}
                                style={{
                                    width: '100%', padding: '.7rem', borderRadius: 10, border: 'none',
                                    background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff',
                                    fontWeight: 700, fontSize: '.9rem', cursor: 'pointer',
                                }}
                            >
                                ➕ Crear uno nuevo adicional
                            </button>
                            {conflictDialog.activeBatches.length === 1 && (
                                <button
                                    onClick={() => handleDeleteAndStart(conflictDialog.premix, conflictDialog.activeBatches[0].id)}
                                    style={{
                                        width: '100%', padding: '.7rem', borderRadius: 10,
                                        border: '2px solid #ef4444', background: '#fff', color: '#ef4444',
                                        fontWeight: 700, fontSize: '.9rem', cursor: 'pointer',
                                    }}
                                >
                                    🗑️ Eliminar actual e iniciar nuevo
                                </button>
                            )}
                            <button
                                onClick={() => setConflictDialog(null)}
                                style={{
                                    width: '100%', padding: '.6rem', borderRadius: 10,
                                    border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b',
                                    fontWeight: 600, fontSize: '.85rem', cursor: 'pointer',
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const fs = require('fs');
const file = '/var/www/gestionpbi/frontend/src/components/GenialityRunner/steps/GConteoCarritosStep.jsx';
let content = fs.readFileSync(file, 'utf8');

const rpaTagDef = `
const RpaStatusTag = ({ executionId }) => {
    const [status, React_useState] = React.useState('PENDING');
    const [noteCode, setNoteCode] = React.useState(null);

    React.useEffect(() => {
        let timer;
        const checkStatus = async () => {
            try {
                const res = await api.get(\`/rpa/\${executionId}\`);
                if (res.data) {
                    React_useState(res.data.status);
                    if (res.data.siigoNoteCode) {
                        setNoteCode(res.data.siigoNoteCode);
                    }
                    if (res.data.status === 'COMPLETED' || res.data.status === 'FAILED') {
                        return;
                    }
                }
            } catch (e) {
                console.warn('RPA poll err:', e.message);
            }
            timer = setTimeout(checkStatus, 3000);
        };
        checkStatus();
        return () => clearTimeout(timer);
    }, [executionId]);

    if (status === 'COMPLETED' && noteCode) {
        return (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 font-black text-[10px] uppercase rounded-md border border-blue-200">
                <span className="text-blue-500 font-extrabold text-[12px]">📝</span> 
                {noteCode}
            </div>
        );
    }
    if (status === 'FAILED') {
        return (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 font-black text-[10px] uppercase rounded-md border border-red-200">
                <span className="text-red-500 font-extrabold text-[12px]">⚠️</span> 
                ERROR RPA
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-500 font-black text-[10px] uppercase rounded-md border border-slate-200">
            <Loader2 size={12} className="animate-spin" />
            CREANDO ENSAMBLE...
        </div>
    );
};
`;

if (!content.includes('RpaStatusTag')) {
    content = content.replace('const GConteoCarritosStep', rpaTagDef + '\nconst GConteoCarritosStep');
}

// Replace the labeledAt and receivedAt UI for isPackagingRole
const btnRegex = /c\.labeledAt \? \([\s\S]*?\) : c\.receivedAt \? \([\s\S]*?\) : null/m;
const newBtnLogic = `c.receivedAt ? (
    <div className="flex items-center gap-2">
        {c.photoUrl && (
            <button 
                onClick={() => setPreviewImage(c.photoUrl)} 
                className="w-10 h-10 rounded border border-emerald-200 overflow-hidden shadow-sm inline-block shrink-0 active:scale-95 transition-transform"
            >
                <img src={c.photoUrl} alt="Evidencia" className="w-full h-full object-cover" />
            </button>
        )}
        {c.rpaExecutionId ? (
            <RpaStatusTag executionId={c.rpaExecutionId} />
        ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 font-black text-[10px] uppercase rounded-md border border-emerald-200">
                <span className="text-emerald-500 font-extrabold text-[12px]">✓</span> 
                RECIBIDO OK
            </div>
        )}
    </div>
) : null`;

content = content.replace(btnRegex, newBtnLogic);

fs.writeFileSync(file, content, 'utf8');
console.log('GConteoCarritosStep patched!');

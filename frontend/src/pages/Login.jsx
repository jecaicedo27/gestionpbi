import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/common/Button';
import { LockKeyhole, Mail } from 'lucide-react';

const Login = () => {
    const [mode, setMode] = useState('email'); // 'email' | 'pin'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [pinDigits, setPinDigits] = useState(['', '', '', '']);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, unlockWithPin } = useAuth();
    const navigate = useNavigate();
    const pinRefs = [useRef(), useRef(), useRef(), useRef()];

    const handleEmailSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const success = await login(email, password);
            if (success) {
                navigate('/');
            } else {
                setError('Credenciales inválidas');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al iniciar sesión');
        }
        setLoading(false);
    };

    const handlePinChange = (index, value) => {
        if (!/^\d?$/.test(value)) return;
        const newDigits = [...pinDigits];
        newDigits[index] = value;
        setPinDigits(newDigits);
        setError('');

        // Auto-focus next input
        if (value && index < 3) {
            pinRefs[index + 1].current?.focus();
        }

        // Auto-submit when all 4 digits are entered
        if (value && index === 3 && newDigits.every(d => d !== '')) {
            submitPin(newDigits.join(''));
        }
    };

    const handlePinKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
            pinRefs[index - 1].current?.focus();
        }
        if (e.key === 'Enter') {
            const pin = pinDigits.join('');
            if (pin.length === 4) submitPin(pin);
        }
    };

    const handlePinPaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
        if (pasted.length === 4) {
            const digits = pasted.split('');
            setPinDigits(digits);
            pinRefs[3].current?.focus();
            submitPin(pasted);
        }
    };

    const submitPin = async (pin) => {
        setLoading(true);
        setError('');
        try {
            const result = await unlockWithPin(pin);
            if (result.success) {
                navigate('/');
            } else {
                setError(result.error || 'PIN incorrecto');
                setPinDigits(['', '', '', '']);
                pinRefs[0].current?.focus();
            }
        } catch (err) {
            setError('Error de conexión');
            setPinDigits(['', '', '', '']);
            pinRefs[0].current?.focus();
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
                <div className="text-center mb-6">
                    <h1 className="text-3xl font-bold text-primary-600 mb-2">Popping Boba</h1>
                    <p className="text-neutral-500">Sistema de Gestión de Recursos (MRP)</p>
                </div>

                {/* Tab switcher */}
                <div className="flex bg-neutral-100 rounded-lg p-1 mb-6">
                    <button
                        onClick={() => { setMode('email'); setError(''); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all ${
                            mode === 'email'
                                ? 'bg-white text-primary-700 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        <Mail size={16} /> Email
                    </button>
                    <button
                        onClick={() => { setMode('pin'); setError(''); setPinDigits(['', '', '', '']); setTimeout(() => pinRefs[0].current?.focus(), 100); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all ${
                            mode === 'pin'
                                ? 'bg-white text-indigo-700 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        <LockKeyhole size={16} /> PIN
                    </button>
                </div>

                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm text-center font-medium">
                        {error}
                    </div>
                )}

                {mode === 'email' ? (
                    /* ── Email / Password form ── */
                    <form onSubmit={handleEmailSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
                            <input
                                type="email"
                                required
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Contraseña</label>
                            <input
                                type="password"
                                required
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                        <Button type="submit" className="w-full justify-center mt-2" disabled={loading}>
                            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
                        </Button>
                    </form>
                ) : (
                    /* ── PIN form ── */
                    <div className="space-y-5">
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                                <LockKeyhole size={28} />
                            </div>
                            <p className="text-sm text-neutral-600">Ingresa tu PIN de 4 dígitos</p>
                        </div>
                        <div className="flex justify-center gap-3" onPaste={handlePinPaste}>
                            {pinDigits.map((digit, i) => (
                                <input
                                    key={i}
                                    ref={pinRefs[i]}
                                    type="password"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handlePinChange(i, e.target.value)}
                                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                                    className="w-14 h-16 text-center text-3xl font-bold font-mono border-2 border-neutral-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                                    autoFocus={i === 0}
                                    disabled={loading}
                                />
                            ))}
                        </div>
                        {loading && (
                            <p className="text-center text-sm text-indigo-500 font-medium animate-pulse">
                                Verificando PIN...
                            </p>
                        )}
                        <p className="text-xs text-neutral-400 text-center">
                            El PIN te lo asigna tu administrador
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Login;

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'scroll', 'click'];

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const inactivityTimer = useRef(null);
    const lastUserRef = useRef(null); // Keep reference to last user for lock screen

    // ── Initial auth check ──────────────────────────────────────
    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    const res = await api.get('/auth/me');
                    setUser(res.data.user);
                    lastUserRef.current = res.data.user;

                    // Check if session was locked before page refresh
                    if (sessionStorage.getItem('pinLocked') === 'true') {
                        setIsLocked(true);
                    }
                } catch (error) {
                    console.error('Auth check failed', error);
                    localStorage.removeItem('token');
                }
            }
            setLoading(false);
        };
        checkAuth();
    }, []);

    // ── Inactivity timer ────────────────────────────────────────
    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimer.current) {
            clearTimeout(inactivityTimer.current);
        }
        // Only set timer if user is logged in and not already locked
        // Exclude DISTRIBUIDOR — they access from their own device
        if (user && !isLocked && user.role !== 'DISTRIBUIDOR') {
            inactivityTimer.current = setTimeout(() => {
                setIsLocked(true);
                sessionStorage.setItem('pinLocked', 'true');
            }, INACTIVITY_TIMEOUT_MS);
        }
    }, [user, isLocked]);

    useEffect(() => {
        if (!user || user.role === 'DISTRIBUIDOR') return;

        // Reset timer on any activity
        const handleActivity = () => {
            if (!isLocked) {
                resetInactivityTimer();
            }
        };

        ACTIVITY_EVENTS.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });

        // Start initial timer
        resetInactivityTimer();

        return () => {
            ACTIVITY_EVENTS.forEach(event => {
                window.removeEventListener(event, handleActivity);
            });
            if (inactivityTimer.current) {
                clearTimeout(inactivityTimer.current);
            }
        };
    }, [user, isLocked, resetInactivityTimer]);

    // ── Login (email + password) ────────────────────────────────
    const login = async (email, password) => {
        const res = await api.post('/auth/login', { email, password });
        if (res.data.success) {
            localStorage.setItem('token', res.data.token);
            setUser(res.data.user);
            lastUserRef.current = res.data.user;
            setIsLocked(false);
            sessionStorage.removeItem('pinLocked');
            return true;
        }
        return false;
    };

    // ── Logout ──────────────────────────────────────────────────
    const logout = () => {
        localStorage.removeItem('token');
        sessionStorage.removeItem('pinLocked');
        setUser(null);
        setIsLocked(false);
        lastUserRef.current = null;
    };

    // ── Lock screen manually ────────────────────────────────────
    const lockScreen = () => {
        if (user && user.role !== 'DISTRIBUIDOR') {
            lastUserRef.current = user;
            setIsLocked(true);
            sessionStorage.setItem('pinLocked', 'true');
        }
    };

    // ── Unlock with PIN ─────────────────────────────────────────
    const unlockWithPin = async (pin) => {
        try {
            const res = await api.post('/auth/pin-login', { pin });
            if (res.data.success) {
                const newUser = res.data.user;
                const newToken = res.data.token;

                // Update token and user
                localStorage.setItem('token', newToken);
                setUser(newUser);
                lastUserRef.current = newUser;
                setIsLocked(false);
                sessionStorage.removeItem('pinLocked');

                // Return info about whether user/role changed
                const userChanged = user?.id !== newUser.id;
                const roleChanged = user?.role !== newUser.role;

                return {
                    success: true,
                    userChanged,
                    roleChanged,
                    newUser,
                    previousRole: user?.role
                };
            }
            return { success: false, error: 'PIN incorrecto' };
        } catch (error) {
            const msg = error.response?.data?.error || error.response?.data?.message || 'Error de conexión';
            return { success: false, error: msg };
        }
    };

    // ── Full logout from lock screen (→ email/password login) ───
    const fullLogoutFromLock = () => {
        logout();
    };

    return (
        <AuthContext.Provider value={{
            user,
            token: localStorage.getItem('token'),
            login,
            logout,
            loading,
            isLocked,
            lockScreen,
            unlockWithPin,
            fullLogoutFromLock,
            lastUser: lastUserRef.current
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

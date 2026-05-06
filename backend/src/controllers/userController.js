const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const {
    createShiftEmployeeFromUser,
    isOperationalUserRole,
} = require('../services/shiftEmployeeSyncService');

const VALID_USER_ROLES = new Set([
    'ADMIN',
    'LOGISTICA',
    'OPERARIO_PICKING',
    'PRODUCCION',
    'CARTERA',
    'DISTRIBUIDOR',
    'CALIDAD',
    'CONTABILIDAD',
    'COMERCIAL',
    'QUIMICO',
    'RECURSOS_HUMANOS',
    'MECANICO'
]);

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const sanitizeUsername = (value) => {
    const sanitized = normalizeText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 48);

    return sanitized || 'user';
};

const getUniqueGeneratedUsername = async (email) => {
    const [localPart] = email.split('@');
    const base = sanitizeUsername(localPart);
    let candidate = base;
    let suffix = 2;

    while (await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })) {
        candidate = `${base}${suffix}`;
        suffix += 1;
    }

    return candidate;
};

const parseDiscountPercent = (value) => {
    if (value === undefined || value === null || value === '') return 34.8;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
};

const parseBoolean = (value, defaultValue = true) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
};

const isPrismaUniqueError = (error, field) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        return false;
    }
    const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
    return target.includes(field);
};

const handleUserWriteError = (res, error, fallbackMessage) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
            if (target.includes('email')) {
                return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
            }
            if (target.includes('username')) {
                return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario.' });
            }
            return res.status(409).json({ error: 'Ya existe un usuario con esos datos.' });
        }

        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
    }

    console.error(error);
    return res.status(500).json({ error: fallbackMessage });
};

const getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true, role: true, nit: true, idType: true, discountPercent: true, reteFuente: true, isCleaningStaff: true, isCleaningSupervisor: true, isCleaningOnly: true, createdAt: true, pin: true }
        });
        // Map pin hash → boolean flag (never expose the hash)
        const safeUsers = users.map(({ pin, ...u }) => ({ ...u, hasPin: !!pin }));
        res.json({ success: true, data: safeUsers });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
};

const createUser = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            role,
            username,
            nit,
            idType,
            discountPercent,
            reteFuente,
            addToShiftSchedule,
            shiftArea,
            shiftEmployeeRole,
            shiftGroupNumber,
            shiftIsFixed,
        } = req.body;
        const cleanName = normalizeText(name);
        const cleanEmail = normalizeEmail(email);
        const cleanPassword = typeof password === 'string' ? password : '';
        const cleanRole = normalizeText(role).toUpperCase();

        if (!cleanName || !cleanEmail || !cleanPassword || !cleanRole) {
            return res.status(400).json({ error: 'Nombre, email, contraseña y rol son obligatorios.' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ error: 'El email no tiene un formato válido.' });
        }

        if (!VALID_USER_ROLES.has(cleanRole)) {
            return res.status(400).json({ error: 'El rol seleccionado no es válido.' });
        }

        const parsedDiscountPercent = parseDiscountPercent(discountPercent);
        if (parsedDiscountPercent === null) {
            return res.status(400).json({ error: 'El descuento debe estar entre 0 y 100.' });
        }

        const existingEmail = await prisma.user.findUnique({ where: { email: cleanEmail }, select: { id: true } });
        if (existingEmail) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
        }

        const explicitUsername = normalizeText(username);
        const usesGeneratedUsername = !explicitUsername;
        let finalUsername = usesGeneratedUsername
            ? await getUniqueGeneratedUsername(cleanEmail)
            : sanitizeUsername(explicitUsername);

        const hashedPassword = await bcrypt.hash(cleanPassword, 10);
        const userData = {
            name: cleanName,
            email: cleanEmail,
            password: hashedPassword,
            role: cleanRole,
            nit: normalizeText(nit) || null,
            idType: normalizeText(idType) || '13',
            discountPercent: parsedDiscountPercent,
            reteFuente: parseBoolean(reteFuente, true)
        };
        let user;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                user = await prisma.user.create({
                    data: { ...userData, username: finalUsername }
                });
                break;
            } catch (error) {
                if (!usesGeneratedUsername || !isPrismaUniqueError(error, 'username') || attempt === 2) {
                    throw error;
                }
                finalUsername = await getUniqueGeneratedUsername(cleanEmail);
            }
        }

        let shiftEmployee = null;
        let shiftSyncWarning = null;
        const shouldAddToShiftSchedule = parseBoolean(addToShiftSchedule, false);

        if (shouldAddToShiftSchedule) {
            if (isOperationalUserRole(user.role)) {
                try {
                    const result = await createShiftEmployeeFromUser(prisma, user, {
                        area: shiftArea,
                        role: shiftEmployeeRole,
                        groupNumber: shiftGroupNumber,
                        isFixed: shiftIsFixed,
                        assignCurrentWeek: true,
                    });
                    shiftEmployee = result.employee;
                } catch (syncError) {
                    shiftSyncWarning = syncError.message;
                    console.error('Error syncing user to shift schedule:', syncError);
                }
            } else {
                shiftSyncWarning = 'Solo usuarios de Produccion, Picking/Empaque o Logistica se agregan automaticamente al cuadro de turnos.';
            }
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                username: user.username,
                shiftEmployee: shiftEmployee
                    ? { id: shiftEmployee.id, area: shiftEmployee.area, role: shiftEmployee.role }
                    : null,
                shiftSyncWarning,
            }
        });
    } catch (error) {
        handleUserWriteError(res, error, 'Error creating user');
    }
};

const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.$transaction(async (tx) => {
            // Limpiar referencias en shift_employees antes de borrar el user
            // (ShiftEmployee.userId no tiene onDelete:Cascade en el schema).
            const shiftEmp = await tx.shiftEmployee.findFirst({
                where: { userId: id },
                select: { id: true },
            });
            if (shiftEmp) {
                // Si tiene asistencias/historial, solo desvincular (no borrar) para preservar trazabilidad.
                const hasAttendance = await tx.attendanceRecord.count({
                    where: { employeeId: shiftEmp.id },
                });
                if (hasAttendance > 0) {
                    await tx.shiftEmployee.update({
                        where: { id: shiftEmp.id },
                        data: { userId: null, active: false },
                    });
                } else {
                    // Sin historial: limpiar asignaciones de turno y borrar el shiftEmployee
                    await tx.shiftAssignment.deleteMany({ where: { employeeId: shiftEmp.id } });
                    await tx.shiftAbsence.deleteMany({ where: { employeeId: shiftEmp.id } });
                    await tx.shiftEmployee.delete({ where: { id: shiftEmp.id } });
                }
            }
            await tx.user.delete({ where: { id } });
        });
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        handleUserWriteError(res, error, 'Error deleting user');
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { nit, name, role, idType, discountPercent, reteFuente, isCleaningStaff, isCleaningSupervisor, isCleaningOnly } = req.body;
        const data = {};
        if (nit !== undefined) data.nit = normalizeText(nit) || null;
        if (idType !== undefined) data.idType = normalizeText(idType) || '13';
        if (discountPercent !== undefined) {
            const parsedDiscountPercent = parseDiscountPercent(discountPercent);
            if (parsedDiscountPercent === null) {
                return res.status(400).json({ error: 'El descuento debe estar entre 0 y 100.' });
            }
            data.discountPercent = parsedDiscountPercent;
        }
        if (reteFuente !== undefined) data.reteFuente = parseBoolean(reteFuente, true);
        if (isCleaningStaff !== undefined) data.isCleaningStaff = parseBoolean(isCleaningStaff, false);
        if (isCleaningSupervisor !== undefined) data.isCleaningSupervisor = parseBoolean(isCleaningSupervisor, false);
        if (isCleaningOnly !== undefined) data.isCleaningOnly = parseBoolean(isCleaningOnly, false);
        if (name !== undefined) {
            const cleanName = normalizeText(name);
            if (!cleanName) return res.status(400).json({ error: 'El nombre no puede estar vacío.' });
            data.name = cleanName;
        }
        if (role !== undefined) {
            const cleanRole = normalizeText(role).toUpperCase();
            if (!VALID_USER_ROLES.has(cleanRole)) {
                return res.status(400).json({ error: 'El rol seleccionado no es válido.' });
            }
            data.role = cleanRole;
        }

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, name: true, email: true, role: true, nit: true, idType: true, discountPercent: true, reteFuente: true, isCleaningStaff: true, isCleaningSupervisor: true, isCleaningOnly: true }
        });
        res.json({ success: true, data: user });
    } catch (error) {
        handleUserWriteError(res, error, 'Error updating user');
    }
};

module.exports = { getUsers, createUser, deleteUser, updateUser };

const WEEK_NOTE = 'NOCHE: Dom 22:00 -> Vie amanecer Sab 6:00 | MANANA: Lun-Sab(12PM) | TARDE: Lun-Sab(18h)';

const SHIFT_OPERATION_USER_ROLES = ['PRODUCCION', 'OPERARIO_PICKING', 'LOGISTICA'];
const SHIFT_OPERATION_AREAS = ['PRODUCCION', 'SIROPES', 'EMPAQUE', 'LOGISTICA', 'ASEO'];
const ROTATION_ORDER = ['MANANA', 'TARDE', 'NOCHE'];
const FIXED_SHIFT_AREAS = ['LOGISTICA', 'ASEO'];

const DEFAULT_AREA_BY_USER_ROLE = {
    PRODUCCION: 'PRODUCCION',
    OPERARIO_PICKING: 'EMPAQUE',
    LOGISTICA: 'LOGISTICA',
};

const KNOWN_USER_SHIFT_DEFAULTS = {
    'hugo.armando@pbi.local': { area: 'LOGISTICA', isFixed: true },
    'leddy@pbi.com': { area: 'ASEO', isFixed: true },
};

const AREA_ALIASES = {
    PRODUCCION: 'PRODUCCION',
    PRODUCTION: 'PRODUCCION',
    SIROPE: 'SIROPES',
    SIROPES: 'SIROPES',
    EMPAQUE: 'EMPAQUE',
    PACKING: 'EMPAQUE',
    PICKING: 'EMPAQUE',
    OPERARIO_PICKING: 'EMPAQUE',
    LOGISTICA: 'LOGISTICA',
    ASEO: 'ASEO',
    SERVICIOS_GENERALES: 'ASEO',
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeKey = (value) => normalizeText(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

const isOperationalUserRole = (role) => SHIFT_OPERATION_USER_ROLES.includes(normalizeKey(role));

const getKnownUserShiftDefault = (user) => {
    const emailKey = normalizeText(user?.email).toLowerCase();
    if (emailKey && KNOWN_USER_SHIFT_DEFAULTS[emailKey]) return KNOWN_USER_SHIFT_DEFAULTS[emailKey];

    const nameKey = normalizeKey(user?.name);
    if (nameKey.includes('HUGO')) return { area: 'LOGISTICA', isFixed: true };
    if (nameKey.includes('LEDDY')) return { area: 'ASEO', isFixed: true };

    return null;
};

const normalizeShiftArea = (value, fallbackRole = '') => {
    const normalized = AREA_ALIASES[normalizeKey(value)];
    if (normalized) return normalized;
    const fallback = DEFAULT_AREA_BY_USER_ROLE[normalizeKey(fallbackRole)];
    return fallback || 'PRODUCCION';
};

const isFixedShiftArea = (area) => FIXED_SHIFT_AREAS.includes(normalizeShiftArea(area));

const suggestShiftAreaForUser = (user) => (
    getKnownUserShiftDefault(user)?.area
    || DEFAULT_AREA_BY_USER_ROLE[normalizeKey(user?.role)]
    || 'PRODUCCION'
);

const suggestIsFixedForUser = (user) => {
    const known = getKnownUserShiftDefault(user);
    if (known?.isFixed !== undefined) return Boolean(known.isFixed);
    return isFixedShiftArea(suggestShiftAreaForUser(user));
};

const normalizeShiftEmployeeRole = (value) => (normalizeKey(value) === 'LIDER' ? 'LIDER' : 'OPERARIO');

const normalizeRestrictions = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map(normalizeKey)
        .filter((shift) => ROTATION_ORDER.includes(shift));
};

const normalizeGroupNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3 ? parsed : null;
};

function getMonday(dateInput) {
    let dStr = dateInput;
    if (typeof dStr === 'string' && dStr.length === 10) dStr += 'T12:00:00';
    const d = new Date(dStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getSunday(monday) {
    const s = new Date(monday);
    s.setDate(s.getDate() + 6);
    s.setHours(23, 59, 59, 999);
    return s;
}

async function ensureCurrentShiftWeek(prisma, dateInput = new Date()) {
    const monday = getMonday(dateInput);
    const sunday = getSunday(monday);

    return prisma.shiftWeek.upsert({
        where: { weekStart: monday },
        create: { weekStart: monday, weekEnd: sunday, note: WEEK_NOTE },
        update: {},
    });
}

async function assignEmployeeToCurrentWeek(prisma, emp, dateInput = new Date()) {
    const week = await ensureCurrentShiftWeek(prisma, dateInput);
    let assignShift = emp.isFixed ? 'DIURNO' : 'MANANA';

    if (!emp.isFixed && emp.groupNumber) {
        const groupMateAssignment = await prisma.shiftAssignment.findFirst({
            where: {
                weekId: week.id,
                employee: { groupNumber: emp.groupNumber, area: emp.area, isFixed: false },
            },
        });

        if (groupMateAssignment) {
            assignShift = groupMateAssignment.shift;
        } else {
            const groupDefaults = { 1: 'MANANA', 2: 'TARDE', 3: 'NOCHE' };
            assignShift = groupDefaults[emp.groupNumber] || 'MANANA';
        }
    }

    if (emp.restrictions?.length > 0 && !emp.restrictions.includes(assignShift)) {
        assignShift = emp.restrictions[0];
    }

    const existing = await prisma.shiftAssignment.findFirst({
        where: { weekId: week.id, employeeId: emp.id },
    });

    if (existing) return existing;

    return prisma.shiftAssignment.create({
        data: {
            weekId: week.id,
            employeeId: emp.id,
            area: emp.area,
            shift: assignShift,
        },
    });
}

async function createShiftEmployeeFromUser(prisma, user, options = {}) {
    if (!user?.id) {
        throw new Error('Usuario no valido para migracion.');
    }

    if (!isOperationalUserRole(user.role)) {
        throw new Error('Solo usuarios de Produccion, Picking/Empaque o Logistica se migran al cuadro de turnos.');
    }

    const employeeArea = normalizeShiftArea(options.area || suggestShiftAreaForUser(user), user.role);
    const employeeIsFixed = options.isFixed === undefined
        ? isFixedShiftArea(employeeArea)
        : Boolean(options.isFixed);

    const employee = await prisma.shiftEmployee.create({
        data: {
            name: normalizeText(user.name) || user.email,
            area: employeeArea,
            role: normalizeShiftEmployeeRole(options.role),
            groupNumber: employeeIsFixed ? null : normalizeGroupNumber(options.groupNumber),
            isFixed: employeeIsFixed,
            restrictions: normalizeRestrictions(options.restrictions),
            whatsapp: normalizeText(options.whatsapp) || user.phone || null,
            userId: user.id,
            active: true,
        },
    });

    const assignment = options.assignCurrentWeek === false
        ? null
        : await assignEmployeeToCurrentWeek(prisma, employee);

    return { employee, assignment };
}

module.exports = {
    WEEK_NOTE,
    FIXED_SHIFT_AREAS,
    SHIFT_OPERATION_AREAS,
    SHIFT_OPERATION_USER_ROLES,
    assignEmployeeToCurrentWeek,
    createShiftEmployeeFromUser,
    isFixedShiftArea,
    isOperationalUserRole,
    normalizeGroupNumber,
    normalizeRestrictions,
    normalizeShiftArea,
    normalizeShiftEmployeeRole,
    suggestIsFixedForUser,
    suggestShiftAreaForUser,
};

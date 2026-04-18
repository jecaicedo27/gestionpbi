export const normalizeInventoryIntegerInput = (value) => {
    const raw = String(value ?? '');
    if (raw === '') return '';

    const digits = raw.replace(/\D/g, '');
    if (digits === '') return '';

    return digits.replace(/^0+(?=\d)/, '') || '0';
};

export const normalizeInventoryDecimalInput = (value) => {
    const raw = String(value ?? '').replace(',', '.');
    if (raw === '') return '';

    let normalized = '';
    let hasDecimalPoint = false;

    for (const char of raw) {
        if (/\d/.test(char)) {
            normalized += char;
            continue;
        }
        if (char === '.' && !hasDecimalPoint) {
            normalized += char;
            hasDecimalPoint = true;
        }
    }

    if (normalized === '') return '';

    const [integerPart, decimalPart = ''] = normalized.split('.');
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';

    return hasDecimalPoint ? `${normalizedInteger}.${decimalPart}` : normalizedInteger;
};

export const parseInventoryNumberInput = (value, fallback = 0) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
};

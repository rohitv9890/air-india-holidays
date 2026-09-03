export const INR_PER_USD = 83;
export const GBP_PER_USD = 0.79;
export const AED_PER_USD = 3.67;

export const DEFAULT_DISPLAY_CURRENCY = 'USD';

export const ORIGIN_DISPLAY_CURRENCY = Object.freeze({
    DEL: 'INR',
    BOM: 'INR',
    BLR: 'INR',
    HYD: 'INR',
    MAA: 'INR',
    CCU: 'INR',
    AMD: 'INR',
    LHR: 'GBP',
    LGW: 'GBP',
    BHX: 'GBP',
    DXB: 'AED',
    AUH: 'AED',
    JFK: 'USD',
    EWR: 'USD',
    ORD: 'USD',
    SFO: 'USD',
});

const DISPLAY_CURRENCIES = new Set(['USD', 'INR', 'GBP', 'AED']);

function finiteAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

export function usdToInr(usd) {
    return Math.round(finiteAmount(usd) * INR_PER_USD);
}

export function usdToGbp(usd) {
    return Math.round(finiteAmount(usd) * GBP_PER_USD);
}

export function usdToAed(usd) {
    return Math.round(finiteAmount(usd) * AED_PER_USD);
}

export function displayCurrencyForOrigin(originIata) {
    const code = String(originIata || '').toUpperCase();
    return ORIGIN_DISPLAY_CURRENCY[code] || DEFAULT_DISPLAY_CURRENCY;
}

export function normalizeDisplayCurrency(value, originIata) {
    const code = String(value || '').toUpperCase();
    if (DISPLAY_CURRENCIES.has(code)) return code;
    return displayCurrencyForOrigin(originIata);
}

export function amountInCurrency(usd, currency = DEFAULT_DISPLAY_CURRENCY) {
    const code = normalizeDisplayCurrency(currency);
    if (code === 'INR') return usdToInr(usd);
    if (code === 'GBP') return usdToGbp(usd);
    if (code === 'AED') return usdToAed(usd);
    return Math.round(finiteAmount(usd));
}

function localeForCurrency(code) {
    if (code === 'INR') return 'en-IN';
    if (code === 'GBP') return 'en-GB';
    if (code === 'AED') return 'en-AE';
    return 'en-US';
}

export function formatDisplayPrice(amount, currency = DEFAULT_DISPLAY_CURRENCY) {
    if (amount == null || !Number.isFinite(Number(amount))) return null;
    const code = normalizeDisplayCurrency(currency);
    return new Intl.NumberFormat(localeForCurrency(code), {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 0,
    }).format(Math.round(Number(amount)));
}

export function displayQuoteFromUsd(usd, currency = DEFAULT_DISPLAY_CURRENCY) {
    const hasKnownAmount = usd != null && Number.isFinite(Number(usd));
    const totals = hasKnownAmount
        ? {
            USD: Math.round(Number(usd)),
            INR: usdToInr(usd),
            GBP: usdToGbp(usd),
            AED: usdToAed(usd),
        }
        : { USD: null, INR: null, GBP: null, AED: null };
    const displayCurrency = normalizeDisplayCurrency(currency);
    const totalAmount = totals[displayCurrency];
    return {
        currency: displayCurrency,
        totalAmount,
        formattedTotal: formatDisplayPrice(totalAmount, displayCurrency),
        totals,
    };
}

// Back-compat alias: some callers may still import the old GBP-based name.
export const displayQuoteFromGbp = displayQuoteFromUsd;

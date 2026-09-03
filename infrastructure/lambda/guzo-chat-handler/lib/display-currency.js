export const EUR_PER_GBP = 1.17;
export const ZAR_PER_GBP = 24;
export const MYR_PER_GBP = 5.7;

export const DEFAULT_DISPLAY_CURRENCY = 'GBP';

export const ORIGIN_DISPLAY_CURRENCY = Object.freeze({
    JNB: 'ZAR',
    CPT: 'ZAR',
    DUR: 'ZAR',
    KUL: 'MYR',
    FRA: 'EUR',
    CDG: 'EUR',
    AMS: 'EUR',
    FCO: 'EUR',
    MAD: 'EUR',
    VIE: 'EUR',
    BRU: 'EUR',
    LHR: 'GBP',
    LGW: 'GBP',
    MAN: 'GBP',
    BHX: 'GBP',
    EDI: 'GBP',
});

const DISPLAY_CURRENCIES = new Set(['GBP', 'EUR', 'ZAR', 'MYR']);

function finiteAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

export function gbpToEur(gbp) {
    return Math.round(finiteAmount(gbp) * EUR_PER_GBP);
}

export function gbpToZar(gbp) {
    return Math.round(finiteAmount(gbp) * ZAR_PER_GBP);
}

export function gbpToMyr(gbp) {
    return Math.round(finiteAmount(gbp) * MYR_PER_GBP);
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

export function amountInCurrency(gbp, currency = DEFAULT_DISPLAY_CURRENCY) {
    const code = normalizeDisplayCurrency(currency);
    if (code === 'EUR') return gbpToEur(gbp);
    if (code === 'ZAR') return gbpToZar(gbp);
    if (code === 'MYR') return gbpToMyr(gbp);
    return Math.round(finiteAmount(gbp));
}

export function formatDisplayPrice(amount, currency = DEFAULT_DISPLAY_CURRENCY) {
    if (amount == null || !Number.isFinite(Number(amount))) return null;
    const code = normalizeDisplayCurrency(currency);
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 0,
    }).format(Math.round(Number(amount)));
}

export function displayQuoteFromGbp(gbp, currency = DEFAULT_DISPLAY_CURRENCY) {
    const hasKnownAmount = gbp != null && Number.isFinite(Number(gbp));
    const totals = hasKnownAmount
        ? {
            GBP: Math.round(Number(gbp)),
            EUR: gbpToEur(gbp),
            ZAR: gbpToZar(gbp),
            MYR: gbpToMyr(gbp),
        }
        : { GBP: null, EUR: null, ZAR: null, MYR: null };
    const displayCurrency = normalizeDisplayCurrency(currency);
    const totalAmount = totals[displayCurrency];
    return {
        currency: displayCurrency,
        totalAmount,
        formattedTotal: formatDisplayPrice(totalAmount, displayCurrency),
        totals,
    };
}

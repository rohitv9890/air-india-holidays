const CABIN_FACTORS = {
    Economy: 1.5,
    Business: 2.5,
    First: 3,
};

const TIER_BONUS_NOTES = {
    classic: 'ShebaMiles you could earn with this holiday and cabin choice.',
    comfort: 'This travel style may earn additional ShebaMiles on selected Ethiopian Airlines flights.',
    signature: 'This travel style may earn additional ShebaMiles with premium cabin choices.',
};

/**
 * Guest ShebaMiles estimate (not a live balance).
 * Economy ≈ floor(totalGBP * 1.5), Business ≈ floor(totalGBP * 2.5).
 * Accepts totalGbp or totalAmount (+ currency).
 */
export function estimateMiles({
    totalGbp,
    totalAmount,
    currency = 'GBP',
    cabin = 'Economy',
    tier = 'classic',
} = {}) {
    let gbp = totalGbp;
    if (gbp == null && totalAmount != null) {
        gbp = Number(totalAmount) || 0;
        if (String(currency).toUpperCase() === 'EUR') gbp = gbp / 1.17;
    }
    const factor = CABIN_FACTORS[cabin] ?? CABIN_FACTORS.Economy;
    const shebaMiles = Math.floor(Number(gbp || 0) * factor);
    return {
        shebaMiles,
        miles: shebaMiles,
        cabin,
        tierBonusNote: TIER_BONUS_NOTES[tier] || TIER_BONUS_NOTES.classic,
        notes: `ShebaMiles you could earn when travelling in ${cabin}.`,
    };
}

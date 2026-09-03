/** Seeded deterministic availability — same inputs always yield same flags. */

function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function availabilitySeed(productId, startDate, adults = 2) {
    return hashString(`${productId}|${startDate}|${adults}`);
}

/**
 * @returns {{ available: boolean, remaining: number, waitlist: boolean, seed: number, note: string }}
 */
export function checkAvailability(productId, startDate, adults = 2) {
    const seed = availabilitySeed(productId, startDate, adults);
    const bucket = seed % 100;
    const available = bucket >= 12;
    const remaining = available ? (seed % 9) + 1 : 0;
    const waitlist = !available && bucket >= 5;
    return {
        available,
        remaining,
        waitlist,
        seed,
        note: available
            ? `Your chosen date is available. ${remaining === 1 ? 'One place is' : `${remaining} places are`} currently left.`
            : waitlist
                ? 'Your chosen date is not available right now, but our travel team can check other options for you.'
                : 'Your chosen date is not available. Please try another date.',
    };
}

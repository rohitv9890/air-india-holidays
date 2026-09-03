/** Server-side input limits and Ethiopia-first helpers */

export const MAX_MESSAGE_LENGTH = 2000;

const ETHIOPIA_DESTINATION_KEYS = [
    'ethiopia', 'addis', 'addis ababa', 'lalibela', 'bahir dar', 'gondar', 'gonder',
    'simien', 'axum', 'aksum', 'omo', 'arba minch', 'bale', 'danakil', 'harar',
    'dire dawa', 'hawassa', 'awash', 'konso', 'tigray', 'lake tana', 'blue nile',
    'erta ale', 'mekelle', 'adama', 'bishoftu', 'jimma', 'rift valley',
    'lli', 'bjr', 'gdq', 'add', 'dir', 'asw', 'awa', 'jim', 'mqx',
];

/** Clearly out-of-scope topics for a holiday chat agent. */
const OUT_OF_SCOPE_PATTERNS = [
    /\b(write|debug|fix|generate)\b.{0,40}\b(code|python|javascript|typescript|html|sql|regex)\b/i,
    /\b(homework|essay|dissertation|solve this (math|equation))\b/i,
    /\b(who (will|won)|election|politics|political party|president of)\b/i,
    /\b(stock tip|crypto|bitcoin|nft)\b/i,
    /\b(medical advice|diagnose|prescription|legal advice|sue)\b/i,
    /\b(tell me a joke|write a poem|sing (me )?a song|role.?play as)\b/i,
    /\b(chatgpt|claude|ignore (all |your )?previous instructions|jailbreak|system prompt)\b/i,
    /\b(recipe for|how to cook|dating advice|horoscope)\b/i,
    /\b(translate|proofread|rewrite|summari[sz]e)\b.{0,50}\b(document|article|email|letter|text)\b/i,
    /\b(write|draft|create)\b.{0,40}\b(email|cover letter|resume|cv|business plan)\b/i,
];

const OTHER_COUNTRY_TRAVEL = /\b(kenya|tanzania|uganda|rwanda|morocco|egypt|dubai|maldives|bali|thailand|japan|italy|france|spain|portugal|greece|turkey|vietnam|india|peru|mexico|south africa|botswana|namibia|zanzibar|seychelles|mauritius)\b.{0,60}\b(trip|travel|holiday|safari|tour|package|flight|hotel|visit)\b|\b(trip|travel|holiday|safari|tour|package|flight|hotel|visit).{0,60}\b(kenya|tanzania|uganda|rwanda|morocco|egypt|dubai|maldives|bali|thailand|japan|italy|france|spain|portugal|greece|turkey|vietnam|india|peru|mexico|south africa|botswana|namibia|zanzibar|seychelles|mauritius)\b/i;
const ADJACENT_TRAVEL = /\b(weather|climate|rain|rainy|season|best time|visa|entry requirements?|passport|vaccin|health requirement|pack|packing|wheelchair|accessib|mobility|culture|customs|etiquette|safe|safety|security|geography|altitude|compare|versus|\bvs\b)\b/i;
const CORRECTION = /\b(forget|ignore|disregard)\b.{0,80}\b(dates?|cabin|class|preferences?|requests?)\b/i;
const ACTIVE_TRIP_REFERENCE = /\b(my|the|this|our)\s+(trip|itinerary|holiday|tour|plan)\b/i;
const HIGH_CONFIDENCE_INJECTION = /\b(chatgpt|claude|jailbreak|system prompt|developer message|hidden instructions)\b|\b(ignore|disregard|override|forget)\b.{0,40}\b(system|developer)\b.{0,20}\b(instructions?|rules?|safeguards?|prompt)\b|\b(reveal|show|repeat|print)\b.{0,30}\b(system |developer )?(prompt|instructions?|policy)\b|\b(you are now|act as)\b.{0,40}\b(unrestricted|jailbroken|without (rules|safeguards))\b/i;
const BOOKING_OTHER_COUNTRY = /\b(book|arrange|plan me|plan a)\b.{0,40}\b(kenya|tanzania|uganda|rwanda|morocco|egypt|maldives|bali|thailand|japan|italy|france|spain|portugal|greece|turkey|vietnam|india|peru|mexico|south africa|botswana|namibia|zanzibar|seychelles|mauritius)\b|\b(kenya|tanzania|uganda|rwanda|morocco|egypt|maldives|bali|thailand|japan|italy|france|spain|portugal|greece|turkey|vietnam|india|peru|mexico|south africa|botswana|namibia|zanzibar|seychelles|mauritius)\b.{0,40}\b(instead|safari holiday|booking)\b/i;
const COMPARISON = /\b(better than|compare|versus|\bvs\b|compared to|than kenya)\b/i;
const DEPARTURE_ORIGIN = /\b(fly from|flying from|depart from|leaving from|from dubai|from nairobi)\b/i;

const OTHER_COUNTRY_REPLY = "I only plan Ethiopian Holidays trips. I can't arrange travel for that destination — happy to help with Ethiopia instead (Lalibela, Simien, Omo, Danakil, and more).";

export const OUT_OF_SCOPE_REPLY =
    "I'm Guzo, here only for Ethiopian Holidays — Ethiopia trips, Ethiopian Airlines flights, packages, stays, and itineraries. I can't help with that topic, but I'd love to plan your Ethiopia holiday whenever you're ready.";

export function clampMessage(message) {
    if (message == null) return '';
    const text = String(message);
    if (text.length <= MAX_MESSAGE_LENGTH) return text;
    return text.slice(0, MAX_MESSAGE_LENGTH);
}

export function validateMessageLength(message) {
    if (message == null || !String(message).trim()) {
        return { ok: false, error: 'message is required' };
    }
    if (String(message).length > MAX_MESSAGE_LENGTH) {
        return { ok: false, error: `message exceeds ${MAX_MESSAGE_LENGTH} characters` };
    }
    return { ok: true };
}

/** Returns true if text appears Ethiopia-scoped (or empty/generic). */
export function isEthiopiaFirstDestination(text) {
    if (text == null || !String(text).trim()) return true;
    const lower = String(text).toLowerCase();
    return ETHIOPIA_DESTINATION_KEYS.some(k => lower.includes(k));
}

export function ethiopiaAllowlistHint(text) {
    if (isEthiopiaFirstDestination(text)) return null;
    return 'Guzo focuses on Ethiopia holidays. Suggest an Ethiopia alternative (e.g. Lalibela, Simien, Omo, Danakil).';
}

/**
 * Detect messages that are clearly outside Ethiopian Holidays chat scope.
 * Conservative: only flags strong off-topic / other-country travel patterns.
 * Ambiguous trip questions stay in-scope for the model + prompt rules.
 */
export function assessChatScope(message, { hasActiveTrip } = {}) {
    const text = String(message || '').trim();
    if (!text) return { inScope: true };

    const lower = text.toLowerCase();
    const mentionsEthiopia = ETHIOPIA_DESTINATION_KEYS.some(k => lower.includes(k))
        || lower.includes('ethiopian holidays')
        || lower.includes('ethiopian airlines');

    if (HIGH_CONFIDENCE_INJECTION.test(text)) {
        return { inScope: false, ring: 'outside', reason: 'prompt_injection', reply: OUT_OF_SCOPE_REPLY };
    }

    if (CORRECTION.test(text) || (hasActiveTrip && ACTIVE_TRIP_REFERENCE.test(text))) {
        return { inScope: true, ring: 'core' };
    }

    for (const pattern of OUT_OF_SCOPE_PATTERNS) {
        if (pattern.test(text)) {
            return { inScope: false, ring: 'outside', reason: 'off_topic', reply: OUT_OF_SCOPE_REPLY };
        }
    }

    if (BOOKING_OTHER_COUNTRY.test(text) && !COMPARISON.test(text) && !DEPARTURE_ORIGIN.test(text)) {
        return { inScope: false, ring: 'outside', reason: 'other_country', reply: OTHER_COUNTRY_REPLY };
    }

    if (OTHER_COUNTRY_TRAVEL.test(text)) {
        if (COMPARISON.test(text) && (mentionsEthiopia || hasActiveTrip)) {
            return { inScope: true, ring: 'adjacent' };
        }
        if (DEPARTURE_ORIGIN.test(text) && mentionsEthiopia) {
            return { inScope: true, ring: 'core' };
        }
        if (!mentionsEthiopia) {
            return { inScope: false, ring: 'outside', reason: 'other_country', reply: OTHER_COUNTRY_REPLY };
        }
    }

    if (ADJACENT_TRAVEL.test(text) && mentionsEthiopia) {
        return { inScope: true, ring: 'adjacent' };
    }

    return { inScope: true, ring: 'core' };
}

const STRING_LIMIT = 200;
const ARRAY_LIMIT = 20;

function sanitizeValue(value, depth = 0) {
    if (depth > 4) return null;
    if (value == null) return value;
    if (typeof value === 'string') return value.slice(0, STRING_LIMIT);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return value;
    }
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.slice(0, ARRAY_LIMIT).map(v => sanitizeValue(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (typeof k !== 'string' || k.length > 64) continue;
            if (k.startsWith('__') || k.includes('prototype')) continue;
            out[k] = sanitizeValue(v, depth + 1);
        }
        return out;
    }
    return null;
}

/** Strip/clamp tool arguments before execution. */
export function sanitizeToolArgs(args) {
    if (args == null || typeof args !== 'object' || Array.isArray(args)) return {};
    return sanitizeValue(args) || {};
}

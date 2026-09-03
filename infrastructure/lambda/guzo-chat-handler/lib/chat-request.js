import { validateMessageLength } from './guardrails.js';
import { createEmptyIntent, mergeIntent } from './intent.js';

export const KNOWN_TABS = Object.freeze([
    'packages',
    'hotels',
    'tours',
    'transfers',
    'flights',
]);

const MAX_SESSION_ID_LENGTH = 80;
const MAX_INTENT_JSON_CHARS = 8000;
const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_COUNT = 20;
const PLACE_KEYS = new Set(['name', 'code', 'id', 'type', 'catalogId']);
const DATE_KEYS = new Set(['start', 'end']);
const TRAVELER_KEYS = new Set(['adults', 'children', 'childAges', 'infants', 'rooms']);
const BUDGET_KEYS = new Set(['amount', 'currency']);
const STAY_KEYS = new Set(['destinationId', 'days']);
const STRING_KEYS = new Set([
    'pickupDate',
    'pickupTime',
    'cabin',
    'pace',
    'tier',
    'preferences',
    'packageId',
    'itineraryId',
]);
const INTENT_KEYS = new Set([
    'productTab',
    'origin',
    'destination',
    'pickup',
    'dropoff',
    'dates',
    'pickupDate',
    'pickupTime',
    'travelers',
    'cabin',
    'roundTrip',
    'interests',
    'durationDays',
    'pace',
    'tier',
    'budget',
    'preferences',
    'stayPlan',
    'packageId',
    'itineraryId',
    'selectedAddOnIds',
]);

function fail(error) {
    return { ok: false, error };
}

function clampString(value, max = MAX_STRING) {
    if (value == null) return null;
    if (typeof value !== 'string') return undefined;
    const text = value;
    if (text.length > max) return undefined;
    return text;
}

function finiteNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function pickObject(value, allowed, mapValue) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!allowed.has(key)) continue;
        const mapped = mapValue(key, raw);
        if (mapped !== undefined) out[key] = mapped;
    }
    return Object.keys(out).length ? out : null;
}

function parsePlace(value) {
    return pickObject(value, PLACE_KEYS, (_key, raw) => {
        if (raw == null) return null;
        const text = clampString(raw, 80);
        return text === undefined ? undefined : text;
    });
}

function parseDates(value) {
    return pickObject(value, DATE_KEYS, (_key, raw) => {
        if (raw == null) return null;
        const text = clampString(raw, 32);
        return text === undefined ? undefined : text;
    });
}

function parseTravelers(value) {
    return pickObject(value, TRAVELER_KEYS, (key, raw) => {
        if (raw == null) return null;
        if (key === 'childAges') {
            if (!Array.isArray(raw)) return [];
            return raw.slice(0, MAX_ARRAY)
                .map(finiteNumber)
                .filter((n) => n != null && n >= 0 && n <= 17);
        }
        const n = finiteNumber(raw);
        if (n == null || n < 0 || n > MAX_COUNT) return undefined;
        return Math.floor(n);
    });
}

function parseBudget(value) {
    return pickObject(value, BUDGET_KEYS, (key, raw) => {
        if (raw == null) return null;
        if (key === 'currency') return clampString(raw, 8);
        const n = finiteNumber(raw);
        if (n == null || n < 0 || n > 1_000_000) return undefined;
        return n;
    });
}

function parseStayPlan(value) {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    if (value.length > MAX_ARRAY) return undefined;
    const plan = [];
    for (const entry of value) {
        const row = pickObject(entry, STAY_KEYS, (key, raw) => {
            if (key === 'destinationId') return clampString(raw, 80);
            const n = finiteNumber(raw);
            if (n == null || n < 1 || n > 30) return undefined;
            return Math.floor(n);
        });
        if (row?.destinationId && row?.days) plan.push(row);
    }
    return plan.length ? plan : null;
}

function parseClientIntent(raw) {
    if (raw == null) return { ok: true, intent: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return fail('intent must be an object');
    }
    let serialized;
    try {
        serialized = JSON.stringify(raw);
    } catch {
        return fail('intent is invalid');
    }
    if (serialized.length > MAX_INTENT_JSON_CHARS) {
        return fail('intent is too large');
    }

    const intent = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!INTENT_KEYS.has(key)) continue;
        if (key === 'origin' || key === 'destination' || key === 'pickup' || key === 'dropoff') {
            const place = parsePlace(value);
            if (place === undefined) return fail('intent contains an oversized field');
            if (place) intent[key] = place;
            continue;
        }
        if (key === 'dates') {
            const dates = parseDates(value);
            if (dates === undefined) return fail('intent contains an oversized field');
            if (dates) intent[key] = dates;
            continue;
        }
        if (key === 'travelers') {
            const travelers = parseTravelers(value);
            if (travelers === undefined) return fail('intent contains an oversized field');
            if (travelers) intent[key] = travelers;
            continue;
        }
        if (key === 'budget') {
            const budget = parseBudget(value);
            if (budget === undefined) return fail('intent contains an oversized field');
            if (budget) intent[key] = budget;
            continue;
        }
        if (key === 'stayPlan') {
            const stayPlan = parseStayPlan(value);
            if (stayPlan === undefined) return fail('intent contains an oversized field');
            intent[key] = stayPlan;
            continue;
        }
        if (key === 'interests' || key === 'selectedAddOnIds') {
            if (!Array.isArray(value)) continue;
            if (value.length > MAX_ARRAY) return fail('intent contains an oversized field');
            intent[key] = value.map((item) => clampString(item, 80)).filter(Boolean);
            continue;
        }
        if (key === 'roundTrip') {
            if (typeof value === 'boolean') intent[key] = value;
            continue;
        }
        if (key === 'durationDays') {
            const n = finiteNumber(value);
            if (n != null && n >= 1 && n <= 30) intent[key] = Math.floor(n);
            continue;
        }
        if (key === 'productTab') {
            if (typeof value === 'string' && KNOWN_TABS.includes(value)) intent[key] = value;
            continue;
        }
        if (STRING_KEYS.has(key)) {
            if (typeof value !== 'string') continue;
            const text = clampString(value, key === 'preferences' ? MAX_STRING : 80);
            if (text === undefined) return fail('intent contains an oversized field');
            if (text != null) intent[key] = text;
            continue;
        }
    }
    return { ok: true, intent };
}

export function parseChatRequest(body = {}) {
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const lengthCheck = validateMessageLength(source.message);
    if (!lengthCheck.ok) return fail(lengthCheck.error);

    const tab = source.tab == null || source.tab === '' ? 'packages' : String(source.tab);
    if (!KNOWN_TABS.includes(tab)) return fail('tab is invalid');

    let sessionId = source.sessionId == null || source.sessionId === ''
        ? null
        : String(source.sessionId);
    if (sessionId) {
        if (sessionId.length > MAX_SESSION_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return fail('sessionId is invalid');
        }
    }

    const parsedIntent = parseClientIntent(source.intent);
    if (!parsedIntent.ok) return parsedIntent;

    return {
        ok: true,
        request: {
            message: String(source.message).trim(),
            tab,
            sessionId,
            clientIntent: parsedIntent.intent,
        },
    };
}

function isBlank(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.values(value).every(isBlank);
    return false;
}

function patchForBlankFields(existing, patch) {
    if (!patch || typeof patch !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
        if (isBlank(existing?.[key])) out[key] = value;
    }
    return out;
}

export function resolveSessionIntent({ sessionIntent, clientIntent, tab } = {}) {
    const parsedClientIntent = parseClientIntent(clientIntent);
    const validatedClientIntent = parsedClientIntent.ok ? parsedClientIntent.intent : null;
    const activeTab = tab || sessionIntent?.productTab || validatedClientIntent?.productTab || 'packages';
    const base = sessionIntent
        ? mergeIntent(sessionIntent, {}, activeTab)
        : createEmptyIntent(activeTab);
    if (!validatedClientIntent) return base;
    return mergeIntent(base, patchForBlankFields(base, validatedClientIntent), activeTab);
}

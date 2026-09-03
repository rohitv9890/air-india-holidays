import { normalizeDestination } from './catalog.js';
import { normalizeTravelDates, resolveTravelYear } from './dates.js';
import { mergeIntent } from './intent.js';

const CABINS = new Set(['Economy', 'Premium Economy', 'Business', 'First']);
const TIERS = new Set(['classic', 'comfort', 'signature']);
const PACES = new Set(['relaxed', 'moderate', 'active']);
const MONTHS = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
};
const OPERATION_TYPES = new Set([
    'set_duration',
    'set_dates',
    'set_travelers',
    'set_cabin',
    'set_travel_style',
    'set_pace',
    'add_stop',
    'remove_stop',
    'replace_stop',
    'set_stop_days',
    'add_preference',
    'remove_preference',
]);

function fail(error) {
    return { ok: false, changed: false, error };
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isImpossibleCalendarDate(value) {
    const raw = String(value || '').trim().toLowerCase();
    const dayFirst = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/);
    const monthFirst = raw.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
    const monthName = dayFirst?.[2] || monthFirst?.[1];
    const month = MONTHS[monthName];
    if (!month) return false;
    const day = Number(dayFirst?.[1] || monthFirst?.[2]);
    const explicitYear = dayFirst?.[3] || monthFirst?.[3];
    const year = explicitYear ? Number(explicitYear) : resolveTravelYear(month, day);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day < 1 || day > daysInMonth;
}

function normalizeDatesOrThrow(dates) {
    for (const value of [dates.start, dates.end]) {
        if (
            (/^\d{4}-\d{2}-\d{2}$/.test(value || '') && !isValidDate(value))
            || isImpossibleCalendarDate(value)
        ) {
            throw new Error('set_dates requires valid travel dates');
        }
    }
    const normalized = {
        start: dates.start == null
            ? null
            : normalizeTravelDates({ start: dates.start }).start,
        end: dates.end == null
            ? null
            : normalizeTravelDates({ end: dates.end }).end,
    };
    if (
        (dates.start != null && !isValidDate(normalized?.start))
        || (dates.end != null && !isValidDate(normalized?.end))
    ) {
        throw new Error('set_dates requires valid travel dates');
    }
    if (normalized.start && normalized.end && normalized.end < normalized.start) {
        throw new Error('set_dates requires end to be on or after start');
    }
    return normalized;
}

function stayPlanFrom(intent, itinerary) {
    if (Array.isArray(intent?.stayPlan) && intent.stayPlan.length) {
        return intent.stayPlan.map((stop) => ({
            destinationId: stop.destinationId,
            days: Number(stop.days),
        }));
    }
    const counts = new Map();
    const order = [];
    for (const day of itinerary?.days || []) {
        const id = day?.destinationId;
        if (!id) continue;
        if (!counts.has(id)) {
            counts.set(id, 0);
            order.push(id);
        }
        counts.set(id, counts.get(id) + 1);
    }
    return order.map((id) => ({ destinationId: id, days: counts.get(id) }));
}

function canonicalIntent(intent) {
    return JSON.stringify({
        origin: intent?.origin || null,
        destination: intent?.destination || null,
        dates: intent?.dates || null,
        travelers: intent?.travelers || null,
        cabin: intent?.cabin || null,
        durationDays: intent?.durationDays ?? null,
        pace: intent?.pace || null,
        tier: intent?.tier || null,
        preferences: intent?.preferences || null,
        stayPlan: intent?.stayPlan || null,
        interests: intent?.interests || [],
        packageId: intent?.packageId || null,
    });
}

function requireDestination(value, label) {
    const destinationId = normalizeDestination(value);
    if (!destinationId) {
        throw new Error(`Unknown destination for ${label}`);
    }
    return destinationId;
}

function validateOperation(operation) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw new Error('Each operation must be an object');
    }
    const type = operation.type;
    if (!OPERATION_TYPES.has(type)) {
        throw new Error(`Unsupported operation: ${type || 'unknown'}`);
    }
    if (type === 'set_duration') {
        const days = Number(operation.durationDays);
        if (!Number.isInteger(days) || days < 1) throw new Error('set_duration requires durationDays');
        return { type, durationDays: days };
    }
    if (type === 'set_dates') {
        if (!operation.start && !operation.end) throw new Error('set_dates requires start or end');
        return { type, start: operation.start || null, end: operation.end || null };
    }
    if (type === 'set_travelers') {
        if (operation.adults == null && operation.children == null) {
            throw new Error('set_travelers requires adults or children');
        }
        return {
            type,
            adults: operation.adults == null ? undefined : Number(operation.adults),
            children: operation.children == null ? undefined : Number(operation.children),
        };
    }
    if (type === 'set_cabin') {
        const cabin = String(operation.cabin || '').replace(/\b\w/g, (c) => c.toUpperCase());
        if (!CABINS.has(cabin)) throw new Error('set_cabin requires a valid cabin');
        return { type, cabin };
    }
    if (type === 'set_travel_style') {
        const tier = String(operation.tier || '').toLowerCase() === 'luxury'
            ? 'signature'
            : String(operation.tier || '').toLowerCase();
        if (!TIERS.has(tier)) throw new Error('set_travel_style requires a valid tier');
        return { type, tier };
    }
    if (type === 'set_pace') {
        const pace = String(operation.pace || '').toLowerCase();
        if (!PACES.has(pace)) throw new Error('set_pace requires a valid pace');
        return { type, pace };
    }
    if (type === 'add_stop') {
        const days = Number(operation.days);
        if (!Number.isInteger(days) || days < 1) throw new Error('add_stop requires days');
        return { type, destinationId: requireDestination(operation.destinationId, 'add_stop'), days };
    }
    if (type === 'remove_stop') {
        return { type, destinationId: requireDestination(operation.destinationId, 'remove_stop') };
    }
    if (type === 'replace_stop') {
        return {
            type,
            from: requireDestination(operation.from, 'replace_stop.from'),
            to: requireDestination(operation.to, 'replace_stop.to'),
        };
    }
    if (type === 'set_stop_days') {
        const days = Number(operation.days);
        if (!Number.isInteger(days) || days < 1) throw new Error('set_stop_days requires days');
        return {
            type,
            destinationId: requireDestination(operation.destinationId, 'set_stop_days'),
            days,
        };
    }
    if (type === 'add_preference' || type === 'remove_preference') {
        const note = String(operation.note || '').trim();
        if (!note) throw new Error(`${type} requires a note`);
        return { type, note: note.slice(0, 240) };
    }
    throw new Error(`Unsupported operation: ${type}`);
}

function applyOne(intent, operation) {
    if (operation.type === 'set_duration') {
        intent.durationDays = operation.durationDays;
        if (intent.dates?.start) {
            const end = addDays(intent.dates.start, operation.durationDays - 1);
            if (!end) throw new Error('Cannot update duration with an invalid start date');
            intent.dates = {
                start: intent.dates.start,
                end,
            };
        }
        return;
    }
    if (operation.type === 'set_dates') {
        intent.dates = normalizeDatesOrThrow({
            start: operation.start || intent.dates?.start || null,
            end: operation.end || intent.dates?.end || null,
        });
        return;
    }
    if (operation.type === 'set_travelers') {
        intent.travelers = { ...(intent.travelers || {}) };
        if (operation.adults !== undefined) intent.travelers.adults = operation.adults;
        if (operation.children !== undefined) intent.travelers.children = operation.children;
        return;
    }
    if (operation.type === 'set_cabin') {
        intent.cabin = operation.cabin;
        intent.cabinSource = 'user';
        return;
    }
    if (operation.type === 'set_travel_style') {
        intent.tier = operation.tier;
        return;
    }
    if (operation.type === 'set_pace') {
        intent.pace = operation.pace;
        return;
    }
    if (operation.type === 'add_preference') {
        intent.preferences = intent.preferences
            ? `${intent.preferences}; ${operation.note}`
            : operation.note;
        return;
    }
    if (operation.type === 'remove_preference') {
        const parts = intent.preferences?.split(/\s*;\s*/) || [];
        const remaining = parts.filter(
            (part) => part.toLowerCase() !== operation.note.toLowerCase(),
        );
        if (remaining.length === parts.length) {
            throw new Error(`Preference not found: ${operation.note}`);
        }
        intent.preferences = remaining.join('; ') || null;
        return;
    }

    const stays = [...(intent.stayPlan || [])];
    if (operation.type === 'add_stop') {
        const existing = stays.find((stop) => stop.destinationId === operation.destinationId);
        if (existing) existing.days += operation.days;
        else stays.push({ destinationId: operation.destinationId, days: operation.days });
    } else if (operation.type === 'remove_stop') {
        const index = stays.findIndex((stop) => stop.destinationId === operation.destinationId);
        if (index < 0) throw new Error(`Stop not on the plan: ${operation.destinationId}`);
        if (stays.length === 1) throw new Error('Cannot remove the final stop from the itinerary');
        stays.splice(index, 1);
    } else if (operation.type === 'replace_stop') {
        const existing = stays.find((stop) => stop.destinationId === operation.from);
        if (!existing) throw new Error(`Stop not on the plan: ${operation.from}`);
        if (
            operation.to !== operation.from
            && stays.some((stop) => stop.destinationId === operation.to)
        ) {
            throw new Error(`Stop already on the plan: ${operation.to}`);
        }
        existing.destinationId = operation.to;
    } else if (operation.type === 'set_stop_days') {
        const existing = stays.find((stop) => stop.destinationId === operation.destinationId);
        if (!existing) throw new Error(`Stop not on the plan: ${operation.destinationId}`);
        existing.days = operation.days;
    }
    intent.stayPlan = stays.filter((stop) => stop.days > 0);
    const total = intent.stayPlan.reduce((sum, stop) => sum + stop.days, 0);
    if (total > 0) {
        intent.durationDays = total;
        if (intent.dates?.start) {
            const end = addDays(intent.dates.start, total - 1);
            if (!end) throw new Error('Cannot update stay plan with an invalid start date');
            intent.dates = {
                start: intent.dates.start,
                end,
            };
        }
    }
}

export function applyItineraryChanges(intent, itinerary, operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
        return fail('operations must be a non-empty array');
    }

    let validated;
    try {
        validated = operations.map(validateOperation);
    } catch (err) {
        return fail(err.message);
    }

    const next = mergeIntent(intent, {}, intent?.productTab || 'packages');
    next.stayPlan = stayPlanFrom(next, itinerary);
    const before = canonicalIntent(next);

    try {
        for (const operation of validated) {
            applyOne(next, operation);
        }
    } catch (err) {
        return fail(err.message);
    }

    const after = canonicalIntent(next);
    const changed = before !== after;
    return {
        ok: true,
        changed,
        intent: changed ? next : intent,
        appliedOperations: changed ? validated : [],
    };
}

export function composeArgsFromIntent(intent, itinerary, bespoke) {
    return {
        packageId: intent.packageId || itinerary?.packageId || itinerary?.sourcePackageId || undefined,
        destination: intent.destination,
        durationDays: intent.durationDays,
        startDate: intent.dates?.start,
        endDate: intent.dates?.end,
        originIata: intent.origin?.code,
        adults: intent.travelers?.adults,
        children: intent.travelers?.children,
        childAges: intent.travelers?.childAges,
        cabin: intent.cabin,
        tier: intent.tier,
        preferences: intent.preferences,
        stayPlan: intent.stayPlan,
        interests: intent.interests,
        bespoke,
    };
}

export async function applyChangesThenCompose({
    intent,
    itinerary,
    operations,
    executeTool,
    tab = 'packages',
}) {
    const applied = applyItineraryChanges(intent, itinerary, operations);
    if (!applied.ok) {
        return {
            ...applied,
            intent,
            reply: 'I could not apply that change, so your existing itinerary has not been changed. Please try again.',
        };
    }
    if (!applied.changed) {
        return {
            ok: true,
            changed: false,
            intent,
            reply: 'That change was already reflected in your itinerary, so nothing was updated.',
        };
    }

    const { getMissingFieldsForAction } = await import('./intent.js');
    const missing = getMissingFieldsForAction(applied.intent, { tab, action: 'compose' });
    if (missing.length) {
        return {
            ok: true,
            changed: true,
            intent: applied.intent,
            missing,
            reply: 'I have noted that change, but I still need the missing trip details before I can update the itinerary.',
        };
    }

    const composeResult = await executeTool(
        'compose_itinerary',
        composeArgsFromIntent(applied.intent, itinerary, true),
    );
    if (!composeResult?.ok) {
        return {
            ok: false,
            changed: false,
            intent,
            reply: 'I could not apply that change, so your existing itinerary has not been changed. Please try again.',
        };
    }

    return {
        ok: true,
        changed: true,
        intent: applied.intent,
        itinerary: composeResult.itinerary,
        appliedOperations: applied.appliedOperations,
        warnings: composeResult.warnings || [],
        reply: `Your updated itinerary is ready — ${composeResult.itinerary.title}. Open it to review the changes.`,
    };
}

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDestination } from './catalog.js';

const PREFERENCE_STAY_PATTERN = /(\d+)\s*days?\s+in\s+([A-Za-z][A-Za-z\s'-]+)/gi;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PLANNER_FILE = join(__dirname, 'route-planner.js');

let planRoute = null;
try {
    if (existsSync(ROUTE_PLANNER_FILE)) {
        const mod = await import('./route-planner.js');
        planRoute = typeof mod.planRoute === 'function'
            ? mod.planRoute
            : typeof mod.orderDestinations === 'function'
                ? mod.orderDestinations
                : null;
    }
} catch {
    planRoute = null;
}

function orderUnorderedDestinations(ids, intent = {}) {
    if (!planRoute || !ids || ids.length <= 1) return ids;
    try {
        const result = planRoute({
            destinations: ids,
            gateway: 'addis-ababa',
            originIata: intent.originIata || intent.origin || null,
            explicitOrder: false,
        });
        if (!result || typeof result.then === 'function') return ids;
        const ordered = result.ordered || result.destinations || result.route || result;
        if (!Array.isArray(ordered)) return ids;
        const orderedIds = ordered
            .map((item) => (typeof item === 'string' ? item : item?.destinationId))
            .filter(Boolean);
        if (!orderedIds.length) return ids;
        const wanted = new Set(ids);
        const next = [];
        const seen = new Set();
        for (const id of orderedIds) {
            if (!wanted.has(id) || seen.has(id)) continue;
            next.push(id);
            seen.add(id);
        }
        for (const id of ids) {
            if (!seen.has(id)) next.push(id);
        }
        return next;
    } catch {
        return ids;
    }
}

export function normalizeStayPlanEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) return [];
    return entries
        .map((s) => ({
            destinationId: normalizeDestination(s?.destinationId),
            days: Number(s?.days),
        }))
        .filter((s) => s.destinationId && Number.isFinite(s.days) && s.days > 0)
        .map((s) => ({ destinationId: s.destinationId, days: Math.floor(s.days) }));
}

/** Scale an ordered stay split so day totals match the requested trip length. */
export function scaleStayPlan(chunks, daysTarget) {
    const sum = chunks.reduce((n, s) => n + s.days, 0);
    if (sum === daysTarget) return chunks.map((s) => ({ ...s }));
    let allocated = 0;
    return chunks.map((s, i) => {
        if (i === chunks.length - 1) {
            return { destinationId: s.destinationId, days: Math.max(daysTarget - allocated, 1) };
        }
        const days = Math.max(Math.round((s.days / sum) * daysTarget), 1);
        allocated += days;
        return { destinationId: s.destinationId, days };
    });
}

export function parseStayPlanFromPreferences(preferences) {
    const pref = String(preferences || '');
    if (!pref.trim()) return [];
    return [...pref.matchAll(PREFERENCE_STAY_PATTERN)]
        .map((m) => ({
            destinationId: normalizeDestination(m[2].trim()),
            days: Number(m[1]),
        }))
        .filter((s) => s.destinationId && s.days > 0);
}

export function hasExplicitStaySplit(intent = {}) {
    if (normalizeStayPlanEntries(intent.stayPlan).length) return true;
    return parseStayPlanFromPreferences(intent.preferences).length > 0;
}

export function stayPlansEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((stop, i) => (
        stop.destinationId === b[i].destinationId
        && Number(stop.days) === Number(b[i].days)
    ));
}

export function stayPlanDays(plan) {
    return (Array.isArray(plan) ? plan : []).reduce((sum, stop) => sum + Number(stop.days || 0), 0);
}

/**
 * Catalog package route as a stay plan. Route nights become days; leftover
 * trip days are added to the last stop, matching expandRouteDays padding.
 */
export function stayPlanFromPackage(pkg, totalDays) {
    const daysTarget = Math.max(Number(totalDays) || pkg?.duration?.days || 0, 1);
    const route = Array.isArray(pkg?.route) ? pkg.route : [];
    let chunks = route
        .map((stop) => ({
            destinationId: normalizeDestination(stop?.destinationId),
            days: Number(stop?.nights ?? stop?.days),
        }))
        .filter((s) => s.destinationId && Number.isFinite(s.days) && s.days > 0)
        .map((s) => ({ destinationId: s.destinationId, days: Math.floor(s.days) }));

    if (!chunks.length) {
        const destIds = [...new Set((pkg?.destinations || [])
            .map((id) => normalizeDestination(id))
            .filter(Boolean))];
        if (!destIds.length) return null;
        const base = Math.floor(daysTarget / destIds.length);
        let rem = daysTarget % destIds.length;
        chunks = destIds.map((id) => {
            const days = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem -= 1;
            return { destinationId: id, days: Math.max(days, 1) };
        });
        return chunks;
    }

    const sum = stayPlanDays(chunks);
    if (sum === daysTarget) return chunks;
    if (sum < daysTarget) {
        const padded = chunks.map((s) => ({ ...s }));
        padded[padded.length - 1].days += daysTarget - sum;
        return padded;
    }
    return scaleStayPlan(chunks, daysTarget);
}

export function stayPlanFromItinerary(itinerary) {
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

/**
 * Resolve an ordered stay plan from structured stayPlan, preferences regex,
 * or an even split across interests + destination.
 */
export function buildStayPlan(intent = {}, totalDays) {
    const daysTarget = Math.max(Number(totalDays) || 0, 1);

    const structured = normalizeStayPlanEntries(intent.stayPlan);
    if (structured.length) {
        return scaleStayPlan(structured, daysTarget);
    }

    const chunks = parseStayPlanFromPreferences(intent.preferences);
    if (chunks.length) {
        return scaleStayPlan(chunks, daysTarget);
    }

    const stops = [];
    for (const interest of intent.interests || []) {
        const id = normalizeDestination(interest);
        if (id && !stops.includes(id)) stops.push(id);
    }
    const dest = normalizeDestination(intent.destination);
    if (dest && !stops.includes(dest)) stops.push(dest);
    if (!stops.length) return null;

    // Long Omo stays: open via Arba Minch lakes before the Lower Omo circuit.
    if (
        stops.length === 1
        && stops[0] === 'omo-valley'
        && daysTarget >= 6
    ) {
        const gateway = Math.min(2, Math.max(1, Math.floor(daysTarget / 5)));
        return [
            { destinationId: 'arba-minch', days: gateway },
            { destinationId: 'omo-valley', days: daysTarget - gateway },
        ];
    }

    const ordered = orderUnorderedDestinations(stops, intent);
    const base = Math.floor(daysTarget / ordered.length);
    let rem = daysTarget % ordered.length;
    return ordered.map((id) => {
        const days = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
        return { destinationId: id, days: Math.max(days, 1) };
    });
}

/**
 * Pick the stay plan used to compose, without turning a catalog package into
 * a custom trip just because intent now always holds a plan.
 */
export function resolveItineraryStayPlan({
    stayPlan,
    preferences,
    interests,
    destination,
    originIata = null,
    pkg = null,
    requestedDays = null,
    bespoke = false,
} = {}) {
    const pkgDays = pkg?.duration?.days || 7;
    const daysTarget = Math.max(Number(requestedDays) || pkgDays, 1);
    const intent = { stayPlan, preferences, interests, destination, originIata };
    const packagePlan = pkg ? stayPlanFromPackage(pkg, daysTarget) : null;
    const derived = buildStayPlan(intent, daysTarget);
    const explicit = hasExplicitStaySplit(intent);
    const customLength = Number(requestedDays) > 0 && Number(requestedDays) !== pkgDays;
    const explicitOverride = Boolean(
        explicit
        && derived?.length
        && !(packagePlan && stayPlansEqual(derived, packagePlan)),
    );
    const wantsBespoke = Boolean(bespoke || customLength || explicitOverride);
    const resolved = wantsBespoke
        ? (derived || packagePlan)
        : (packagePlan || derived);

    return {
        stayPlan: resolved || null,
        wantsBespoke,
        source: wantsBespoke ? 'traveller' : 'package',
        packagePlan,
    };
}

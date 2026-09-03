import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDestinations } from './catalog.js';
import { DEFAULT_GATEWAY_ID, resolveJourney } from './route-planner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveFlightsPath() {
    if (process.env.FLIGHTS_PATH) return resolve(process.env.FLIGHTS_PATH);
    const candidates = [
        process.env.CATALOG_DIR ? join(resolve(process.env.CATALOG_DIR), 'flights.json') : null,
        join(__dirname, '../data/catalog/v1/flights.json'),
        join(__dirname, '../../../../data/catalog/v1/flights.json'),
    ].filter(Boolean);
    const hit = candidates.find((p) => existsSync(p));
    if (!hit) throw new Error(`flights.json not found (tried ${candidates.join(', ')})`);
    return hit;
}

let cached = null;

export function loadFlights({ force = false } = {}) {
    if (cached && !force) return cached;
    cached = JSON.parse(readFileSync(resolveFlightsPath(), 'utf8'));
    return cached;
}

export function destinationIata(destinationId) {
    const destinations = loadDestinations().destinations || [];
    const dest = destinations.find((destination) => destination.id === destinationId);
    const code = dest?.iata;
    return code ? String(code).toUpperCase() : null;
}

export function findRoute(origin, destination) {
    const from = String(origin || '').toUpperCase();
    const to = String(destination || '').toUpperCase();
    return loadFlights().routes.find((r) => r.origin === from && r.destination === to) || null;
}

export function findRouteById(routeId) {
    if (!routeId) return null;
    return loadFlights().routes.find((r) => r.id === routeId) || null;
}

export function cabinMultiplier(route, cabin = 'Economy') {
    const defaults = loadFlights().defaultCabinMultipliers || {};
    const map = route?.cabinMultipliers || defaults;
    return map[cabin] ?? defaults[cabin] ?? 1;
}

function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function segment(route, { date, cabin, direction, suffix }) {
    const data = loadFlights();
    const mul = cabinMultiplier(route, cabin);
    return {
        id: `${route.id}-${suffix}`,
        routeId: route.id,
        origin: route.origin,
        destination: route.destination,
        date,
        carrier: data.carrier,
        cabin,
        direction,
        durationHours: route.durationHours,
        baseFareGbp: Math.round(route.baseFareGbp * mul * 100) / 100,
    };
}

function stayStops(opts) {
    if (Array.isArray(opts.stayPlan) && opts.stayPlan.length) {
        return opts.stayPlan
            .map((stop) => ({
                id: stop.destinationId || stop.id || stop,
                days: Math.max(Number(stop.days) || 1, 1),
            }))
            .filter((stop) => stop.id);
    }
    const ids = opts.routeStops || [];
    const n = ids.length;
    if (!n) return [];
    const total = Math.max(Number(opts.durationDays) || n, n);
    const base = Math.floor(total / n);
    let rem = total % n;
    return ids.map((id) => {
        const days = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
        return { id, days: Math.max(days, 1) };
    });
}

function routeForLeg(leg) {
    if (leg.flightRouteId) {
        const byId = findRouteById(leg.flightRouteId);
        if (byId) return byId;
    }
    const from = destinationIata(leg.from);
    const to = destinationIata(leg.to);
    if (!from || !to || from === to) return null;
    return findRoute(from, to);
}

function isFlightLeg(leg) {
    return Boolean(leg && (leg.mode === 'flight' || leg.flightRouteId));
}

function pushUnique(segments, next) {
    if (!next) return;
    if (segments.some((seg) =>
        seg.routeId === next.routeId
        && seg.origin === next.origin
        && seg.destination === next.destination
        && seg.date === next.date
        && seg.direction === next.direction
    )) return;
    segments.push(next);
}

function addJourneyFlights(segments, journey, { date, cabin, suffix }) {
    for (const [index, leg] of (journey?.path || []).entries()) {
        if (!isFlightLeg(leg)) continue;
        const route = routeForLeg(leg);
        if (!route) continue;
        pushUnique(segments, segment(route, {
            date,
            cabin,
            direction: 'domestic',
            suffix: `${suffix}${index}`,
        }));
    }
}

/**
 * Select ET international + domestic segments for an itinerary.
 * Domestic legs follow the resolved connection path on stay boundaries.
 */
export function selectFlights(opts) {
    const {
        originIata,
        startDate,
        durationDays,
        cabin = 'Economy',
        openJaw = false,
        gatewayId = DEFAULT_GATEWAY_ID,
        connections,
        destinationRecords,
    } = opts;

    const hub = 'ADD';
    const segments = [];
    const endDate = addDays(startDate, Math.max((durationDays || 1) - 1, 0));
    const journeyOpts = { connections, destinationRecords, gatewayId, openJaw };
    const stops = stayStops(opts);

    const outbound = findRoute(originIata, hub);
    if (outbound) {
        segments.push(segment(outbound, { date: startDate, cabin, direction: 'outbound', suffix: 'out' }));
    }

    if (stops.length) {
        let dayOffset = 0;
        const first = stops[0];
        if (first.id !== gatewayId) {
            addJourneyFlights(
                segments,
                resolveJourney(gatewayId, first.id, journeyOpts),
                { date: startDate, cabin, suffix: 'in' },
            );
        }
        dayOffset += first.days;

        for (let i = 0; i < stops.length - 1; i += 1) {
            const from = stops[i];
            const to = stops[i + 1];
            addJourneyFlights(
                segments,
                resolveJourney(from.id, to.id, journeyOpts),
                { date: addDays(startDate, Math.min(dayOffset, Math.max((durationDays || 1) - 1, 0))), cabin, suffix: `d${i}` },
            );
            dayOffset += to.days;
        }

        const last = stops[stops.length - 1];
        if (!openJaw && last.id !== gatewayId) {
            addJourneyFlights(
                segments,
                resolveJourney(last.id, gatewayId, journeyOpts),
                { date: endDate, cabin, suffix: 'home' },
            );
        }
    }

    if (!openJaw) {
        const retOrigin = outbound?.origin || originIata;
        const inbound = findRoute(hub, retOrigin);
        if (inbound) {
            segments.push(segment(inbound, { date: endDate, cabin, direction: 'return', suffix: 'ret' }));
        }
    }

    return segments;
}

export function totalFlightGbp(segments) {
    return Math.round(segments.reduce((sum, s) => sum + (s.baseFareGbp || 0), 0) * 100) / 100;
}

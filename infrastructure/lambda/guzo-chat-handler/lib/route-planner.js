import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDestinations } from './catalog.js';
import { findRoute } from './flights.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_GATEWAY_ID = 'addis-ababa';
export const DEFAULT_GATEWAY_IATA = 'ADD';
export const EXACT_SEARCH_LIMIT = 8;

const SHORT_HOURS = 3;
const HALF_DAY_HOURS = 6;
const AIRPORT_OVERHEAD_HOURS = 3;
const ROAD_KMH = 45;

const WEIGHT = {
    hours: 1,
    backtrack: 2.5,
    modeChange: 0.6,
    extraHub: 1.25,
    gatewayMiddle: 14,
};

/** Fallback coords used only as a sanity check when catalog records omit lat/lng. */
const DEFAULT_COORDS = {
    'addis-ababa': { lat: 9.03, lng: 38.74 },
    lalibela: { lat: 12.03, lng: 39.04 },
    'bahir-dar': { lat: 11.6, lng: 37.38 },
    gondar: { lat: 12.61, lng: 37.47 },
    simien: { lat: 13.18, lng: 38.04 },
    axum: { lat: 14.13, lng: 38.72 },
    'arba-minch': { lat: 6.03, lng: 37.55 },
    'omo-valley': { lat: 5.25, lng: 36.2 },
    bale: { lat: 6.88, lng: 39.87 },
    danakil: { lat: 14.24, lng: 40.3 },
    harar: { lat: 9.31, lng: 42.12 },
    adama: { lat: 8.54, lng: 39.27 },
    bishoftu: { lat: 8.75, lng: 38.98 },
    'dire-dawa': { lat: 9.59, lng: 41.87 },
    hawassa: { lat: 7.05, lng: 38.48 },
    jimma: { lat: 7.67, lng: 36.83 },
    mekelle: { lat: 13.5, lng: 39.47 },
    'rift-valley-lakes': { lat: 7.6, lng: 38.7 },
    'tigray-heritage': { lat: 13.8, lng: 39.6 },
    ziway: { lat: 7.93, lng: 38.72 },
    'abijatta-shalla': { lat: 7.5, lng: 38.63 },
    yirgacheffe: { lat: 6.16, lng: 38.2 },
};

const FALLBACK_ROAD_LINKS = [
    ['addis-ababa', 'bishoftu', 1.5],
    ['addis-ababa', 'adama', 2],
    ['addis-ababa', 'ziway', 2.5],
    ['addis-ababa', 'rift-valley-lakes', 3],
    ['bishoftu', 'adama', 1],
    ['ziway', 'abijatta-shalla', 1],
    ['abijatta-shalla', 'hawassa', 2],
    ['hawassa', 'yirgacheffe', 2.5],
    ['dire-dawa', 'harar', 1.5],
    ['mekelle', 'axum', 4],
    ['bahir-dar', 'gondar', 4],
];

let cachedConnections = null;

function resolveDataFile(name) {
    const candidates = [
        process.env.CATALOG_DIR ? join(resolve(process.env.CATALOG_DIR), name) : null,
        join(__dirname, '../data/catalog/v1', name),
        join(__dirname, '../../../../data/catalog/v1', name),
    ].filter(Boolean);
    return candidates.find((p) => existsSync(p)) || null;
}

export function journeyLoadFromHours(hours, explicitLoad) {
    if (explicitLoad === 'short' || explicitLoad === 'half-day' || explicitLoad === 'full-day') {
        return explicitLoad;
    }
    const value = Number(hours);
    if (!Number.isFinite(value) || value <= SHORT_HOURS) return 'short';
    if (value <= HALF_DAY_HOURS) return 'half-day';
    return 'full-day';
}

function normalizeConnection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const from = String(raw.from || '').trim();
    const to = String(raw.to || '').trim();
    const hours = Number(raw.hours);
    if (!from || !to || from === to || !Number.isFinite(hours) || hours < 0) return null;
    return {
        from,
        to,
        mode: String(raw.mode || 'road'),
        hours,
        load: journeyLoadFromHours(hours, raw.load),
        flightRouteId: raw.flightRouteId || null,
        transferId: raw.transferId || null,
        via: Array.isArray(raw.via) ? raw.via.map(String).filter(Boolean) : [],
    };
}

function withReciprocals(list) {
    const seen = new Set(list.map((c) => `${c.from}>${c.to}`));
    const out = [...list];
    for (const connection of list) {
        const key = `${connection.to}>${connection.from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            ...connection,
            from: connection.to,
            to: connection.from,
        });
    }
    return out;
}

function destIata(destination) {
    const code = destination?.iata;
    return code ? String(code).toUpperCase() : null;
}

function primaryIataOwners(destinations) {
    const map = new Map();
    for (const destination of destinations) {
        const code = destIata(destination);
        if (code && !map.has(code)) map.set(code, destination.id);
    }
    return map;
}

function haversineKm(a, b) {
    if (!a || !b) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordsOf(id, destById) {
    const dest = destById.get(id);
    if (dest) {
        const lat = Number(dest.lat ?? dest.latitude ?? dest.coordinates?.lat);
        const lng = Number(dest.lng ?? dest.longitude ?? dest.coordinates?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return DEFAULT_COORDS[id] || null;
}

function roadHoursBetween(fromId, toId, destById, fallbackHours) {
    if (Number.isFinite(fallbackHours)) return fallbackHours;
    const km = haversineKm(coordsOf(fromId, destById), coordsOf(toId, destById));
    if (km == null) return 4;
    return Math.max(1.5, Math.round((km / ROAD_KMH) * 2) / 2);
}

function synthesizeFallbackConnections(destinations) {
    const destById = new Map(destinations.map((d) => [d.id, d]));
    const owners = primaryIataOwners(destinations);
    const list = [];
    const seen = new Set();

    const add = (from, to, mode, hours, extra = {}) => {
        if (!from || !to || from === to || !destById.has(from) || !destById.has(to)) return;
        const key = `${from}>${to}`;
        if (seen.has(key)) return;
        seen.add(key);
        const connection = normalizeConnection({ from, to, mode, hours, ...extra });
        if (connection) list.push(connection);
    };

    const iataIds = [...owners.entries()];
    for (let i = 0; i < iataIds.length; i += 1) {
        for (let j = 0; j < iataIds.length; j += 1) {
            if (i === j) continue;
            const [fromIata, fromId] = iataIds[i];
            const [toIata, toId] = iataIds[j];
            const route = findRoute(fromIata, toIata);
            if (!route) continue;
            const hours = (Number(route.durationHours) || 1) + AIRPORT_OVERHEAD_HOURS;
            add(fromId, toId, 'flight', hours, {
                flightRouteId: route.id,
                load: journeyLoadFromHours(hours),
            });
        }
    }

    for (const destination of destinations) {
        const code = destIata(destination);
        const ownerId = code ? owners.get(code) : null;
        if (ownerId && ownerId !== destination.id) {
            const hours = roadHoursBetween(ownerId, destination.id, destById);
            add(ownerId, destination.id, 'road', hours);
            add(destination.id, ownerId, 'road', hours);
        }
    }

    for (const [from, to, hours] of FALLBACK_ROAD_LINKS) {
        add(from, to, 'road', hours);
        add(to, from, 'road', hours);
    }

    return list;
}

function resolveConnectionsPath() {
    if (process.env.CONNECTIONS_PATH) {
        const path = resolve(process.env.CONNECTIONS_PATH);
        return existsSync(path) ? path : null;
    }
    return resolveDataFile('connections.json');
}

export function loadConnections({ force = false, connections } = {}) {
    if (Array.isArray(connections)) {
        return {
            connections: withReciprocals(connections.map(normalizeConnection).filter(Boolean)),
            source: 'injected',
        };
    }
    if (cachedConnections && !force) return cachedConnections;

    const path = resolveConnectionsPath();
    if (path) {
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            const raw = Array.isArray(parsed) ? parsed : (parsed.connections || []);
            cachedConnections = {
                connections: withReciprocals(raw.map(normalizeConnection).filter(Boolean)),
                source: path,
            };
            return cachedConnections;
        } catch {
            // Fall through to the synthesized graph when the catalog file cannot be read or parsed.
        }
    }

    const destinations = loadDestinations().destinations || [];
    const fallbackConnections = {
        connections: withReciprocals(synthesizeFallbackConnections(destinations)),
        source: 'fallback',
    };
    if (!path) cachedConnections = fallbackConnections;
    return fallbackConnections;
}

export function resetRoutePlannerCache() {
    cachedConnections = null;
}

function buildGraph(connectionList) {
    const graph = new Map();
    for (const connection of connectionList) {
        if (!graph.has(connection.from)) graph.set(connection.from, []);
        graph.get(connection.from).push(connection);
    }
    return graph;
}

function unreachable(fromId, toId) {
    return {
        from: fromId,
        to: toId,
        path: null,
        hours: Infinity,
        mode: null,
        load: null,
        flightRouteId: null,
        transferId: null,
        viaHub: false,
        hubIds: [],
    };
}

function shortestPath(graph, fromId, toId) {
    if (!fromId || !toId) return unreachable(fromId, toId);
    if (fromId === toId) {
        return {
            from: fromId,
            to: toId,
            path: [],
            hours: 0,
            mode: null,
            load: 'short',
            flightRouteId: null,
            transferId: null,
            viaHub: false,
            hubIds: [],
        };
    }

    const dist = new Map([[fromId, 0]]);
    const hops = new Map([[fromId, 0]]);
    const prevEdge = new Map();
    const settled = new Set();

    while (true) {
        let current = null;
        let bestHours = Infinity;
        let bestHops = Infinity;
        for (const [node, hours] of dist) {
            if (settled.has(node)) continue;
            const nodeHops = hops.get(node) ?? 0;
            if (hours < bestHours || (hours === bestHours && nodeHops < bestHops)) {
                bestHours = hours;
                bestHops = nodeHops;
                current = node;
            }
        }
        if (current == null) break;
        if (current === toId) break;
        settled.add(current);
        for (const edge of graph.get(current) || []) {
            const nextHours = bestHours + edge.hours;
            const nextHops = bestHops + 1;
            const prevHours = dist.get(edge.to);
            const prevHops = hops.get(edge.to) ?? Infinity;
            if (
                prevHours == null
                || nextHours < prevHours
                || (nextHours === prevHours && nextHops < prevHops)
            ) {
                dist.set(edge.to, nextHours);
                hops.set(edge.to, nextHops);
                prevEdge.set(edge.to, edge);
            }
        }
    }

    if (!dist.has(toId)) return unreachable(fromId, toId);

    const path = [];
    let node = toId;
    while (node !== fromId) {
        const edge = prevEdge.get(node);
        if (!edge) return unreachable(fromId, toId);
        path.push(edge);
        node = edge.from;
    }
    path.reverse();

    const hours = dist.get(toId);
    const modes = path.map((leg) => leg.mode);
    const mode = path.length === 0
        ? null
        : modes.every((m) => m === modes[0]) ? modes[0] : 'mixed';
    const hubIds = path.length === 1
        ? [...(path[0].via || [])]
        : path.slice(0, -1).map((leg) => leg.to);
    return {
        from: fromId,
        to: toId,
        path,
        hours,
        mode,
        load: journeyLoadFromHours(hours, path.length === 1 ? path[0].load : null),
        flightRouteId: path.length === 1 ? path[0].flightRouteId : null,
        transferId: path.length === 1 ? path[0].transferId : null,
        viaHub: hubIds.length > 0,
        hubIds,
    };
}

function plannerContext(opts = {}) {
    const destinationRecords = opts.destinationRecords
        || loadDestinations().destinations
        || [];
    const destById = new Map(destinationRecords.map((d) => [d.id, d]));
    const loaded = loadConnections(opts);
    return {
        destById,
        graph: buildGraph(loaded.connections),
        journeyCache: new Map(),
        connections: loaded.connections,
        source: loaded.source,
        gatewayId: opts.gatewayId || opts.gateway || DEFAULT_GATEWAY_ID,
        openJaw: Boolean(opts.openJaw),
        originIata: opts.originIata || null,
        departureIata: opts.departureIata || null,
    };
}

function memoizedShortestPath(ctx, fromId, toId) {
    const key = `${fromId || ''}>${toId || ''}`;
    if (!ctx.journeyCache.has(key)) {
        ctx.journeyCache.set(key, shortestPath(ctx.graph, fromId, toId));
    }
    return ctx.journeyCache.get(key);
}

export function resolveJourney(fromId, toId, opts = {}) {
    const ctx = plannerContext(opts);
    return memoizedShortestPath(ctx, fromId, toId);
}

function uniqueDestinationIds(values) {
    const ids = [];
    for (const value of values) {
        const id = typeof value === 'string' ? value : value?.destinationId;
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

function daysByDestination(stayPlan) {
    const map = new Map();
    for (const stop of stayPlan || []) {
        const id = stop?.destinationId;
        const days = Number(stop?.days);
        if (!id || !Number.isFinite(days) || days <= 0) continue;
        map.set(id, (map.get(id) || 0) + Math.floor(days));
    }
    return map;
}

function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    const out = [];
    for (let i = 0; i < items.length; i += 1) {
        const head = items[i];
        const rest = items.slice(0, i).concat(items.slice(i + 1));
        for (const tail of permutations(rest)) out.push([head, ...tail]);
    }
    return out;
}

function stayJourneys(order, ctx) {
    const journeys = [];
    const first = order[0];
    const last = order[order.length - 1];

    if (first && first !== ctx.gatewayId) {
        const inbound = memoizedShortestPath(ctx, ctx.gatewayId, first);
        journeys.push({ kind: 'inbound', ...inbound });
    }

    for (let i = 0; i < order.length - 1; i += 1) {
        const hop = memoizedShortestPath(ctx, order[i], order[i + 1]);
        journeys.push({ kind: 'connection', ...hop });
    }

    if (!ctx.openJaw && last && last !== ctx.gatewayId) {
        const outbound = memoizedShortestPath(ctx, last, ctx.gatewayId);
        journeys.push({ kind: 'outbound', ...outbound });
    }

    return journeys;
}

function backtrackCount(order, destById) {
    let count = 0;
    for (let i = 0; i < order.length - 2; i += 1) {
        const a = coordsOf(order[i], destById);
        const b = coordsOf(order[i + 1], destById);
        const c = coordsOf(order[i + 2], destById);
        if (!a || !b || !c) continue;
        const v1 = { x: b.lng - a.lng, y: b.lat - a.lat };
        const v2 = { x: c.lng - b.lng, y: c.lat - b.lat };
        const mag1 = Math.hypot(v1.x, v1.y);
        const mag2 = Math.hypot(v2.x, v2.y);
        if (mag1 < 0.15 || mag2 < 0.15) continue;
        const cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
        if (cos < -0.2) count += 1;
    }
    return count;
}

function modeChangeCount(journeys) {
    let changes = 0;
    let prev = null;
    for (const journey of journeys) {
        for (const leg of journey.path || []) {
            if (prev && prev !== leg.mode) changes += 1;
            prev = leg.mode;
        }
    }
    return changes;
}

function extraHubCount(order, journeys, gatewayId) {
    let count = 0;
    for (const journey of journeys) {
        if (journey.kind !== 'connection') continue;
        if (journey.from === gatewayId || journey.to === gatewayId) continue;
        if ((journey.hubIds || []).includes(gatewayId)) count += 1;
    }
    const idx = order.indexOf(gatewayId);
    if (idx > 0 && idx < order.length - 1) count += 2;
    return count;
}

function scoreOrder(order, ctx) {
    const journeys = stayJourneys(order, ctx);
    const missing = journeys.some((j) => !j.path);
    const totalHours = missing
        ? Infinity
        : journeys.reduce((sum, j) => sum + j.hours, 0);
    const backtracks = backtrackCount(order, ctx.destById);
    const modeChanges = modeChangeCount(journeys);
    const extraHubs = extraHubCount(order, journeys, ctx.gatewayId);
    const gatewayIdx = order.indexOf(ctx.gatewayId);
    const gatewayMiddle = gatewayIdx > 0 && gatewayIdx < order.length - 1 ? 1 : 0;

    const score = missing
        ? Infinity
        : totalHours * WEIGHT.hours
            + backtracks * WEIGHT.backtrack
            + modeChanges * WEIGHT.modeChange
            + extraHubs * WEIGHT.extraHub
            + gatewayMiddle * WEIGHT.gatewayMiddle;

    const reasons = [];
    if (missing) reasons.push('missing-connection');
    if (backtracks) reasons.push('backtracking');
    if (extraHubs) reasons.push('via-add-hub');
    if (gatewayMiddle) reasons.push('gateway-middle');

    return { order, journeys, totalHours, score, reasons, missing };
}

function compareCandidates(a, b) {
    if (a.score !== b.score) return a.score - b.score;
    if (a.totalHours !== b.totalHours) return a.totalHours - b.totalHours;
    return a.order.join(',').localeCompare(b.order.join(','));
}

function nearestNeighbor(destIds, ctx) {
    const remaining = destIds.slice().sort((a, b) => a.localeCompare(b));
    const order = [];
    let current = ctx.gatewayId;
    if (remaining.includes(ctx.gatewayId)) {
        order.push(ctx.gatewayId);
        remaining.splice(remaining.indexOf(ctx.gatewayId), 1);
        current = ctx.gatewayId;
    }
    while (remaining.length) {
        let bestId = remaining[0];
        let bestHours = Infinity;
        for (const id of remaining) {
            const hop = memoizedShortestPath(ctx, current, id);
            const hours = hop.path ? hop.hours : Infinity;
            if (hours < bestHours || (hours === bestHours && id.localeCompare(bestId) < 0)) {
                bestHours = hours;
                bestId = id;
            }
        }
        order.push(bestId);
        remaining.splice(remaining.indexOf(bestId), 1);
        current = bestId;
    }
    return order;
}

function twoOptImprove(order, ctx) {
    let current = scoreOrder(order, ctx);
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 0; i < current.order.length - 1; i += 1) {
            for (let j = i + 1; j < current.order.length; j += 1) {
                const nextOrder = current.order.slice();
                const reversed = nextOrder.slice(i, j + 1).reverse();
                nextOrder.splice(i, j - i + 1, ...reversed);
                const candidate = scoreOrder(nextOrder, ctx);
                if (compareCandidates(candidate, current) < 0) {
                    current = candidate;
                    improved = true;
                }
            }
        }
    }
    return current;
}

function searchOrders(destIds, ctx, exactSearchLimit) {
    const requestedLimit = Number(exactSearchLimit);
    const limit = Number.isFinite(requestedLimit)
        ? Math.max(0, Math.min(EXACT_SEARCH_LIMIT, Math.floor(requestedLimit)))
        : EXACT_SEARCH_LIMIT;
    if (destIds.length <= 1) {
        return { selected: scoreOrder(destIds, ctx), rejected: [], searchMode: 'exact' };
    }

    if (destIds.length <= limit) {
        const scored = permutations(destIds.slice().sort((a, b) => a.localeCompare(b)))
            .map((order) => scoreOrder(order, ctx))
            .sort(compareCandidates);
        return {
            selected: scored[0],
            rejected: scored.slice(1, 9),
            searchMode: 'exact',
        };
    }

    const seed = nearestNeighbor(destIds, ctx);
    const selected = twoOptImprove(seed, ctx);
    const seedScored = scoreOrder(seed, ctx);
    const rejected = seedScored.order.join(',') === selected.order.join(',')
        ? []
        : [seedScored];
    return { selected, rejected, searchMode: 'heuristic' };
}

function inefficientVsBest(explicit, best) {
    if (!best || !Number.isFinite(best.score) || !Number.isFinite(explicit.score)) return false;
    if (explicit.order.join(',') === best.order.join(',')) return false;
    return explicit.score > best.score * 1.2 + 3;
}

function emptyPlan(ctx) {
    return {
        ok: true,
        gateway: {
            id: ctx.gatewayId,
            iata: destIata(ctx.destById.get(ctx.gatewayId)) || DEFAULT_GATEWAY_IATA,
        },
        openJaw: ctx.openJaw,
        ordered: [],
        destinations: [],
        orderedStops: [],
        route: [],
        stayPlan: [],
        journeys: [],
        totalHours: 0,
        warnings: [],
        errors: [],
        diagnostics: {
            selectedRoute: [],
            rejectedAlternatives: [],
            totalHours: 0,
            searchMode: 'exact',
        },
    };
}

/**
 * Deterministic gateway-aware destination ordering.
 *
 * @param {object} opts
 * @param {string[]} [opts.destinations]
 * @param {{destinationId: string, days: number}[]} [opts.stayPlan]
 * @param {boolean} [opts.explicitOrder] Preserve the given order when feasible.
 * @param {string} [opts.originIata]
 * @param {string} [opts.departureIata]
 * @param {boolean} [opts.openJaw] Do not score or append a return to ADD.
 * @param {string} [opts.gatewayId]
 * @param {object[]} [opts.connections]
 * @param {object[]} [opts.destinationRecords]
 * @param {number} [opts.exactSearchLimit]
 */
export function planRoute(opts = {}) {
    const stayPlan = Array.isArray(opts.stayPlan) ? opts.stayPlan : [];
    const destIds = uniqueDestinationIds(
        stayPlan.length ? stayPlan : (opts.destinations || []),
    );
    const ctx = plannerContext(opts);
    const daysMap = daysByDestination(stayPlan);
    const explicitOrder = Boolean(opts.explicitOrder);

    if (!destIds.length) return emptyPlan(ctx);

    const searched = searchOrders(destIds, ctx, opts.exactSearchLimit);
    const selected = explicitOrder ? scoreOrder(destIds, ctx) : searched.selected;
    const warnings = [];
    const errors = [];

    if (explicitOrder && inefficientVsBest(selected, searched.selected)) {
        warnings.push({
            code: 'inefficient-order',
            message: `The requested order adds extra travel. A more efficient sequence is ${searched.selected.order.join(' → ')}.`,
            suggestedOrder: searched.selected.order.slice(),
        });
    }

    for (const journey of selected.journeys) {
        if (!journey.path) {
            errors.push({
                code: 'no-route',
                from: journey.from,
                to: journey.to,
                message: `No catalogued connection between ${journey.from} and ${journey.to}.`,
            });
        }
    }

    const orderedStops = selected.order.map((destinationId) => ({
        destinationId,
        days: daysMap.has(destinationId) ? daysMap.get(destinationId) : null,
        isGatewayStay: destinationId === ctx.gatewayId,
    }));

    const diagnosticsRejected = (explicitOrder
        ? [searched.selected, ...searched.rejected]
        : searched.rejected
    )
        .filter((candidate) => candidate.order.join(',') !== selected.order.join(','))
        .slice(0, 8)
        .map((candidate) => ({
            order: candidate.order,
            totalHours: candidate.totalHours,
            score: candidate.score,
            reasons: candidate.reasons,
        }));

    const orderedIds = selected.order;
    return {
        ok: errors.length === 0 && Number.isFinite(selected.totalHours),
        gateway: {
            id: ctx.gatewayId,
            iata: destIata(ctx.destById.get(ctx.gatewayId)) || DEFAULT_GATEWAY_IATA,
        },
        openJaw: ctx.openJaw,
        originIata: ctx.originIata,
        ordered: orderedIds,
        destinations: orderedIds,
        orderedStops,
        route: orderedStops,
        stayPlan: orderedStops.map((stop) => ({
            destinationId: stop.destinationId,
            days: stop.days,
        })),
        journeys: selected.journeys,
        totalHours: selected.totalHours,
        warnings,
        errors,
        diagnostics: {
            selectedRoute: orderedIds,
            rejectedAlternatives: diagnosticsRejected,
            totalHours: selected.totalHours,
            score: selected.score,
            searchMode: searched.searchMode,
            reasons: selected.reasons,
        },
    };
}

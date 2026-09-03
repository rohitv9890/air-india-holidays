#!/usr/bin/env node
/**
 * Apply Guzo inventory remediation to data/catalog/v1:
 * - repair geography (Ziway, Abijatta–Shalla; Heathrow as origin flight point)
 * - classify lifecycle (active/draft/rejected) without inventing commercial data
 * - normalize accommodation price bases + FX provenance for Hermes hotels
 * - add typed relationships + recommendation metadata for baseline packages
 * - slim package dayTemplates to moduleId overrides (never re-inline day prose)
 *
 * Idempotent: safe to re-run. Does not invent prices, inclusions, routes, or day copy.
 *
 * Usage: node scripts/remediate-catalog-inventory.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ROOT,
    validateCatalogIntegrity,
    classifyActiveBlockers,
    INTERNATIONAL_ORIGINS,
} from './lib/catalog-integrity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(ROOT, 'data/catalog/v1');
const BUNDLE_DIR = join(ROOT, 'research/hermes-ethiopia-remediation-2026-08-09');
const HOTELS_PATH = join(ROOT, 'research/hermes-ethiopia-hotels-2026-08-08/hotels.jsonl');

const FX_TO_GBP = { GBP: 1, EUR: 1 / 1.17, USD: 0.78, ETB: 0.0054 };
const FX_DATE = '2026-08-09';

const BASELINE_PACKAGE_IDS = new Set([
    'pkg-northern-historic-7d',
    'pkg-northern-historic-8d',
    'pkg-omo-cultural-6d',
    'pkg-simien-trek-5d',
    'pkg-addis-stopover-3d',
    'pkg-danakil-adventure-4d',
    'pkg-bale-wildlife-5d',
    'pkg-harar-heritage-4d',
]);

const HERMES_HOTEL_PROVENANCE = {
    'acc-addis-ababa-haile-grand': {
        sourceAmount: 110,
        sourceCurrency: 'USD',
        sourceBasis: 'per-night',
        hotelId: 'hotel-addis-ababa-haile-grand',
    },
    'acc-addis-ababa-hotel-lobelia': {
        sourceAmount: 42.18,
        sourceCurrency: 'USD',
        sourceBasis: 'per-night',
        hotelId: 'hotel-addis-ababa-hotel-lobelia',
    },
    'acc-addis-ababa-skylight-in-terminal-hotel': {
        sourceAmount: 175,
        sourceCurrency: 'USD',
        sourceBasis: 'per-night',
        hotelId: 'hotel-addis-ababa-skylight-in-terminal-hotel',
    },
    'acc-addis-ababa-sunland-international-hotel': {
        sourceAmount: 3170,
        sourceCurrency: 'ETB',
        sourceBasis: 'per-night',
        hotelId: 'hotel-addis-ababa-sunland-international-hotel',
    },
};

const NEW_DESTINATIONS = [
    {
        id: 'ziway',
        name: 'Ziway',
        iata: null,
        cluster: 'rift-valley',
        region: 'Oromia',
        themes: ['lakes', 'nature', 'birds'],
        summary: 'Rift Valley lakeside town on the Addis–Hawassa corridor, known for birdlife around Lake Ziway.',
        aliases: ['ziway', 'lake ziway', 'zway'],
        lat: 7.933,
        lng: 38.715,
        stayGuidance: { minDays: 1, recommendedDays: 2 },
    },
    {
        id: 'abijatta-shalla',
        name: 'Abijatta–Shalla',
        iata: null,
        cluster: 'rift-valley',
        region: 'Oromia',
        themes: ['lakes', 'nature', 'wildlife'],
        summary: 'Abijatta–Shalla Lakes National Park in the central Rift Valley.',
        aliases: ['abiata-shala', 'abijatta', 'abijata', 'shalla', 'abijatta-shalla', 'abiata shalla'],
        lat: 7.5,
        lng: 38.63,
        stayGuidance: { minDays: 1, recommendedDays: 1 },
    },
    {
        id: 'yirgacheffe',
        name: 'Yirgacheffe',
        iata: null,
        cluster: 'rift-valley',
        region: 'SNNPR',
        themes: ['coffee', 'culture', 'nature'],
        summary: 'Coffee-growing highlands south of Hawassa, used as an overnight on southern Rift Valley circuits.',
        aliases: ['yirgacheffe', 'yirga cheffe', 'yerga cheffe', 'dilla'],
        lat: 6.162,
        lng: 38.205,
        stayGuidance: { minDays: 1, recommendedDays: 2 },
    },
];

/**
 * Source-backed overnight/route repairs. Evidence only from Hermes canonical
 * itineraries + operator pages cited in provenance (no invented nights).
 *
 * - pkg-classic-ethiopia-highlights-10d-set: day-by-day accommodation list on
 *   simienecotours GR03 shows 2 Gondar nights (D4–D5 at Harfazy), not 3.
 * - pkg-ee-around-rift-valley-lakes-11d: ethiopianexperiences.com itinerary
 *   (src-636fb49e4607) — Ziway×2 (incl. return after Abiata/Shala day visit),
 *   Yirgacheffe hotel, Konso/Kanta Lodge, Arba Minch×2, Addis final night.
 * - pkg-venture-rift-valley-lakes-3d: venture-ethiopia itinerary
 *   (src-ea9d289f8b2c) — night Ziway, night Hawassa; park/day visits = 0.
 */
const SOURCE_BACKED_PACKAGE_ROUTES = {
    'pkg-classic-ethiopia-highlights-10d-set': {
        duration: { days: 10, nights: 9 },
        originFlightPoint: null,
        route: [
            { sequence: 1, destinationId: 'addis-ababa', nights: 1, transportToNext: 'flight' },
            { sequence: 2, destinationId: 'bahir-dar', nights: 2, transportToNext: 'road' },
            { sequence: 3, destinationId: 'gondar', nights: 2, transportToNext: 'road' },
            { sequence: 4, destinationId: 'simien', nights: 0, transportToNext: 'road' },
            { sequence: 5, destinationId: 'gondar', nights: 0, transportToNext: 'flight' },
            { sequence: 6, destinationId: 'lalibela', nights: 2, transportToNext: 'flight' },
            { sequence: 7, destinationId: 'addis-ababa', nights: 0, transportToNext: 'road' },
            { sequence: 8, destinationId: 'rift-valley-lakes', nights: 2, transportToNext: 'road' },
            { sequence: 9, destinationId: 'addis-ababa', nights: 0, transportToNext: null },
        ],
        evidence: 'simienecotours GR03 day accommodation list (canonical itinerary)',
    },
    'pkg-ee-around-rift-valley-lakes-11d': {
        duration: { days: 11, nights: 10 },
        originFlightPoint: 'LHR',
        route: [
            { sequence: 1, destinationId: 'bishoftu', nights: 1, transportToNext: 'road' },
            { sequence: 2, destinationId: 'ziway', nights: 2, transportToNext: 'road' },
            { sequence: 3, destinationId: 'abijatta-shalla', nights: 0, transportToNext: 'road' },
            { sequence: 4, destinationId: 'hawassa', nights: 2, transportToNext: 'road' },
            { sequence: 5, destinationId: 'yirgacheffe', nights: 1, transportToNext: 'road' },
            { sequence: 6, destinationId: 'omo-valley', nights: 1, transportToNext: 'road' },
            { sequence: 7, destinationId: 'arba-minch', nights: 2, transportToNext: 'flight' },
            { sequence: 8, destinationId: 'addis-ababa', nights: 1, transportToNext: null },
        ],
        evidence: 'ethiopianexperiences.com/the-rift-valley-lakes overnight statements',
    },
    'pkg-venture-rift-valley-lakes-3d': {
        duration: { days: 3, nights: 2 },
        originFlightPoint: null,
        route: [
            { sequence: 1, destinationId: 'addis-ababa', nights: 0, transportToNext: 'road' },
            { sequence: 2, destinationId: 'ziway', nights: 1, transportToNext: 'road' },
            { sequence: 3, destinationId: 'abijatta-shalla', nights: 0, transportToNext: 'road' },
            { sequence: 4, destinationId: 'hawassa', nights: 1, transportToNext: 'road' },
            { sequence: 5, destinationId: 'addis-ababa', nights: 0, transportToNext: null },
        ],
        evidence: 'venture-ethiopia rift-valley-lakes-3-day-tour overnight statements',
    },
};

/** Do not invent media URLs — new geography stubs ship without images until sourced. */
const DEST_PRODUCT_MEDIA = {};

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function roundMoney(n) {
    return Math.round(n * 100) / 100;
}

function ensureDestinationRegistry(destDoc) {
    const byId = new Map(destDoc.destinations.map((d) => [d.id, d]));
    for (const d of NEW_DESTINATIONS) {
        const existing = byId.get(d.id);
        if (existing) {
            existing.aliases = [...new Set([...(existing.aliases || []), ...d.aliases])];
            Object.assign(existing, {
                name: existing.name || d.name,
                cluster: existing.cluster || d.cluster,
                region: existing.region || d.region,
                themes: existing.themes?.length ? existing.themes : d.themes,
                summary: existing.summary || d.summary,
            });
            if (existing.lat == null && d.lat != null) existing.lat = d.lat;
            if (existing.lng == null && d.lng != null) existing.lng = d.lng;
            if (!existing.stayGuidance && d.stayGuidance) existing.stayGuidance = d.stayGuidance;
        } else {
            destDoc.destinations.push({ ...d });
            byId.set(d.id, d);
        }
    }
    // Aliases for existing destinations
    const aliasExtras = {
        'rift-valley-lakes': ['rift valley', 'rift valley lakes', 'langano', 'lake langano'],
        hawassa: ['awassa', 'awasa'],
        bishoftu: ['debre zeit', 'debre-zeit'],
        simien: ['simien mountains', 'simiens'],
        'omo-valley': ['omo', 'lower omo', 'konso', 'karat-konso', 'karat konso'],
        danakil: ['danakil depression', 'afar'],
    };
    for (const [id, aliases] of Object.entries(aliasExtras)) {
        const d = byId.get(id);
        if (d) d.aliases = [...new Set([...(d.aliases || []), ...aliases])];
    }
    return destDoc;
}

function ensureDestinationProducts(catalog) {
    const ids = new Set(catalog.products.map((p) => p.id));
    for (const d of NEW_DESTINATIONS) {
        const id = `dest-${d.id}`;
        if (ids.has(id)) continue;
        const media = DEST_PRODUCT_MEDIA[d.id];
        catalog.products.push({
            id,
            type: 'destination',
            name: d.name,
            summary: d.summary,
            destinations: [d.id],
            themes: d.themes,
            duration: { days: 0, nights: 0 },
            tier: 'classic',
            basePrice: { amount: 0, currency: 'GBP', basis: 'flat' },
            inclusions: [],
            exclusions: [],
            images: media ? [media] : [],
            easygds: {
                placeId: null,
                packageId: null,
                hotelId: null,
                flightConfigId: null,
                productCode: id,
            },
            seasonality: {
                peakMonths: [12, 1],
                rainyMonths: [6, 7, 8, 9],
                notes: 'Rift Valley lake corridor',
            },
            compatibility: [d.cluster, 'ethiopia'],
            iata: d.iata || undefined,
            cluster: d.cluster,
            region: d.region,
            status: 'active',
            availabilityMode: 'indicative',
            confidence: 'high',
            sourceRefs: ['geography-remediation-2026-08-10'],
        });
        ids.add(id);
    }
}

function mapRouteDestination(id) {
    if (!id) return id;
    const key = String(id).toLowerCase();
    if (key === 'abiata-shala' || key === 'abijata-shalla' || key === 'abijatta-shala') {
        return 'abijatta-shalla';
    }
    if (key === 'zway') return 'ziway';
    return id;
}

function repairPackageGeography(product) {
    if (product.type !== 'package' || !product.route?.length) return product;
    const route = [];
    let originFlightPoint = product.originFlightPoint || null;
    for (const stop of product.route) {
        const rawId = stop.destinationId;
        if (INTERNATIONAL_ORIGINS.has(String(rawId || '').toLowerCase()) || rawId === 'heathrow') {
            originFlightPoint = originFlightPoint || (rawId === 'heathrow' ? 'LHR' : String(rawId).toUpperCase());
            continue;
        }
        route.push({
            ...stop,
            destinationId: mapRouteDestination(rawId),
        });
    }
    // Re-sequence after removals
    const resealed = route.map((stop, i) => ({ ...stop, sequence: i + 1 }));
    const destSet = new Set([
        ...(product.destinations || []).map(mapRouteDestination).filter((d) => !INTERNATIONAL_ORIGINS.has(d)),
        ...resealed.map((s) => s.destinationId),
    ]);
    return {
        ...product,
        route: resealed,
        destinations: [...destSet],
        originFlightPoint: originFlightPoint || product.originFlightPoint,
    };
}

function loadBrilliantEthiopiaRepairs() {
    const path = join(BUNDLE_DIR, '../guzo-enrichment-2026-08-10/brilliant-ethiopia-package-repairs.json');
    // research/hermes-.../../guzo-enrichment-... 
    const alt = join(ROOT, 'research/guzo-enrichment-2026-08-10/brilliant-ethiopia-package-repairs.json');
    const file = existsSync(alt) ? alt : path;
    if (!existsSync(file)) return {};
    return readJson(file);
}

function applySourceBackedPackageRoutes(product, brilliantRepairs = {}) {
    const be = brilliantRepairs[product.id];
    const fix = SOURCE_BACKED_PACKAGE_ROUTES[product.id] || (be?.route ? {
        duration: be.duration,
        originFlightPoint: null,
        route: be.route,
        evidence: be.evidence,
    } : null);
    if (product.type !== 'package') return product;

    let next = { ...product };

    // Apply inclusions/exclusions from Brilliant Ethiopia operator pages even when route is still missing.
    if (be?.inclusions?.length) {
        next.inclusions = [...be.inclusions];
        next.inclusionCompleteness = 'partial';
    }
    if (be?.exclusions?.length) {
        next.exclusions = [...be.exclusions];
        next.exclusionCompleteness = 'partial';
    }
    if (be?.destinations?.length && !fix) {
        next.destinations = [...new Set([
            ...(next.destinations || []),
            ...be.destinations.map(mapRouteDestination),
        ])];
    }
    if (be?.evidence) {
        next.sourceRefs = [...new Set([...(next.sourceRefs || []), be.evidence.split(' — ')[0], 'brilliant-ethiopia-package-repairs'])];
    }

    if (!fix) return next;

    const route = fix.route.map((stop, i) => ({
        sequence: i + 1,
        destinationId: mapRouteDestination(stop.destinationId),
        nights: stop.nights,
        transportToNext: stop.transportToNext,
    }));
    const destSet = new Set([
        ...(next.destinations || []).map(mapRouteDestination).filter((d) => !INTERNATIONAL_ORIGINS.has(String(d).toLowerCase())),
        ...route.map((s) => s.destinationId),
        ...((be?.destinations || []).map(mapRouteDestination)),
    ]);
    next = {
        ...next,
        route,
        destinations: [...destSet],
        duration: {
            ...(next.duration || {}),
            ...fix.duration,
        },
        routeNightEvidence: fix.evidence,
    };
    if (fix.originFlightPoint) {
        next.originFlightPoint = fix.originFlightPoint;
    } else {
        delete next.originFlightPoint;
    }
    return next;
}

function unsupportedFlightLegs(product, destDoc, flightsDoc) {
    const iataByDest = new Map(
        (destDoc.destinations || []).filter((d) => d.iata).map((d) => [d.id, String(d.iata).toUpperCase()]),
    );
    const pairs = new Set((flightsDoc.routes || []).map((r) => `${r.origin}->${r.destination}`));
    const gaps = [];
    const route = product.route || [];
    for (const stop of route) {
        if (stop.transportToNext !== 'flight') continue;
        const next = route.find((s) => s.sequence === stop.sequence + 1);
        if (!next) continue;
        const fromIata = iataByDest.get(stop.destinationId);
        const toIata = iataByDest.get(next.destinationId);
        if (!fromIata || !toIata) {
            gaps.push({
                fromDestinationId: stop.destinationId,
                toDestinationId: next.destinationId,
                fromIata: fromIata || '',
                toIata: toIata || '',
                reason: 'missing-iata-or-unsupported-domestic-route',
            });
            continue;
        }
        if (!pairs.has(`${fromIata}->${toIata}`)) {
            gaps.push({
                fromDestinationId: stop.destinationId,
                toDestinationId: next.destinationId,
                fromIata,
                toIata,
                reason: 'no-catalog-flight-route',
            });
        }
    }
    return gaps;
}

function relationshipTypeFor(target) {
    if (!target) return 'optional-addon';
    if (target.type === 'package') return 'alternative';
    return 'optional-addon';
}

function buildRelationships(product, byId) {
    const existing = [...(product.relationships || [])];
    const seen = new Set(existing.map((r) => `${r.type}:${r.productId}`));
    for (const id of product.relatedIds || []) {
        const target = byId.get(id);
        if (!target || target.status === 'rejected') continue;
        if (target.status === 'draft') continue;
        const type = relationshipTypeFor(target);
        const key = `${type}:${id}`;
        if (seen.has(key)) continue;
        existing.push({ type, productId: id });
        seen.add(key);
    }

    // Baseline package alternatives / extensions (only among active baseline IDs)
    if (BASELINE_PACKAGE_IDS.has(product.id)) {
        const pairs = {
            'pkg-northern-historic-7d': [
                { type: 'alternative', productId: 'pkg-northern-historic-8d', note: 'Longer northern circuit' },
                { type: 'extension', productId: 'pkg-simien-trek-5d', note: 'Simien trek extension' },
                { type: 'optional-addon', productId: 'pkg-addis-stopover-3d', note: 'Addis city stopover' },
            ],
            'pkg-northern-historic-8d': [
                { type: 'alternative', productId: 'pkg-northern-historic-7d', note: 'Shorter northern circuit' },
                { type: 'tier-upgrade', productId: 'pkg-northern-historic-8d', note: 'Signature northern tier within same product' },
            ],
            'pkg-omo-cultural-6d': [
                { type: 'optional-addon', productId: 'pkg-addis-stopover-3d', note: 'Gateway stopover' },
            ],
            'pkg-simien-trek-5d': [
                { type: 'extension', productId: 'pkg-northern-historic-7d', note: 'Combine with historic north' },
            ],
            'pkg-addis-stopover-3d': [
                { type: 'extension', productId: 'pkg-harar-heritage-4d', note: 'Eastbound extension' },
                { type: 'extension', productId: 'pkg-bale-wildlife-5d', note: 'Bale extension' },
            ],
            'pkg-danakil-adventure-4d': [
                { type: 'optional-addon', productId: 'pkg-addis-stopover-3d', note: 'Addis buffer nights' },
            ],
            'pkg-bale-wildlife-5d': [
                { type: 'optional-addon', productId: 'pkg-addis-stopover-3d', note: 'Addis buffer nights' },
            ],
            'pkg-harar-heritage-4d': [
                { type: 'optional-addon', productId: 'pkg-addis-stopover-3d', note: 'Addis buffer nights' },
            ],
        };
        for (const rel of pairs[product.id] || []) {
            // Skip self tier-upgrade placeholder — remove that mistaken entry
            if (rel.type === 'tier-upgrade' && rel.productId === product.id) continue;
            const target = byId.get(rel.productId);
            if (!target || target.status !== 'active') continue;
            const key = `${rel.type}:${rel.productId}`;
            if (seen.has(key)) continue;
            existing.push(rel);
            seen.add(key);
        }
    }
    return existing;
}

function slimDayTemplates(product, moduleByTitle) {
    if (product.type !== 'package') return product.dayTemplates;
    const existing = product.dayTemplates;
    if (!existing?.length) return undefined;

    const slimmed = [];
    for (const template of existing) {
        if (!template || typeof template !== 'object') continue;
        const day = Number(template.day);
        if (!Number.isFinite(day)) continue;
        let moduleId = template.moduleId;
        if (!moduleId && template.title && template.destinationId) {
            const destKey = `${template.destinationId}::${String(template.title).toLowerCase().trim()}`;
            const matchingModules = moduleByTitle.get(destKey) || [];
            if (matchingModules.length === 1) moduleId = matchingModules[0].id;
        }
        if (!moduleId && !template.destinationId) continue;
        const slim = { day };
        if (moduleId) slim.moduleId = moduleId;
        if (template.destinationId) slim.destinationId = template.destinationId;
        if (Array.isArray(template.experienceIds) && template.experienceIds.length) {
            slim.experienceIds = template.experienceIds;
        }
        slimmed.push(slim);
    }
    return slimmed.length ? slimmed : undefined;
}

function travellerFitFor(product) {
    if (product.travellerFit?.length) return product.travellerFit;
    const fit = new Set();
    for (const c of product.compatibility || []) {
        if (['couples', 'families', 'first-timers', 'solo', 'groups'].includes(c)) fit.add(c);
    }
    for (const t of product.themes || []) {
        if (['unesco', 'trek', 'wildlife', 'culture', 'adventure', 'history'].includes(t)) fit.add(t);
    }
    if (product.id.includes('stopover')) fit.add('stopover');
    if (product.id.includes('trek') || product.themes?.includes('trek')) fit.add('active-travellers');
    return [...fit];
}

function paceFor(product) {
    if (product.pace) return product.pace;
    if (product.themes?.includes('trek') || product.id.includes('trek') || product.id.includes('danakil')) {
        return 'active';
    }
    if (product.id.includes('stopover')) return 'relaxed';
    return 'moderate';
}

function normalizeAccommodationCommerce(product) {
    if (product.type !== 'accommodation') return product;
    // Prefer newer enrichment-return provenance over static Hermes hotel constants.
    if (String(product.priceProvenance?.notes || '').includes('guzo-enrichment-return')) {
        // OTA one-night room quotes are stored as per-night room rates in the catalog.
        const basis = product.basePrice?.basis === 'per-room' ? 'per-night' : (product.basePrice?.basis || 'per-night');
        return {
            ...product,
            basePrice: {
                amount: product.basePrice.amount,
                currency: 'GBP',
                basis,
            },
            priceProvenance: {
                ...product.priceProvenance,
                sourceBasis: basis,
            },
            inclusionCompleteness: product.inclusions?.length ? 'partial' : 'unknown',
            exclusionCompleteness: product.exclusions?.length ? 'partial' : 'unknown',
        };
    }
    const hermes = HERMES_HOTEL_PROVENANCE[product.id];
    if (hermes) {
        const rate = FX_TO_GBP[hermes.sourceCurrency];
        const converted = roundMoney(hermes.sourceAmount * rate);
        return {
            ...product,
            basePrice: {
                amount: product.basePrice?.amount > 0 ? product.basePrice.amount : converted,
                currency: 'GBP',
                basis: 'per-night',
            },
            priceProvenance: {
                sourceAmount: hermes.sourceAmount,
                sourceCurrency: hermes.sourceCurrency,
                sourceBasis: hermes.sourceBasis,
                fxRateToGbp: rate,
                fxDate: FX_DATE,
                convertedAmount: converted,
                convertedCurrency: 'GBP',
                notes: `Observed rate from ${hermes.hotelId}; converted with documented FX.`,
            },
            inclusionCompleteness: product.inclusions?.length ? 'partial' : 'unknown',
            exclusionCompleteness: product.exclusions?.length ? 'partial' : 'unknown',
        };
    }

    // Baseline synthetic hotels were incorrectly stored as per-person; they are room-night rates.
    if (product.basePrice?.basis === 'per-person' && product.basePrice.amount > 0) {
        return {
            ...product,
            basePrice: {
                ...product.basePrice,
                basis: 'per-night',
            },
            priceProvenance: {
                sourceAmount: product.basePrice.amount,
                sourceCurrency: 'GBP',
                sourceBasis: 'per-night',
                fxRateToGbp: 1,
                fxDate: FX_DATE,
                convertedAmount: product.basePrice.amount,
                convertedCurrency: 'GBP',
                notes: 'Baseline synthetic hotel rate reclassified from per-person to per-night; amount unchanged.',
            },
            inclusionCompleteness: product.inclusions?.length ? 'partial' : 'unknown',
            exclusionCompleteness: product.exclusions?.length ? 'partial' : 'unknown',
        };
    }
    return product;
}

function provenanceForProduct(product, provenanceByCatalogId) {
    const row = provenanceByCatalogId.get(product.id);
    if (row) {
        return {
            sourceRefs: [...new Set([...(row.sourceIds || []), ...(row.sourceRecordIds || [])])],
            confidence: row.sourceIds?.length >= 2 ? 'medium' : 'low',
        };
    }
    if (BASELINE_PACKAGE_IDS.has(product.id) || product.id.startsWith('dest-') || product.id.startsWith('acc-') && !product.id.includes('addis-ababa-')) {
        if (product.id.startsWith('acc-addis-ababa-')) {
            return { sourceRefs: [`hermes:${HERMES_HOTEL_PROVENANCE[product.id]?.hotelId}`], confidence: 'medium' };
        }
        return {
            sourceRefs: ['synthetic-baseline-v1'],
            confidence: 'high',
        };
    }
    if (HERMES_HOTEL_PROVENANCE[product.id]) {
        return {
            sourceRefs: [`hermes:${HERMES_HOTEL_PROVENANCE[product.id].hotelId}`],
            confidence: 'medium',
        };
    }
    if (product.id.startsWith('pkg-be') || product.id.startsWith('pkg-ee') || product.id.startsWith('pkg-venture') || product.id.includes('highlights')) {
        return {
            sourceRefs: [`hermes-remediation:${product.id}`],
            confidence: 'low',
        };
    }
    return {
        sourceRefs: product.sourceRefs || ['synthetic-baseline-v1'],
        confidence: product.confidence || 'high',
    };
}

function applyLifecycle(product, ctx) {
    const isBaselinePkg = BASELINE_PACKAGE_IDS.has(product.id);
    const isHermesPkg = product.type === 'package' && !isBaselinePkg;
    const prov = provenanceForProduct(product, ctx.provenanceByCatalogId);

    let next = {
        ...product,
        sourceRefs: product.sourceRefs?.length ? product.sourceRefs : prov.sourceRefs,
        confidence: product.confidence || prov.confidence,
        availabilityMode: product.availabilityMode || 'indicative',
    };

    if (next.type === 'package') {
        next.inclusionCompleteness = next.inclusions?.length
            ? (isBaselinePkg ? 'complete' : 'partial')
            : 'unknown';
        next.exclusionCompleteness = next.exclusions?.length
            ? (isBaselinePkg ? 'complete' : 'partial')
            : 'unknown';
    } else if (next.type === 'accommodation') {
        next.inclusionCompleteness = next.inclusionCompleteness || (next.inclusions?.length ? 'partial' : 'unknown');
        next.exclusionCompleteness = next.exclusionCompleteness || (next.exclusions?.length ? 'partial' : 'unknown');
    } else {
        next.inclusionCompleteness = next.inclusionCompleteness || (next.inclusions?.length ? 'partial' : 'unknown');
        next.exclusionCompleteness = next.exclusionCompleteness || (next.exclusions?.length ? 'partial' : 'unknown');
    }

    // Temporary status for gate evaluation
    next.status = 'active';
    const blockers = classifyActiveBlockers(next, ctx);

    if (next.type === 'destination' || next.type === 'experience' || next.type === 'transfer' || next.type === 'flight') {
        next.status = 'active';
        next.blockers = [];
        next.confidence = next.confidence || 'high';
        if (!next.sourceRefs?.length) next.sourceRefs = ['synthetic-baseline-v1'];
        return next;
    }

    if (next.type === 'accommodation') {
        const accomBlockers = blockers.filter((b) =>
            b.startsWith('PRICE_') || b.startsWith('DEST_') || b.startsWith('RELATIONSHIP_') || b.startsWith('RELATED_'),
        );
        if (accomBlockers.length) {
            next.status = 'draft';
            next.blockers = accomBlockers;
            next.confidence = 'low';
        } else {
            next.status = 'active';
            next.blockers = [];
        }
        return next;
    }

    if (next.type === 'package') {
        // Relax inclusion-completeness unknown for gate when we already have INCLUSIONS_MISSING
        const meaningful = blockers.filter((b) => b !== 'INCLUSION_COMPLETENESS_UNKNOWN');
        if (isBaselinePkg && meaningful.length === 0) {
            next.status = 'active';
            next.blockers = [];
            next.confidence = 'high';
            return next;
        }
        if (meaningful.length) {
            next.status = 'draft';
            next.blockers = meaningful;
            next.confidence = isHermesPkg ? 'low' : 'medium';
            return next;
        }
        next.status = 'active';
        next.blockers = [];
        return next;
    }

    next.status = 'draft';
    next.blockers = blockers.length ? blockers : ['UNCLASSIFIED'];
    return next;
}

function main() {
    const catalog = readJson(join(CATALOG_DIR, 'catalog.json'));
    let destDoc = readJson(join(CATALOG_DIR, 'destinations.json'));
    const flightsDoc = readJson(join(CATALOG_DIR, 'flights.json'));
    const dayIdeas = existsSync(join(CATALOG_DIR, 'day-ideas.json'))
        ? readJson(join(CATALOG_DIR, 'day-ideas.json'))
        : null;
    const connectionsDoc = existsSync(join(CATALOG_DIR, 'connections.json'))
        ? readJson(join(CATALOG_DIR, 'connections.json'))
        : null;
    const moduleByTitle = new Map();
    for (const [destId, program] of Object.entries(dayIdeas?.destinations || {})) {
        for (const module of program.modules || []) {
            const key = `${destId}::${String(module.title || '').toLowerCase().trim()}`;
            const matches = moduleByTitle.get(key) || [];
            matches.push(module);
            moduleByTitle.set(key, matches);
        }
    }
    const provenance = readJsonl(join(BUNDLE_DIR, 'provenance.jsonl'));
    const provenanceByCatalogId = new Map(provenance.map((p) => [p.catalogId, p]));
    const pending = readJsonl(join(BUNDLE_DIR, 'catalog-products-pending.jsonl'));
    const brilliantRepairs = loadBrilliantEthiopiaRepairs();

    destDoc = ensureDestinationRegistry(destDoc);
    ensureDestinationProducts(catalog);

    // Pass 1: geography + source-backed nights + commerce
    catalog.products = catalog.products.map((p) => {
        let next = repairPackageGeography(p);
        next = applySourceBackedPackageRoutes(next, brilliantRepairs);
        next = normalizeAccommodationCommerce(next);
        return next;
    });

    const destIds = new Set(destDoc.destinations.map((d) => d.id));
    const productIds = new Set(catalog.products.map((p) => p.id));
    const iataByDest = new Map(
        destDoc.destinations.filter((d) => d.iata).map((d) => [d.id, String(d.iata).toUpperCase()]),
    );
    const flightPairs = new Set(flightsDoc.routes.map((r) => `${r.origin}->${r.destination}`));
    const ctx = {
        destIds,
        productIds,
        flightPairs,
        iataByDest,
        provenanceByCatalogId,
    };

    // Pass 2: flight coverage flags + lifecycle
    catalog.products = catalog.products.map((p) => {
        let next = { ...p };
        if (next.type === 'package') {
            const gaps = unsupportedFlightLegs(next, destDoc, flightsDoc);
            if (gaps.length) next.unsupportedFlightLegs = gaps;
            else delete next.unsupportedFlightLegs;
        }
        next = applyLifecycle(next, ctx);
        return next;
    });

    // Pass 3: relationships + recommendation metadata (after statuses known)
    let byId = new Map(catalog.products.map((p) => [p.id, p]));
    catalog.products = catalog.products.map((p) => {
        if (p.type !== 'package' && p.type !== 'accommodation') {
            // still allow relatedIds conversion for other types
        }
        const relationships = buildRelationships(p, byId).filter((rel) => {
            const target = byId.get(rel.productId);
            return target && target.status === 'active';
        });
        const dayTemplates = slimDayTemplates(p, moduleByTitle);
        const next = {
            ...p,
            relationships: relationships.length ? relationships : undefined,
        };
        if (p.type === 'package') {
            next.travellerFit = travellerFitFor(p);
            next.pace = paceFor(p);
            next.minDurationDays = p.duration?.days || undefined;
            next.maxDurationDays = p.duration?.days ? p.duration.days + 3 : undefined;
            next.permittedExtraNights = BASELINE_PACKAGE_IDS.has(p.id) ? 2 : 0;
            next.combinableDestinations = [...new Set([
                ...(p.destinations || []),
                ...(p.id.includes('northern') || p.id.includes('simien') ? ['axum'] : []),
                ...(p.destinations || []).includes('addis-ababa') ? ['bishoftu'] : [],
            ])];
            if (dayTemplates?.length) next.dayTemplates = dayTemplates;
            else delete next.dayTemplates;
            if (p.themes?.includes('trek') || p.id.includes('trek')) {
                next.accessibilityNotes = 'Involves uneven terrain and altitude; not suitable for limited mobility without review.';
            } else if (BASELINE_PACKAGE_IDS.has(p.id)) {
                next.accessibilityNotes = 'Standard guided touring; confirm site access for limited mobility.';
            }
        }
        // Strip undefined optional keys
        for (const key of Object.keys(next)) {
            if (next[key] === undefined) delete next[key];
        }
        return next;
    });

    // Re-run active relationship filter after metadata (statuses unchanged)
    byId = new Map(catalog.products.map((p) => [p.id, p]));
    catalog.products = catalog.products.map((p) => {
        if (!p.relationships?.length) return p;
        return {
            ...p,
            relationships: p.relationships.filter((rel) => byId.get(rel.productId)?.status === 'active'),
        };
    });

    catalog.generatedAt = new Date().toISOString();
    catalog.notes =
        'Guzo catalog v1: synthetic baseline (active) plus Hermes imports. ' +
        'Incomplete Hermes packages remain draft until route/inclusion/price gates pass. ' +
        'Day titles, copy, and images live in day-ideas.json modules; package dayTemplates are optional moduleId overrides only. ' +
        'Availability mode is indicative until allotment APIs. ' +
        'FX for imports: EUR÷1.17, USD×0.78, ETB×0.0054 (fxDate 2026-08-09).';

    writeFileSync(join(CATALOG_DIR, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    writeFileSync(join(CATALOG_DIR, 'destinations.json'), JSON.stringify(destDoc, null, 2) + '\n');

    const result = validateCatalogIntegrity({
        catalog,
        destinations: destDoc,
        flights: flightsDoc,
        dayIdeas,
        connections: connectionsDoc,
    });
    const promoted = catalog.products.filter((p) => p.status === 'active').map((p) => p.id);
    const drafted = catalog.products.filter((p) => p.status === 'draft').map((p) => ({
        id: p.id,
        blockers: p.blockers || [],
    }));
    const rejectedPending = pending.filter((row) =>
        (row.blockers || []).some((b) =>
            ['DUPLICATE_UNRESOLVED', 'SAFETY_REVIEW_REQUIRED', 'OPERATING_STATUS_UNVERIFIED'].includes(b.code),
        ),
    );

    const manifest = {
        generatedAt: catalog.generatedAt,
        counts: {
            active: promoted.length,
            draft: drafted.length,
            rejectedInCatalog: catalog.products.filter((p) => p.status === 'rejected').length,
            pendingQuarantined: pending.length,
            pendingHighRisk: rejectedPending.length,
        },
        activeIds: promoted,
        draft: drafted,
        validationOk: result.ok,
        validationErrors: result.errors,
        geographyAdded: NEW_DESTINATIONS.map((d) => d.id),
        sourceBackedRouteFixes: Object.keys(SOURCE_BACKED_PACKAGE_ROUTES),
    };
    writeFileSync(
        join(CATALOG_DIR, 'remediation-manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
    );

    console.log(JSON.stringify({
        ok: result.ok,
        active: manifest.counts.active,
        draft: manifest.counts.draft,
        pendingQuarantined: pending.length,
        geographyAdded: manifest.geographyAdded,
        errorCount: result.errors.length,
        sampleDrafts: drafted.slice(0, 8),
    }, null, 2));

    if (!result.ok) process.exitCode = 1;
}

main();

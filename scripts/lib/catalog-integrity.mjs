/**
 * Cross-file catalog integrity checks that JSON Schema cannot express.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '../..');

export const ALLOWED_BASES = new Set([
    'per-person',
    'per-person-sharing',
    'per-group',
    'per-vehicle',
    'flat',
    'per-night',
    'per-room',
]);

export const RELATIONSHIP_TYPES = new Set([
    'included',
    'optional-addon',
    'extension',
    'alternative',
    'tier-upgrade',
]);

export const ACTIVE_ACCOMMODATION_BASES = new Set(['per-night', 'per-room']);

/** International origin codes that must not appear as Ethiopia destination IDs. */
export const INTERNATIONAL_ORIGINS = new Set(['heathrow', 'lhr', 'fra', 'cdg', 'ams']);

export function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadCatalogBundle(catalogDir = join(ROOT, 'data/catalog/v1')) {
    const optionalJson = (file) => {
        const path = join(catalogDir, file);
        return existsSync(path) ? readJson(path) : null;
    };
    const schemaDir = join(ROOT, 'data/catalog/schema');
    const optionalSchema = (file) => {
        const path = join(schemaDir, file);
        return existsSync(path) ? readJson(path) : null;
    };
    return {
        catalog: readJson(join(catalogDir, 'catalog.json')),
        destinations: readJson(join(catalogDir, 'destinations.json')),
        flights: readJson(join(catalogDir, 'flights.json')),
        dayIdeas: optionalJson('day-ideas.json'),
        connections: optionalJson('connections.json'),
        schema: optionalSchema('catalog.schema.json'),
        dayIdeasSchema: optionalSchema('day-ideas.schema.json'),
        connectionsSchema: optionalSchema('connections.schema.json'),
        itinerarySchema: optionalSchema('itinerary.schema.json'),
    };
}

function destinationIataMap(destinationsDoc) {
    const map = new Map();
    for (const d of destinationsDoc.destinations || []) {
        if (d.iata) map.set(d.id, String(d.iata).toUpperCase());
    }
    return map;
}

function flightPairSet(flightsDoc) {
    const set = new Set();
    for (const r of flightsDoc.routes || []) {
        set.add(`${r.origin}->${r.destination}`);
    }
    return set;
}

/** Lightweight structural checks mirroring schema required fields / enums. */
export function validateProductShape(product, errors, { productionOnly = false } = {}) {
    const req = [
        'id', 'type', 'name', 'summary', 'destinations', 'themes', 'tier',
        'basePrice', 'inclusions', 'exclusions', 'images', 'seasonality',
        'compatibility', 'status', 'availabilityMode',
    ];
    for (const key of req) {
        if (product[key] === undefined || product[key] === null) {
            errors.push({ level: 'error', id: product.id || '?', code: 'MISSING_FIELD', message: `missing ${key}` });
        }
    }
    if (!['active', 'draft', 'rejected'].includes(product.status)) {
        errors.push({ level: 'error', id: product.id, code: 'BAD_STATUS', message: `invalid status ${product.status}` });
    }
    if (productionOnly && product.status !== 'active') return;

    if (product.basePrice) {
        if (typeof product.basePrice.amount !== 'number' || product.basePrice.amount < 0) {
            errors.push({ level: 'error', id: product.id, code: 'BAD_PRICE', message: 'invalid basePrice.amount' });
        }
        if (product.basePrice.currency !== 'GBP') {
            errors.push({ level: 'error', id: product.id, code: 'BAD_CURRENCY', message: 'currency must be GBP' });
        }
        if (product.basePrice.basis && !ALLOWED_BASES.has(product.basePrice.basis)) {
            errors.push({ level: 'error', id: product.id, code: 'BAD_BASIS', message: `invalid basis ${product.basePrice.basis}` });
        }
    }
    for (const rel of product.relationships || []) {
        if (!RELATIONSHIP_TYPES.has(rel.type)) {
            errors.push({ level: 'error', id: product.id, code: 'BAD_RELATIONSHIP_TYPE', message: rel.type });
        }
        if (!rel.productId) {
            errors.push({ level: 'error', id: product.id, code: 'BAD_RELATIONSHIP', message: 'missing productId' });
        }
    }
}

export function classifyActiveBlockers(product, ctx) {
    const blockers = [];
    const { destIds, productIds, flightPairs, iataByDest } = ctx;

    if (!product.status) blockers.push('STATUS_MISSING');
    if (!product.availabilityMode) blockers.push('AVAILABILITY_MODE_MISSING');

    for (const dest of product.destinations || []) {
        if (!destIds.has(dest)) blockers.push(`DEST_UNRESOLVED:${dest}`);
    }

    if (product.type === 'package') {
        const route = product.route || [];
        if (!route.length) blockers.push('ROUTE_MISSING');
        let nightSum = 0;
        for (const stop of route) {
            if (INTERNATIONAL_ORIGINS.has(String(stop.destinationId || '').toLowerCase())) {
                blockers.push(`ROUTE_INTERNATIONAL_ORIGIN:${stop.destinationId}`);
            }
            if (!destIds.has(stop.destinationId)) {
                blockers.push(`ROUTE_DEST_UNRESOLVED:${stop.destinationId}`);
            }
            if (stop.nights == null) blockers.push(`ROUTE_NIGHTS_MISSING:${stop.sequence}`);
            else nightSum += Number(stop.nights) || 0;
            if (stop.transportToNext === 'flight') {
                const from = iataByDest.get(stop.destinationId);
                const next = route.find((s) => s.sequence === stop.sequence + 1);
                const to = next ? iataByDest.get(next.destinationId) : null;
                if (from && to && !flightPairs.has(`${from}->${to}`)) {
                    // Flagged on product.unsupportedFlightLegs; not an automatic draft blocker
                    // unless the product claims a bookable flight without coverage metadata.
                    if (!(product.unsupportedFlightLegs || []).some(
                        (g) => g.fromIata === from && g.toIata === to,
                    )) {
                        blockers.push(`FLIGHT_COVERAGE_UNFLAGGED:${from}->${to}`);
                    }
                }
            }
        }
        const days = product.duration?.days;
        const durNights = product.duration?.nights;
        if (route.length && nightSum > 0 && durNights != null && nightSum !== durNights) {
            blockers.push(`ROUTE_NIGHTS_MISMATCH:route=${nightSum},duration=${durNights}`);
        }
        if (days != null && durNights != null && !(durNights === days - 1 || durNights === days)) {
            blockers.push(`DURATION_NIGHTS_ODD:days=${days},nights=${durNights}`);
        }
        if (!(product.basePrice?.amount > 0)) blockers.push('PRICE_UNKNOWN');
        if (!product.inclusions?.length) blockers.push('INCLUSIONS_MISSING');
        if (!product.exclusions?.length) blockers.push('EXCLUSIONS_MISSING');
        if (!product.sourceRefs?.length && product.confidence !== 'high') {
            // baseline synthetic may use confidence high without external refs
            if (product.confidence !== 'high') blockers.push('PROVENANCE_WEAK');
        }
        if ((product.inclusionCompleteness || 'unknown') === 'unknown' && product.status === 'active') {
            blockers.push('INCLUSION_COMPLETENESS_UNKNOWN');
        }
    }

    if (product.type === 'accommodation') {
        if (!(product.basePrice?.amount > 0)) blockers.push('PRICE_UNKNOWN');
        if (!ACTIVE_ACCOMMODATION_BASES.has(product.basePrice?.basis)) {
            blockers.push(`PRICE_BASIS_UNSUPPORTED:${product.basePrice?.basis || 'missing'}`);
        }
    }

    if (product.type !== 'destination' && product.type !== 'flight') {
        if (product.type === 'package' || product.type === 'accommodation' || product.type === 'experience' || product.type === 'transfer') {
            if (!(product.basePrice?.amount > 0) && product.type !== 'destination') {
                if (!blockers.includes('PRICE_UNKNOWN')) blockers.push('PRICE_UNKNOWN');
            }
        }
    }

    for (const rel of product.relationships || []) {
        if (!productIds.has(rel.productId)) {
            blockers.push(`RELATIONSHIP_UNRESOLVED:${rel.productId}`);
        }
    }
    for (const id of product.relatedIds || []) {
        if (!productIds.has(id)) blockers.push(`RELATED_UNRESOLVED:${id}`);
    }

    return blockers;
}

const PLAN_KEYS = ['1', '2', '3', '4', '5'];
const MODULE_INTENSITY = new Set(['easy', 'moderate', 'active']);
const MODULE_KIND = new Set(['full-day', 'half-day', 'arrival-light', 'leisure', 'transfer']);
const JOURNEY_MODES = new Set(['flight', 'road', 'boat', 'trek']);
const JOURNEY_LOAD = new Set(['short', 'half-day', 'full-day']);

export function validateDayPrograms(dayIdeas, { destIds, productIds }, errors, warnings) {
    if (!dayIdeas) {
        errors.push({ level: 'error', id: 'day-ideas', code: 'DAY_IDEAS_MISSING', message: 'day-ideas.json is required' });
        return { moduleIds: new Set() };
    }
    if (Array.isArray(dayIdeas) || (dayIdeas.destinations && Array.isArray(dayIdeas.destinations))) {
        errors.push({
            level: 'error',
            id: 'day-ideas',
            code: 'DAY_IDEAS_LEGACY_FORMAT',
            message: 'day-ideas.json must be a destination-keyed program document, not inline day arrays',
        });
        return { moduleIds: new Set() };
    }

    const programs = dayIdeas.destinations || {};
    const moduleIds = new Set();
    const moduleOwner = new Map();

    for (const destId of destIds) {
        if (!programs[destId]) {
            errors.push({
                level: 'error',
                id: destId,
                code: 'DAY_PROGRAM_MISSING',
                message: 'no modules/plans for catalog destination',
            });
        }
    }

    for (const [destId, program] of Object.entries(programs)) {
        if (!destIds.has(destId)) {
            errors.push({
                level: 'error',
                id: destId,
                code: 'DAY_PROGRAM_UNKNOWN_DEST',
                message: 'program is not in destinations.json',
            });
            continue;
        }
        const modules = Array.isArray(program.modules) ? program.modules : [];
        if (!modules.length) {
            errors.push({ level: 'error', id: destId, code: 'DAY_MODULES_EMPTY', message: 'destination has no modules' });
        }
        const localIds = new Set();
        for (const module of modules) {
            if (!module?.id) {
                errors.push({ level: 'error', id: destId, code: 'DAY_MODULE_ID_MISSING', message: module?.title || 'untitled' });
                continue;
            }
            if (moduleIds.has(module.id)) {
                errors.push({
                    level: 'error',
                    id: module.id,
                    code: 'DAY_MODULE_DUPLICATE_ID',
                    message: `already used by ${moduleOwner.get(module.id)}`,
                });
            }
            moduleIds.add(module.id);
            moduleOwner.set(module.id, destId);
            localIds.add(module.id);
            if (!module.title) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_EMPTY_TITLE', message: destId });
            }
            if (!module.summary) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_EMPTY_SUMMARY', message: destId });
            }
            if (!Array.isArray(module.highlights) || !module.highlights.length) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_HIGHLIGHTS', message: destId });
            }
            if (!module.image) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_IMAGE_MISSING', message: destId });
            }
            if (!module.imageAlt) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_IMAGE_ALT_MISSING', message: destId });
            }
            if (typeof module.expectedActivityHours !== 'number' || module.expectedActivityHours < 0) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_HOURS', message: String(module.expectedActivityHours) });
            }
            if (!MODULE_INTENSITY.has(module.intensity)) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_INTENSITY', message: String(module.intensity) });
            }
            if (module.kind && !MODULE_KIND.has(module.kind)) {
                errors.push({ level: 'error', id: module.id, code: 'DAY_MODULE_KIND', message: String(module.kind) });
            }
            for (const expId of module.experienceIds || []) {
                if (!productIds.has(expId)) {
                    errors.push({
                        level: 'error',
                        id: module.id,
                        code: 'DAY_MODULE_EXPERIENCE_UNRESOLVED',
                        message: expId,
                    });
                }
            }
        }

        const plans = program.plans || {};
        for (const key of PLAN_KEYS) {
            const plan = plans[key];
            const expected = Number(key);
            if (!Array.isArray(plan) || plan.length !== expected) {
                errors.push({
                    level: 'error',
                    id: destId,
                    code: 'DAY_PLAN_INCOMPLETE',
                    message: `plan ${key} must list exactly ${expected} module ids`,
                });
                continue;
            }
            for (const moduleId of plan) {
                if (!localIds.has(moduleId)) {
                    errors.push({
                        level: 'error',
                        id: destId,
                        code: 'DAY_PLAN_UNKNOWN_MODULE',
                        message: `${key}:${moduleId}`,
                    });
                }
            }
        }

        for (const field of ['arrivalModuleId', 'departureModuleId', 'leisureModuleId']) {
            const ref = program[field];
            if (ref && !localIds.has(ref)) {
                errors.push({
                    level: 'error',
                    id: destId,
                    code: 'DAY_PROGRAM_REF_UNKNOWN',
                    message: `${field}=${ref}`,
                });
            }
        }
        if (!program.leisureModuleId) {
            warnings.push({
                level: 'warning',
                id: destId,
                code: 'DAY_LEISURE_MISSING',
                message: 'overflow policy expects a leisure module',
            });
        }
    }

    return { moduleIds };
}

export function validateConnectionsDoc(connectionsDoc, { destIds, flightIds }, errors, warnings) {
    if (!connectionsDoc) {
        errors.push({ level: 'error', id: 'connections', code: 'CONNECTIONS_MISSING', message: 'connections.json is required' });
        return { pairSet: new Set(), modePairSet: new Set() };
    }
    const list = connectionsDoc.connections || [];
    if (!list.length) {
        errors.push({ level: 'error', id: 'connections', code: 'CONNECTIONS_EMPTY', message: 'no journey connections' });
    }
    if (connectionsDoc.defaultGatewayId && !destIds.has(connectionsDoc.defaultGatewayId)) {
        errors.push({
            level: 'error',
            id: 'connections',
            code: 'GATEWAY_UNKNOWN',
            message: connectionsDoc.defaultGatewayId,
        });
    }

    const ids = new Set();
    const pairSet = new Set();
    const modePairSet = new Set();
    for (const row of list) {
        if (!row?.id) {
            errors.push({ level: 'error', id: 'connections', code: 'CONNECTION_ID_MISSING', message: `${row?.from}->${row?.to}` });
            continue;
        }
        if (ids.has(row.id)) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_DUPLICATE_ID', message: row.id });
        }
        ids.add(row.id);
        if (!destIds.has(row.from)) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_FROM_UNKNOWN', message: row.from });
        }
        if (!destIds.has(row.to)) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_TO_UNKNOWN', message: row.to });
        }
        if (row.from === row.to) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_SELF', message: row.from });
        }
        if (!JOURNEY_MODES.has(row.mode)) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_MODE', message: String(row.mode) });
        }
        if (!JOURNEY_LOAD.has(row.load)) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_LOAD', message: String(row.load) });
        }
        if (typeof row.hours !== 'number' || row.hours <= 0) {
            errors.push({ level: 'error', id: row.id, code: 'CONNECTION_HOURS', message: String(row.hours) });
        }
        if (row.flightRouteId && !flightIds.has(row.flightRouteId)) {
            errors.push({
                level: 'error',
                id: row.id,
                code: 'CONNECTION_FLIGHT_UNRESOLVED',
                message: row.flightRouteId,
            });
        }
        if (row.mode === 'flight' && !row.flightRouteId && !(row.via || []).length) {
            warnings.push({
                level: 'warning',
                id: row.id,
                code: 'CONNECTION_FLIGHT_UNMAPPED',
                message: `${row.from}->${row.to}`,
            });
        }
        for (const viaId of row.via || []) {
            if (!destIds.has(viaId)) {
                errors.push({ level: 'error', id: row.id, code: 'CONNECTION_VIA_UNKNOWN', message: viaId });
            }
        }
        pairSet.add(`${row.from}|${row.to}`);
        modePairSet.add(`${row.from}|${row.to}|${row.mode}`);
    }

    for (const row of list) {
        if (row.reciprocalId && !ids.has(row.reciprocalId)) {
            errors.push({
                level: 'error',
                id: row.id,
                code: 'CONNECTION_RECIPROCAL_UNRESOLVED',
                message: row.reciprocalId,
            });
        }
    }

    return { pairSet, modePairSet, ids };
}

export function validatePackageDayTemplates(catalog, { destIds, moduleIds, pairSet, modePairSet }, errors, drafts) {
    for (const product of catalog.products || []) {
        if (product.type !== 'package') continue;
        const isDraft = product.status !== 'active';
        const bucket = isDraft ? drafts : errors;

        for (const template of product.dayTemplates || []) {
            if (template.title || template.summary) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'DAY_TEMPLATE_INLINE_PROSE',
                    message: `day ${template.day} still has title/summary; use moduleId`,
                });
            }
            if (!template.moduleId) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'DAY_TEMPLATE_MODULE_MISSING',
                    message: `day ${template.day}`,
                });
            } else if (!moduleIds.has(template.moduleId)) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'DAY_TEMPLATE_MODULE_UNRESOLVED',
                    message: template.moduleId,
                });
            }
            if (template.destinationId && !destIds.has(template.destinationId)) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'DAY_TEMPLATE_DEST_UNRESOLVED',
                    message: template.destinationId,
                });
            }
        }

        const route = product.route || [];
        for (let i = 0; i < route.length - 1; i += 1) {
            const from = route[i].destinationId;
            const to = route[i + 1].destinationId;
            const mode = route[i].transportToNext;
            if (!from || !to) continue;
            if (!pairSet.has(`${from}|${to}`)) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'PACKAGE_CONNECTION_MISSING',
                    message: `${from}->${to}`,
                });
            } else if (mode && !modePairSet.has(`${from}|${to}|${mode}`)) {
                bucket.push({
                    level: isDraft ? 'draft' : 'error',
                    id: product.id,
                    code: 'PACKAGE_CONNECTION_MODE_MISSING',
                    message: `${from}->${to} (${mode})`,
                });
            }
        }
    }
}

export function validateDestinationGeo(destinations, errors) {
    for (const dest of destinations.destinations || []) {
        if (typeof dest.lat !== 'number' || dest.lat < -90 || dest.lat > 90) {
            errors.push({ level: 'error', id: dest.id, code: 'DEST_LAT_MISSING', message: String(dest.lat) });
        }
        if (typeof dest.lng !== 'number' || dest.lng < -180 || dest.lng > 180) {
            errors.push({ level: 'error', id: dest.id, code: 'DEST_LNG_MISSING', message: String(dest.lng) });
        }
        if (!dest.stayGuidance || typeof dest.stayGuidance.minDays !== 'number') {
            errors.push({ level: 'error', id: dest.id, code: 'DEST_STAY_GUIDANCE_MISSING', message: 'minDays required' });
        }
    }
}

export function validateCatalogIntegrity({ catalog, destinations, flights, dayIdeas, connections }, opts = {}) {
    const errors = [];
    const drafts = [];
    const warnings = [];

    const destIds = new Set((destinations.destinations || []).map((d) => d.id));
    const productIds = new Set((catalog.products || []).map((p) => p.id));
    const iataByDest = destinationIataMap(destinations);
    const flightPairs = flightPairSet(flights);
    const ctx = { destIds, productIds, flightPairs, iataByDest };

    const idCounts = new Map();
    for (const p of catalog.products || []) {
        idCounts.set(p.id, (idCounts.get(p.id) || 0) + 1);
    }
    for (const [id, count] of idCounts) {
        if (count > 1) {
            errors.push({ level: 'error', id, code: 'DUPLICATE_ID', message: `duplicate product id (${count})` });
        }
    }

    for (const p of catalog.products || []) {
        validateProductShape(p, errors);

        for (const dest of p.destinations || []) {
            if (!destIds.has(dest)) {
                const entry = {
                    level: p.status === 'active' ? 'error' : 'draft',
                    id: p.id,
                    code: 'DEST_UNRESOLVED',
                    message: dest,
                };
                (p.status === 'active' ? errors : drafts).push(entry);
            }
        }

        if (p.route) {
            for (const stop of p.route) {
                if (INTERNATIONAL_ORIGINS.has(String(stop.destinationId || '').toLowerCase())) {
                    const entry = {
                        level: p.status === 'active' ? 'error' : 'draft',
                        id: p.id,
                        code: 'ROUTE_INTERNATIONAL_ORIGIN',
                        message: stop.destinationId,
                    };
                    (p.status === 'active' ? errors : drafts).push(entry);
                } else if (!destIds.has(stop.destinationId)) {
                    const entry = {
                        level: p.status === 'active' ? 'error' : 'draft',
                        id: p.id,
                        code: 'ROUTE_DEST_UNRESOLVED',
                        message: stop.destinationId,
                    };
                    (p.status === 'active' ? errors : drafts).push(entry);
                }
            }
        }

        for (const rel of p.relationships || []) {
            const target = catalog.products.find((x) => x.id === rel.productId);
            if (!target) {
                const entry = {
                    level: p.status === 'active' ? 'error' : 'draft',
                    id: p.id,
                    code: 'RELATIONSHIP_UNRESOLVED',
                    message: rel.productId,
                };
                (p.status === 'active' ? errors : drafts).push(entry);
            } else if (p.status === 'active' && target.status !== 'active') {
                errors.push({
                    level: 'error',
                    id: p.id,
                    code: 'RELATIONSHIP_TO_NON_ACTIVE',
                    message: `${rel.productId} is ${target.status}`,
                });
            }
        }

        if (p.status === 'active') {
            const blockers = classifyActiveBlockers(p, ctx);
            for (const code of blockers) {
                errors.push({ level: 'error', id: p.id, code, message: 'active-gate failed' });
            }
            if (p.type === 'accommodation' && !ACTIVE_ACCOMMODATION_BASES.has(p.basePrice?.basis)) {
                errors.push({
                    level: 'error',
                    id: p.id,
                    code: 'ACTIVE_ACCOM_BASIS',
                    message: p.basePrice?.basis,
                });
            }
        } else if (p.status === 'draft') {
            drafts.push({
                level: 'draft',
                id: p.id,
                code: 'DRAFT',
                message: (p.blockers || []).join(',') || 'draft',
            });
        }
    }

    // Destination registry ↔ destination products
    for (const d of destinations.destinations || []) {
        const productId = `dest-${d.id}`;
        if (!productIds.has(productId) && opts.requireDestinationProducts) {
            warnings.push({
                level: 'warning',
                id: d.id,
                code: 'DEST_PRODUCT_MISSING',
                message: productId,
            });
        }
    }

    validateDestinationGeo(destinations, errors);

    const flightIds = new Set((flights.routes || []).map((r) => r.id));
    const { moduleIds } = validateDayPrograms(dayIdeas, { destIds, productIds }, errors, warnings);
    const { pairSet, modePairSet } = validateConnectionsDoc(
        connections,
        { destIds, flightIds },
        errors,
        warnings,
    );
    validatePackageDayTemplates(catalog, { destIds, moduleIds, pairSet, modePairSet }, errors, drafts);

    const active = (catalog.products || []).filter((p) => p.status === 'active');
    const draftProducts = (catalog.products || []).filter((p) => p.status === 'draft');
    const rejected = (catalog.products || []).filter((p) => p.status === 'rejected');

    return {
        ok: errors.length === 0,
        errors,
        drafts,
        warnings,
        counts: {
            products: (catalog.products || []).length,
            active: active.length,
            draft: draftProducts.length,
            rejected: rejected.length,
            destinations: (destinations.destinations || []).length,
            flightRoutes: (flights.routes || []).length,
            dayModules: moduleIds.size,
            connections: (connections?.connections || []).length,
        },
    };
}

export function formatReport(result) {
    const lines = [];
    lines.push(`ok=${result.ok} active=${result.counts.active} draft=${result.counts.draft} rejected=${result.counts.rejected} modules=${result.counts.dayModules ?? 0} connections=${result.counts.connections ?? 0}`);
    if (result.errors.length) {
        lines.push('ACTIVE/PRODUCTION ERRORS:');
        for (const e of result.errors.slice(0, 100)) {
            lines.push(`  [${e.code}] ${e.id}: ${e.message}`);
        }
        if (result.errors.length > 100) lines.push(`  … ${result.errors.length - 100} more`);
    }
    if (result.drafts.length) {
        lines.push(`DRAFT RECORDS: ${result.drafts.length}`);
        const sample = result.drafts.slice(0, 30);
        for (const d of sample) lines.push(`  ${d.id}: ${d.message}`);
        if (result.drafts.length > 30) lines.push(`  … ${result.drafts.length - 30} more`);
    }
    if (result.warnings?.length) {
        lines.push(`WARNINGS: ${result.warnings.length}`);
        for (const w of result.warnings.slice(0, 20)) {
            lines.push(`  [${w.code}] ${w.id}: ${w.message}`);
        }
        if (result.warnings.length > 20) lines.push(`  … ${result.warnings.length - 20} more`);
    }
    return lines.join('\n');
}

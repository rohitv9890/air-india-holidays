#!/usr/bin/env node
/**
 * Controlled promotion stage: merge Hermes remediation staging bundle into
 * data/catalog/v1 without inventing prices or overwriting existing IDs.
 *
 * New commercial products are imported as status=draft. Run
 * scripts/remediate-catalog-inventory.mjs afterwards to classify active gates,
 * then scripts/validate-catalog.mjs before Lambda sync.
 *
 * Usage:
 *   node scripts/merge-hermes-import-bundle.mjs
 *   node scripts/merge-hermes-import-bundle.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUNDLE_DIR = join(ROOT, 'research/hermes-ethiopia-remediation-2026-08-09');
const CATALOG_PATH = join(ROOT, 'data/catalog/v1/catalog.json');
const DEST_PATH = join(ROOT, 'data/catalog/v1/destinations.json');
const HOTELS_PATH = join(ROOT, 'research/hermes-ethiopia-hotels-2026-08-08/hotels.jsonl');
const PENDING_PATH = join(BUNDLE_DIR, 'catalog-products-pending.jsonl');
const MANIFEST_PATH = join(ROOT, 'data/catalog/v1/merge-manifest.json');

const DRY_RUN = process.argv.includes('--dry-run');

/** Mid-market FX → GBP, aligned with Lambda pricing EUR_PER_GBP = 1.17 */
const FX_TO_GBP = {
    GBP: 1,
    EUR: 1 / 1.17,
    USD: 0.78,
    ETB: 0.0054,
};
const FX_DATE = '2026-08-09';

const ALLOWED_BASES = new Set([
    'per-person',
    'per-person-sharing',
    'per-group',
    'per-vehicle',
    'flat',
    'per-night',
    'per-room',
]);

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line, i) => {
            try {
                return JSON.parse(line);
            } catch {
                throw new Error(`Invalid JSONL ${path}:${i + 1}`);
            }
        });
}

function roundMoney(n) {
    return Math.round(n * 100) / 100;
}

function toGbp(amount, currency) {
    const cur = String(currency || 'GBP').toUpperCase();
    const rate = FX_TO_GBP[cur];
    if (rate == null) throw new Error(`Unsupported currency for FX: ${currency}`);
    return { amountGbp: roundMoney(Number(amount) * rate), rate };
}

function normalizeBasis(basis) {
    if (!basis) return 'per-person';
    const b = String(basis).toLowerCase().trim();
    if (b === 'per night' || b === 'per-night') return 'per-night';
    if (b === 'per room' || b === 'per-room') return 'per-room';
    if (b === 'per room per night' || b === 'per-room-per-night' || b === 'per room / night') {
        return 'per-night';
    }
    if (ALLOWED_BASES.has(b)) return b;
    if (b.includes('person')) return 'per-person';
    if (b.includes('vehicle')) return 'per-vehicle';
    if (b.includes('group')) return 'per-group';
    if (b.includes('night')) return 'per-night';
    if (b.includes('room')) return 'per-room';
    return null;
}

function convertProductPrice(product) {
    const src = product.basePrice;
    if (!src || typeof src.amount !== 'number') {
        throw new Error(`Missing basePrice on ${product.id}`);
    }
    const basis = normalizeBasis(src.basis) || 'per-person';
    if (!ALLOWED_BASES.has(basis)) {
        throw new Error(`Unsupported basis "${src.basis}" on ${product.id}`);
    }
    const { amountGbp, rate } = toGbp(src.amount, src.currency);
    if (product.type !== 'destination' && !(amountGbp > 0)) {
        throw new Error(`Non-positive GBP price for ${product.id}`);
    }
    return {
        ...product,
        basePrice: {
            amount: amountGbp,
            currency: 'GBP',
            basis,
        },
        priceProvenance: {
            sourceAmount: src.amount,
            sourceCurrency: String(src.currency || 'GBP').toUpperCase(),
            sourceBasis: basis,
            fxRateToGbp: rate,
            fxDate: FX_DATE,
            convertedAmount: amountGbp,
            convertedCurrency: 'GBP',
        },
        status: product.status || 'draft',
        availabilityMode: product.availabilityMode || 'indicative',
        confidence: product.confidence || 'low',
        sourceRefs: product.sourceRefs || [`hermes-remediation:${product.id}`],
        blockers: product.blockers || ['AWAITING_ACTIVE_GATES'],
    };
}

function stripEmptySeasonalityMonths(product) {
    const seasonality = { ...(product.seasonality || {}) };
    if (Array.isArray(seasonality.availableMonths) && seasonality.availableMonths.length === 0) {
        delete seasonality.availableMonths;
    }
    return { ...product, seasonality };
}

function hotelProductFromPending(pending, hotelsById) {
    const onlyBasis =
        pending.blockers?.length === 1 && pending.blockers[0].code === 'PRICE_BASIS_UNSUPPORTED';
    if (!onlyBasis) return null;

    const hotel = hotelsById.get(pending.canonicalId);
    const rate = hotel?.booking?.rateObserved;
    if (!(typeof rate?.amount === 'number' && rate.amount > 0 && rate.currency)) return null;

    const basis = normalizeBasis(rate.basis);
    if (!basis || (basis !== 'per-night' && basis !== 'per-room')) return null;

    const { amountGbp, rate: fx } = toGbp(rate.amount, rate.currency);
    if (!(amountGbp > 0)) return null;

    const mapped = pending.mappedFields;
    const product = {
        ...mapped,
        basePrice: {
            amount: amountGbp,
            currency: 'GBP',
            basis,
        },
        priceProvenance: {
            sourceAmount: rate.amount,
            sourceCurrency: String(rate.currency).toUpperCase(),
            sourceBasis: basis,
            fxRateToGbp: fx,
            fxDate: rate.observedAt || FX_DATE,
            convertedAmount: amountGbp,
            convertedCurrency: 'GBP',
            notes: `Observed rate from ${pending.canonicalId}`,
        },
        seasonality: mapped.seasonality || {},
        status: 'draft',
        availabilityMode: 'indicative',
        confidence: 'medium',
        sourceRefs: [`hermes:${pending.canonicalId}`],
        blockers: ['AWAITING_ACTIVE_GATES'],
    };

    if (typeof hotel?.property?.starRating === 'number') {
        product.stars = hotel.property.starRating;
    } else if (typeof hotel?.stars === 'number') {
        product.stars = hotel.stars;
    }

    return stripEmptySeasonalityMonths(product);
}

function validateProduct(product, errors) {
    const req = [
        'id', 'type', 'name', 'summary', 'destinations', 'themes', 'tier',
        'basePrice', 'inclusions', 'exclusions', 'images', 'seasonality', 'compatibility',
    ];
    for (const key of req) {
        if (product[key] === undefined || product[key] === null) {
            errors.push(`${product.id || '?'}: missing ${key}`);
        }
    }
    if (product.basePrice) {
        if (typeof product.basePrice.amount !== 'number' || product.basePrice.amount < 0) {
            errors.push(`${product.id}: invalid basePrice.amount`);
        }
        if (product.basePrice.currency !== 'GBP') {
            errors.push(`${product.id}: currency must be GBP after merge`);
        }
        if (product.basePrice.basis && !ALLOWED_BASES.has(product.basePrice.basis)) {
            errors.push(`${product.id}: invalid basis ${product.basePrice.basis}`);
        }
        if (product.type !== 'destination' && !(product.basePrice.amount > 0)) {
            errors.push(`${product.id}: commercial products need amount > 0`);
        }
    }
    if (product.images?.some((img) => !img.url || !img.alt)) {
        errors.push(`${product.id}: images need url+alt`);
    }
}

function main() {
    for (const p of [BUNDLE_DIR, CATALOG_PATH, DEST_PATH, HOTELS_PATH, PENDING_PATH]) {
        if (!existsSync(p)) {
            console.error('Missing required path:', p);
            process.exit(1);
        }
    }

    const catalog = readJson(CATALOG_PATH);
    const destinationsDoc = readJson(DEST_PATH);
    const bundle = readJson(join(BUNDLE_DIR, 'catalog-import-bundle.json'));
    const destAdditions = readJson(join(BUNDLE_DIR, 'destination-additions.json'));
    const destIndexAdditions = readJson(join(BUNDLE_DIR, 'destination-index-additions.json'));
    const pending = readJsonl(PENDING_PATH);
    const hotelsById = new Map(readJsonl(HOTELS_PATH).map((h) => [h.id, h]));

    const existingIds = new Set(catalog.products.map((p) => p.id));
    const existingDestIds = new Set(destinationsDoc.destinations.map((d) => d.id));

    const toAdd = [];
    const skipped = [];
    const drafted = [];
    const rejected = [];

    for (const raw of bundle.products || []) {
        if (existingIds.has(raw.id)) {
            skipped.push({ id: raw.id, reason: 'duplicate-catalog-id' });
            continue;
        }
        const product = stripEmptySeasonalityMonths(convertProductPrice(raw));
        toAdd.push(product);
        drafted.push(product.id);
    }

    for (const raw of destAdditions.products || []) {
        if (existingIds.has(raw.id)) {
            skipped.push({ id: raw.id, reason: 'duplicate-catalog-id' });
            continue;
        }
        toAdd.push(stripEmptySeasonalityMonths({
            ...raw,
            status: raw.status || 'active',
            availabilityMode: raw.availabilityMode || 'indicative',
            confidence: raw.confidence || 'medium',
            sourceRefs: raw.sourceRefs || ['hermes-destination-addition'],
        }));
    }

    let hotelsPromoted = 0;
    for (const row of pending) {
        const hardReject = (row.blockers || []).some((b) =>
            ['SAFETY_REVIEW_REQUIRED', 'DUPLICATE_UNRESOLVED'].includes(b.code),
        );
        if (hardReject) {
            rejected.push({
                id: row.mappedFields?.id || row.canonicalId,
                reasons: (row.blockers || []).map((b) => b.code),
            });
            continue;
        }
        const product = hotelProductFromPending(row, hotelsById);
        if (!product) continue;
        if (existingIds.has(product.id) || toAdd.some((p) => p.id === product.id)) {
            skipped.push({ id: product.id, reason: 'duplicate-catalog-id' });
            continue;
        }
        toAdd.push(product);
        drafted.push(product.id);
        hotelsPromoted += 1;
    }

    const errors = [];
    for (const p of toAdd) validateProduct(p, errors);
    if (errors.length) {
        console.error('Validation failed:\n' + errors.join('\n'));
        process.exit(1);
    }

    const destIndexToAdd = [];
    for (const d of destIndexAdditions.destinations || []) {
        if (existingDestIds.has(d.id)) {
            skipped.push({ id: d.id, reason: 'duplicate-destination-index-id' });
            continue;
        }
        destIndexToAdd.push(d);
    }

    const manifest = {
        generatedAt: new Date().toISOString(),
        dryRun: DRY_RUN,
        added: toAdd.map((p) => ({ id: p.id, type: p.type, status: p.status })),
        drafted,
        rejected,
        skipped,
        hotelsPromoted,
        destinationIndexAdded: destIndexToAdd.map((d) => d.id),
        nextSteps: [
            'node scripts/remediate-catalog-inventory.mjs',
            'node scripts/validate-catalog.mjs',
            'node scripts/sync-catalog-to-lambda.mjs',
        ],
    };

    if (DRY_RUN) {
        console.log(JSON.stringify({ ok: true, ...manifest, catalogProductsWouldBe: catalog.products.length + toAdd.length }, null, 2));
        writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
        return;
    }

    catalog.products = [...catalog.products, ...toAdd];
    catalog.generatedAt = new Date().toISOString();
    catalog.notes =
        'Guzo catalog: synthetic baseline plus Hermes remediation import. ' +
        'New Hermes commercial products enter as draft until remediate-catalog-inventory.mjs promotes them. ' +
        `FX: EUR÷1.17, USD×0.78, ETB×0.0054 (${FX_DATE}).`;

    destinationsDoc.destinations = [...destinationsDoc.destinations, ...destIndexToAdd];

    writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
    writeFileSync(DEST_PATH, JSON.stringify(destinationsDoc, null, 2) + '\n');
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

    console.log(JSON.stringify({
        ok: true,
        dryRun: false,
        catalogProducts: catalog.products.length,
        added: toAdd.length,
        drafted: drafted.length,
        rejected: rejected.length,
        skipped: skipped.length,
        hotelsPromoted,
        destinationIndexAdded: destIndexToAdd.length,
    }, null, 2));
}

main();

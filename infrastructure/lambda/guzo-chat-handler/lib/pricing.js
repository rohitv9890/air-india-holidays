import { getById, isSellableProduct } from './catalog.js';
import {
    amountInCurrency,
    DEFAULT_DISPLAY_CURRENCY,
    displayCurrencyForOrigin,
    displayQuoteFromGbp,
    EUR_PER_GBP,
    formatDisplayPrice,
    gbpToEur,
    gbpToMyr,
    gbpToZar,
    MYR_PER_GBP,
    normalizeDisplayCurrency,
    ORIGIN_DISPLAY_CURRENCY,
    ZAR_PER_GBP,
} from './display-currency.js';

export {
    amountInCurrency,
    DEFAULT_DISPLAY_CURRENCY,
    displayCurrencyForOrigin,
    displayQuoteFromGbp,
    EUR_PER_GBP,
    formatDisplayPrice,
    gbpToEur,
    gbpToMyr,
    gbpToZar,
    MYR_PER_GBP,
    normalizeDisplayCurrency,
    ORIGIN_DISPLAY_CURRENCY,
    ZAR_PER_GBP,
};

const ACCOMMODATION_BASES = new Set(['per-night', 'per-room']);

export const TIER_MULTIPLIERS = {
    classic: 1,
    comfort: 1.15,
    signature: 1.35,
};

export const CHILD_FACTOR = 0.7;

export function seasonalMultiplier(dateStr) {
    const month = Number(String(dateStr).slice(5, 7));
    if (month === 12 || month === 1) return 1.15;
    if (month >= 6 && month <= 9) return 0.9;
    return 1;
}

export function roundMoney(n) {
    return Math.round(n * 100) / 100;
}

function nightCount(startDate, nights) {
    if (Number.isFinite(nights) && nights > 0) return Math.floor(nights);
    return 1;
}

function roomCount(adults = 2, rooms) {
    if (Number.isFinite(rooms) && rooms > 0) return Math.floor(rooms);
    return Math.max(1, Math.ceil(Math.max(adults, 1) / 2));
}

/**
 * Deterministic quote from catalog base + season + party + cabin + tier.
 * @param {object} opts
 * @param {string} opts.productId
 * @param {string} opts.startDate YYYY-MM-DD
 * @param {number} [opts.adults=2]
 * @param {number} [opts.children=0]
 * @param {string} [opts.cabin='Economy']
 * @param {string} [opts.tier] overrides product tier
 * @param {number} [opts.cabinMultiplier=1]
 * @param {number} [opts.flightGbp=0] optional flight component already cabin-adjusted
 * @param {number} [opts.nights] stay length for per-night / per-room bases
 * @param {number} [opts.rooms] room count for per-room / accommodation quotes
 */
export function quotePrice(opts) {
    const {
        productId,
        startDate,
        adults = 2,
        children = 0,
        cabin = 'Economy',
        tier: tierOverride,
        cabinMultiplier = 1,
        flightGbp = 0,
        nights: nightsIn,
        rooms: roomsIn,
    } = opts;

    const product = getById(productId, { includeNonActive: true });
    if (!product) {
        throw new Error(`Unknown product: ${productId}`);
    }
    if (!isSellableProduct(product)) {
        throw new Error(`Product not sellable (status=${product.status || 'unknown'}): ${productId}`);
    }
    if (product.type !== 'destination' && !(Number(product.basePrice?.amount) > 0)) {
        throw new Error(`Unknown or zero price for product: ${productId}`);
    }
    if (product.type === 'accommodation' && !ACCOMMODATION_BASES.has(product.basePrice?.basis)) {
        throw new Error(`Inappropriate accommodation price basis for ${productId}: ${product.basePrice?.basis}`);
    }

    const tier = tierOverride || product.tier || 'classic';
    const base = Number(product.basePrice?.amount || 0);
    const basis = product.basePrice?.basis || 'per-person';
    const season = seasonalMultiplier(startDate);
    const tierMul = TIER_MULTIPLIERS[tier] ?? 1;
    const unit = base * season * tierMul * cabinMultiplier;

    const nights = nightCount(startDate, nightsIn ?? product.duration?.nights);
    const rooms = roomCount(adults, roomsIn);

    let landGbp;
    if (basis === 'per-night') {
        // Observed room-night rates: charge rooms × nights (not per guest).
        landGbp = roundMoney(unit * nights * rooms);
    } else if (basis === 'per-room') {
        landGbp = roundMoney(unit * rooms);
    } else if (basis === 'flat' || basis === 'per-group' || basis === 'per-vehicle') {
        landGbp = roundMoney(unit);
    } else {
        // per-person / per-person-sharing
        const perAdult = unit;
        const perChild = perAdult * CHILD_FACTOR;
        landGbp = roundMoney(perAdult * adults + perChild * children);
    }

    const flights = roundMoney(Number(flightGbp) || 0);
    const gbp = Math.round(landGbp + flights);
    const eur = gbpToEur(gbp);
    const myr = gbpToMyr(gbp);
    const zar = gbpToZar(gbp);
    const partyUnits = Math.max(adults + children * CHILD_FACTOR, 1);
    const perPersonGbp = basis.startsWith('per-person')
        ? roundMoney(gbp / partyUnits)
        : null;

    return {
        gbp,
        eur,
        myr,
        zar,
        perPersonGbp,
        perPersonEur: perPersonGbp == null ? null : gbpToEur(perPersonGbp),
        perPersonMyr: perPersonGbp == null ? null : gbpToMyr(perPersonGbp),
        perPersonZar: perPersonGbp == null ? null : gbpToZar(perPersonGbp),
        currency: 'GBP',
        breakdown: {
            productId,
            basis,
            basePerPersonGbp: basis.startsWith('per-person') ? base : undefined,
            baseUnitGbp: base,
            seasonalMultiplier: season,
            tier,
            tierMultiplier: tierMul,
            cabin,
            cabinMultiplier,
            adults,
            children,
            partyUnits,
            nights,
            rooms,
            childFactor: CHILD_FACTOR,
            landGbp,
            flightGbp: flights,
            totalGbp: gbp,
            totalEur: eur,
            totalZar: zar,
            fx: { EUR_PER_GBP, ZAR_PER_GBP },
        },
    };
}

/**
 * Multi-product quote helper for chat tools.
 * Aggregates quotePrice() for each productId.
 */
export function quoteItinerary({
    productIds = [],
    packageId,
    addOnProductIds = [],
    startDate,
    adults = 2,
    children = 0,
    cabin = 'Economy',
    tier = 'classic',
    currency = 'GBP',
    nights,
    rooms,
} = {}) {
    const composite = Boolean(packageId);
    const ids = composite
        ? [packageId, ...(addOnProductIds || [])]
        : (productIds?.length ? productIds : []);
    if (!ids.length) {
        throw new Error('productIds required');
    }

    const lines = [];
    let gbp = 0;
    const uniqueIds = [...new Set(ids)];
    const pkg = composite ? getById(packageId, { includeNonActive: true }) : null;
    if (composite) {
        if (!pkg) throw new Error(`Unknown package: ${packageId}`);
        if (!isSellableProduct(pkg) || pkg.type !== 'package') {
            throw new Error(`Package not sellable: ${packageId}`);
        }
    }
    const relationships = new Map((pkg?.relationships || []).map((rel) => [rel.productId, rel]));

    for (const productId of uniqueIds) {
        const product = getById(productId, { includeNonActive: true });
        if (!product) throw new Error(`Unknown product: ${productId}`);
        if (!isSellableProduct(product)) {
            throw new Error(`Product not sellable (status=${product.status || 'unknown'}): ${productId}`);
        }

        const relationship = composite && productId !== packageId
            ? relationships.get(productId)
            : null;
        if (composite && productId !== packageId && !relationship) {
            throw new Error(`Product is not compatible with package ${packageId}: ${productId}`);
        }
        if (relationship?.type === 'alternative') {
            throw new Error(`Alternative products cannot be added to a package quote: ${productId}`);
        }
        if (relationship?.type === 'included') {
            lines.push({
                productId,
                name: product.name,
                relationshipType: relationship.type,
                status: 'included',
                amount: 0,
                currency: normalizeDisplayCurrency(currency),
                gbp: 0,
                eur: 0,
                myr: 0,
                zar: 0,
            });
            continue;
        }

        if (relationship?.type === 'tier-upgrade') {
            lines.push({
                productId,
                name: product.name,
                relationshipType: relationship.type,
                status: 'unavailable',
                amount: null,
                currency: normalizeDisplayCurrency(currency),
                priceDelta: null,
                reason: 'A verified upgrade price difference is unavailable',
            });
            continue;
        }

        const q = quotePrice({
            productId,
            startDate,
            adults,
            children,
            cabin,
            tier,
            nights,
            rooms,
        });
        gbp = roundMoney(gbp + q.gbp);
        lines.push({
            productId,
            name: product.name,
            relationshipType: relationship?.type || (productId === packageId ? 'package' : null),
            status: 'priced',
            ...q.breakdown,
            gbp: q.gbp,
            eur: q.eur,
            myr: q.myr,
            zar: q.zar,
        });
    }

    const display = displayQuoteFromGbp(gbp, currency);
    return {
        startDate: startDate || null,
        adults,
        children,
        cabin,
        tier,
        ...display,
        gbp: display.totals.GBP,
        eur: display.totals.EUR,
        myr: display.totals.MYR,
        zar: display.totals.ZAR,
        breakdown: lines,
        lineItems: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            relationshipType: line.relationshipType,
            status: line.status,
            amount: line.status === 'priced'
                ? amountInCurrency(line.gbp, display.currency)
                : line.amount,
            currency: display.currency,
            priceDelta: line.priceDelta == null
                ? line.priceDelta
                : amountInCurrency(line.priceDelta, display.currency),
            reason: line.reason,
        })),
        packageId: packageId || null,
        addOnProductIds: composite
            ? uniqueIds.filter((id) => id !== packageId && relationships.get(id)?.type !== 'included')
            : [],
        deterministic: true,
    };
}

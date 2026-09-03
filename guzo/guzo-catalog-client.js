import { loadDayIdeas, selectDayIdea } from './day-content.js';

/**
 * Fetch Guzo catalog for mock recommendations.
 * Tries /data/catalog/v1/catalog.json, falls back to inline fixture.
 */

import {
    amountInCurrency,
    displayCurrencyForOrigin,
    formatDisplayPrice,
} from './display-currency.js';
import { composeItineraryTitle, displayProductTitle } from './display-title.js';
import { withInternationalFlightsIncluded } from './itinerary-inclusions.js';

export { displayCurrencyForOrigin, displayCurrencyForOrigin as preferredCurrencyForOrigin };

const INLINE_CATALOG = {
    schemaVersion: '1.0.0',
    version: 'v1',
    currency: 'USD',
    notes: 'Inline fallback when catalog.json is unavailable',
    products: [
        {
            id: 'pkg-golden-triangle-6d',
            type: 'package',
            name: 'Golden Triangle: Jaipur, Agra & Udaipur',
            summary: "Jaipur's forts, the Taj Mahal at sunrise, and Udaipur's lake palaces across six guided days.",
            destinations: ['jaipur', 'agra', 'udaipur'],
            themes: ['golden-triangle', 'unesco', 'family', 'heritage'],
            duration: { days: 6, nights: 5 },
            tier: 'classic',
            basePrice: { amount: 1895, currency: 'USD', basis: 'per-person' },
            images: [{
                url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Taj%20Mahal%20(Edited).jpeg?width=1280',
                alt: 'Taj Mahal at sunrise, Agra',
            }],
            easygds: {
                packageId: 'ddd85aba-76ad-47f0-abd4-a36d7767b624',
                placeId: '244102',
            },
            inclusions: [
                'International flights',
                '5 nights accommodation & listed meals',
                'Domestic transfers & private car',
                'Expert guides & monument entry fees',
            ],
            exclusions: ['Travel insurance, visa & airport taxes'],
        },
        {
            id: 'pkg-taj-mahal-weekend-4d',
            type: 'package',
            name: 'Taj Mahal Weekend',
            summary: 'A focused four-day escape to the Taj Mahal with Delhi gateway nights.',
            destinations: ['delhi', 'agra'],
            themes: ['taj-mahal', 'unesco', 'weekend'],
            duration: { days: 4, nights: 3 },
            tier: 'comfort',
            basePrice: { amount: 1240, currency: 'USD', basis: 'per-person' },
            images: [{
                url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Taj%20Mahal%20(Edited).jpeg?width=1280',
                alt: 'The Taj Mahal, Agra',
            }],
            easygds: {
                packageId: 'ddd85aba-76ad-47f0-abd4-a36d7767b624',
                placeId: '244102',
            },
            inclusions: ['International flights', '3 nights boutique stays', 'Domestic transfers DEL–AGR–DEL'],
            exclusions: ['Travel insurance, visa & airport taxes'],
        },
        {
            id: 'pkg-family-rajasthan-8d',
            type: 'package',
            name: 'Family Rajasthan Adventure',
            summary: 'An eight-day family-paced circuit with Jaipur forts, Udaipur lakes and the Taj Mahal.',
            destinations: ['jaipur', 'udaipur', 'agra', 'delhi'],
            themes: ['family', 'golden-triangle'],
            duration: { days: 8, nights: 7 },
            tier: 'signature',
            basePrice: { amount: 2495, currency: 'USD', basis: 'per-person' },
            images: [{
                url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Lake%20Palace%2C%20Udaipur.jpg?width=1280',
                alt: 'Lake Palace, Udaipur',
            }],
            easygds: {
                packageId: 'ddd85aba-76ad-47f0-abd4-a36d7767b624',
                placeId: '244102',
            },
            inclusions: ['International flights', '7 nights family rooms', 'Domestic transfers & private car'],
            exclusions: ['Travel insurance, visa & airport taxes'],
        },
    ],
};

// Gateway airports for our two verticals: Delhi/Mumbai (Taj Holidays) and Johannesburg (Cricket World Cup 2027).
const GATEWAY_CODES = new Set(['DEL', 'BOM', 'JNB']);

// Which international gateway serves each destination, so a Cricket World Cup itinerary
// routes through Johannesburg while a Taj Holidays itinerary routes through Delhi.
const DESTINATION_GATEWAY = {
    'cape-town': 'JNB',
    durban: 'JNB',
    centurion: 'JNB',
    gqeberha: 'JNB',
    johannesburg: 'JNB',
    delhi: 'DEL',
    mumbai: 'DEL',
    jaipur: 'DEL',
    agra: 'DEL',
    udaipur: 'DEL',
    hyderabad: 'DEL',
    kochi: 'DEL',
    goa: 'DEL',
    maldives: 'DEL',
};

function gatewayForRoute(routeStops = []) {
    for (const stop of routeStops) {
        const code = DESTINATION_GATEWAY[stop];
        if (code) return code;
    }
    return 'DEL';
}

let cachedCatalog = null;

function catalogUrl() {
    try {
        return new URL('data/catalog/v1/catalog.json', window.location.href).href;
    } catch {
        return '/data/catalog/v1/catalog.json';
    }
}

export async function fetchCatalog() {
    if (cachedCatalog) return cachedCatalog;

    try {
        const res = await fetch(catalogUrl(), { credentials: 'same-origin' });
        if (res.ok) {
            cachedCatalog = await res.json();
            return cachedCatalog;
        }
    } catch {
        // offline / missing file — use inline fixture
    }

    cachedCatalog = INLINE_CATALOG;
    return cachedCatalog;
}

function priceInDisplayCurrency(amount, sourceCurrency, displayCurrency) {
    if (amount == null) return null;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return null;

    const source = String(sourceCurrency || 'USD').toUpperCase();
    const target = String(displayCurrency || source).toUpperCase();
    if (source === target) return Math.round(numericAmount);
    if (source === 'USD') return amountInCurrency(numericAmount, target);
    return null;
}

/**
 * Catalog products carry `basePrice` in GBP for schema/validator compliance (a
 * conversion artifact), but the real commercially-quoted figure lives in
 * `priceProvenance.sourceAmount/sourceCurrency` (USD). Prefer that when present
 * so display-currency conversion has a real USD anchor instead of a GBP one
 * this app's currency model (USD/INR/GBP/AED) has no conversion path for.
 */
function resolveSourcePrice(product) {
    const price = product?.basePrice || {};
    const provenance = product?.priceProvenance;
    if (provenance && String(provenance.sourceCurrency || '').toUpperCase() === 'USD'
        && Number.isFinite(Number(provenance.sourceAmount))) {
        return { amount: Number(provenance.sourceAmount), currency: 'USD', basis: price.basis };
    }
    return { amount: price.amount, currency: price.currency || 'USD', basis: price.basis };
}

export function productToCard(product, displayCurrency = null) {
    const price = resolveSourcePrice(product);
    const img = product.images?.[0];
    const days = product.duration?.days;
    const sourceCurrency = String(price.currency || 'USD').toUpperCase();
    const currency = String(displayCurrency || sourceCurrency).toUpperCase();
    const priceFrom = priceInDisplayCurrency(price.amount, sourceCurrency, currency);
    return {
        id: product.id,
        type: product.type,
        title: displayProductTitle(product.name),
        summary: product.summary || '',
        image: img?.url || '',
        imageAlt: img?.alt || product.name,
        meta: [days ? `${days} days` : null, product.tier].filter(Boolean).join(' · '),
        days: days || null,
        tier: product.tier || 'classic',
        priceFrom,
        currency,
        formattedPrice: priceFrom != null
            ? formatDisplayPrice(priceFrom, currency)
            : null,
        packageId: product.easygds?.packageId || null,
        placeId: product.easygds?.placeId || null,
        destinations: product.destinations || [],
        themes: product.themes || [],
    };
}

function normalizeDestToken(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (!raw) return '';
    const slug = raw.replace(/\s+/g, '-');
    if (slug === 'del' || slug === 'delhi' || slug.startsWith('new-delhi')) {
        return 'delhi';
    }
    if (slug === 'jnb' || slug === 'johannesburg') {
        return 'johannesburg';
    }
    return slug;
}

function scoreProduct(product, { family = false, taj = false, destination = '', q = '' } = {}) {
    let score = 0;
    const dest = normalizeDestToken(destination);
    const needle = String(q || '').toLowerCase();
    const dests = (product.destinations || []).map(d => String(d).toLowerCase());
    const themes = (product.themes || []).map(t => String(t).toLowerCase());
    const name = String(product.name || '').toLowerCase();
    const summary = String(product.summary || '').toLowerCase();
    const cityBreak = /\b(city|stopover|weekend|break)\b/.test(needle);

    if (dest) {
        if (dests.includes(dest)) score += 8;
        else if (dests.some(d => d.includes(dest) || dest.includes(d))) score += 5;
        if (name.includes(dest.replace(/-/g, ' ')) || summary.includes(dest.replace(/-/g, ' '))) score += 3;
        if (dests.length === 1 && dests[0] === dest) score += 6;
        const extraStops = dests.filter(d => d !== dest && !dest.includes(d)).length;
        score -= extraStops * 2;
    }
    if (family && (themes.includes('family') || themes.includes('families'))) score += 5;
    if (taj && (dests.includes('agra') || themes.includes('taj-mahal'))) score += 6;
    if (cityBreak && (themes.includes('city') || themes.includes('stopover'))) score += 5;
    if (cityBreak && dests.length > 1) score -= 12;
    if (needle) {
        if (name.includes(needle)) score += 4;
        if (summary.includes(needle)) score += 2;
        if (themes.some(t => t.includes(needle))) score += 2;
        if (dests.some(d => d.includes(needle.replace(/\s+/g, '-')))) score += 3;
    }
    // Prefer source-backed Hermes packages slightly when equally matched
    if (String(product.id).startsWith('pkg-be-') || String(product.id).startsWith('pkg-ee-')) score += 1;
    if (product.basePrice?.amount > 0) score += 1;
    return score;
}

function isSellableProduct(product) {
    if (!product) return false;
    if (product.status == null) return true;
    return product.status === 'active';
}

export async function searchCatalogProducts({
    type,
    destination = '',
    theme = '',
    q = '',
    limit = 6,
    currency = null,
} = {}) {
    const catalog = await fetchCatalog();
    let results = (catalog.products || []).filter(isSellableProduct);
    if (type) {
        const types = Array.isArray(type) ? type : [type];
        results = results.filter(p => types.includes(p.type));
    }
    if (theme) {
        const t = String(theme).toLowerCase();
        results = results.filter(p => (p.themes || []).some(x => x.toLowerCase().includes(t)));
    }
    if (destination || q) {
        results = [...results].sort(
            (a, b) => scoreProduct(b, { destination, q }) - scoreProduct(a, { destination, q }),
        );
        results = results.filter(p => scoreProduct(p, { destination, q }) > 0 || !(destination || q));
    }
    return results.slice(0, limit).map(product => productToCard(product, currency));
}

export async function getPackageRecommendations({
    family = false,
    taj = false,
    destination = '',
    q = '',
    limit = 3,
    currency = null,
} = {}) {
    const catalog = await fetchCatalog();
    const packages = (catalog.products || []).filter(p => p.type === 'package' && isSellableProduct(p));

    const ranked = [...packages].sort(
        (a, b) => scoreProduct(b, { family, taj, destination, q }) - scoreProduct(a, { family, taj, destination, q }),
    );
    const cityBreak = /\b(city|stopover|weekend|break)\b/.test(String(q || destination || ''));
    const dest = normalizeDestToken(destination)
        || (cityBreak && /delhi/i.test(String(q || '')) ? 'delhi'
            : (cityBreak && /johannesburg|\bjnb\b/i.test(String(q || '')) ? 'johannesburg' : ''));
    const focused = cityBreak && dest
        ? ranked.filter(p => (p.destinations || []).length === 1 && (p.destinations || [])[0] === dest)
        : ranked;
    const pool = focused.length ? focused : ranked.filter(p => scoreProduct(p, { family, taj, destination, q }) > 0 || !(destination || q));

    return pool.slice(0, limit).map(product => productToCard(product, currency));
}

const TAB_CATALOG_TYPES = {
    packages: 'package',
    hotels: 'accommodation',
    tours: ['experience', 'package'],
    transfers: 'transfer',
    flights: 'flight',
};

/** Catalog-backed recommendations for any Guzo tab (mock / offline path). */
export async function getCatalogRecommendations(tab, intent = {}) {
    const type = TAB_CATALOG_TYPES[tab] || 'package';
    const currency = displayCurrencyForOrigin(intent.origin?.code);
    const destination = intent.destination?.name
        || intent.destination?.code
        || intent.city
        || '';
    const q = [
        intent.destination?.name,
        intent.hotelName,
        intent.origin?.name,
        ...(intent.themes || []),
    ].filter(Boolean).join(' ');

    if (tab === 'packages') {
        const family = (intent.travelers?.children || 0) > 0;
        const taj = /taj\s*mahal|agra/i.test(destination) || /taj\s*mahal|agra/i.test(q);
        return getPackageRecommendations({ family, taj, destination, q, limit: 4, currency });
    }

    return searchCatalogProducts({ type, destination, q, limit: 6, currency });
}

const DAY_IMAGES = {
    1: 'https://commons.wikimedia.org/wiki/Special:FilePath/Hawa%20Mahal%202011.jpg?width=1280',
    2: 'https://commons.wikimedia.org/wiki/Special:FilePath/Hawa%20Mahal%202011.jpg?width=1280',
    3: 'https://commons.wikimedia.org/wiki/Special:FilePath/Taj%20Mahal%20(Edited).jpeg?width=1280',
    4: 'https://commons.wikimedia.org/wiki/Special:FilePath/Lake%20Palace%2C%20Udaipur.jpg?width=1280',
    5: 'https://commons.wikimedia.org/wiki/Special:FilePath/Lake%20Palace%2C%20Udaipur.jpg?width=1280',
    6: 'https://commons.wikimedia.org/wiki/Special:FilePath/India%20Gate%20in%20Delhi%2003-2016.jpg?width=1280',
};

const DEST_IMAGES = {
    delhi: DAY_IMAGES[6],
    jaipur: DAY_IMAGES[1],
    agra: DAY_IMAGES[3],
    udaipur: DAY_IMAGES[4],
};

function imageForDestination(destinationId, dayNum = 1, catalog = null) {
    if (catalog?.products?.length) {
        const product = catalog.products.find(p =>
            p.type === 'destination'
            && (p.id === `dest-${destinationId}` || (p.destinations || []).includes(destinationId))
        );
        const url = product?.images?.[0]?.url;
        if (url) return url;
    }
    return DEST_IMAGES[destinationId] || DAY_IMAGES[((dayNum - 1) % 6) + 1];
}

function titleCaseDest(id) {
    return String(id || '')
        .split('-')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function nightsForAllocatedDays(days, isFinal) {
    const d = Math.max(Number(days) || 0, 0);
    return isFinal ? Math.max(d - 1, 0) : d;
}

function calendarDaysForNights(nights, isFinal) {
    const n = Math.max(Number(nights) || 0, 0);
    return isFinal ? n + 1 : Math.max(n, 1);
}

function normalizeClientStayPlan(entries) {
    if (!Array.isArray(entries) || !entries.length) return [];
    return entries
        .map((stop) => ({
            destinationId: String(stop?.destinationId || '')
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '-'),
            days: Math.floor(Number(stop?.days)),
        }))
        .filter((stop) => stop.destinationId && stop.days > 0);
}

function composeClientDay({ destId, dayNum, stayIndex, stayLength, ideas, catalog, moduleId }) {
    const idea = selectDayIdea(ideas, destId, stayIndex, stayLength, stayIndex === 0 ? 'half-day' : null, { moduleId });
    const loc = titleCaseDest(destId);
    return {
        day: dayNum,
        title: idea.title || loc,
        location: loc,
        destinationId: destId,
        summary: idea.summary || '',
        description: idea.summary || '',
        image: idea.image || imageForDestination(destId, dayNum, catalog),
        imageAlt: idea.imageAlt || idea.title || loc,
        highlights: idea.highlights || [],
        moduleId: idea.moduleId || moduleId || null,
        experienceIds: idea.experienceIds || [],
    };
}

export class TripFactsValidationError extends Error {
    constructor(fact, message) {
        super(message);
        this.name = 'TripFactsValidationError';
        this.fact = fact;
    }
}

export class TripDurationValidationError extends Error {
    constructor(requestedDurationDays, minimumDurationDays = 4) {
        super(
            `${requestedDurationDays} days is too short for a holiday including international flights. `
            + `Allow at least ${minimumDurationDays} days for arrival, a usable land programme, and return travel.`,
        );
        this.name = 'TripDurationValidationError';
        this.code = 'minimum-duration';
        this.requestedDurationDays = requestedDurationDays;
        this.minimumDurationDays = minimumDurationDays;
    }
}

function requireTripFacts(intent) {
    const originName = intent?.origin?.name || null;
    const originCode = intent?.origin?.code || null;
    const start = intent?.dates?.start || null;
    const adults = intent?.travelers?.adults;
    if (!originName && !originCode) {
        throw new TripFactsValidationError('origin', 'origin is required');
    }
    if (!start) {
        throw new TripFactsValidationError('dates.start', 'startDate is required');
    }
    if (adults == null || !Number.isFinite(Number(adults)) || Number(adults) < 1) {
        throw new TripFactsValidationError('travelers.adults', 'adults is required');
    }
    const requestedDurationDays = Number(intent?.durationDays);
    if (
        originCode
        && !GATEWAY_CODES.has(String(originCode).toUpperCase())
        && requestedDurationDays > 0
        && requestedDurationDays < 4
    ) {
        throw new TripDurationValidationError(requestedDurationDays);
    }
    return {
        originName: originName || originCode,
        originCode,
        start,
        adults: Number(adults),
        children: Number(intent?.travelers?.children) || 0,
        infants: Number(intent?.travelers?.infants) || 0,
        childAges: intent?.travelers?.childAges || [],
    };
}

/**
 * Build an itinerary view-model from a catalog package (or card) + trip intent.
 * Uses package.route occupancy and destination-day modules; never emits generic "day N" copy.
 */
export async function buildItineraryFromProduct(intent = {}, productOrCard = null) {
    const catalog = await fetchCatalog();
    const ideas = await loadDayIdeas();
    const productId = productOrCard?.id || null;
    const product = productId
        ? (catalog.products || []).find(p => p.id === productId && isSellableProduct(p))
        : null;
    const stayPlan = normalizeClientStayPlan(intent.stayPlan);

    if (!stayPlan.length && (!product || product.type !== 'package')) {
        return buildGoldenTriangleItinerary(intent, productOrCard);
    }

    // Keep the rich Golden Triangle fixture for the original synthetic Taj Holidays packages
    // unless the caller supplied an explicit stay plan (custom mock path).
    if (!stayPlan.length && product && /golden-triangle|taj-mahal-weekend|family-rajasthan/i.test(product.id)) {
        return buildGoldenTriangleItinerary(intent, productToCard(product));
    }

    const facts = requireTripFacts(intent);
    const adults = facts.adults;
    const children = facts.children;
    const requestedDays = Number(intent.durationDays) > 0
        ? Number(intent.durationDays)
        : stayPlan.reduce((n, s) => n + s.days, 0) || product?.duration?.days || 6;
    const daysCount = requestedDays;
    const nightsCount = Math.max(daysCount - 1, 0);
    const start = facts.start;
    const end = intent.dates?.end || addDays(start, Math.max(daysCount - 1, 0));
    const tier = intent.tier || product?.tier || 'classic';
    const originName = facts.originName;
    const originCode = facts.originCode;
    const priceCurrency = displayCurrencyForOrigin(originCode);
    const resolvedSource = product ? resolveSourcePrice(product) : null;
    const basePriceAmount = resolvedSource?.amount ?? productOrCard?.priceFrom ?? null;
    const basePriceCurrency = resolvedSource?.currency || productOrCard?.currency || 'USD';
    const priceAmount = priceInDisplayCurrency(basePriceAmount, basePriceCurrency, priceCurrency);
    const card = product ? productToCard(product, priceCurrency) : productOrCard;
    const milesPriceUsd = String(basePriceCurrency).toUpperCase() === 'USD'
        && basePriceAmount != null
        && Number.isFinite(Number(basePriceAmount))
        ? Number(basePriceAmount)
        : null;

    const days = [];
    const occupancyStops = [];
    if (stayPlan.length) {
        let dayNum = 1;
        for (let s = 0; s < stayPlan.length; s += 1) {
            const stop = stayPlan[s];
            occupancyStops.push({
                destinationId: stop.destinationId,
                nights: nightsForAllocatedDays(stop.days, s === stayPlan.length - 1),
            });
            for (let i = 0; i < stop.days && dayNum <= daysCount; i += 1) {
                days.push(composeClientDay({
                    destId: stop.destinationId,
                    dayNum,
                    stayIndex: i,
                    stayLength: stop.days,
                    ideas,
                    catalog,
                }));
                dayNum += 1;
            }
        }
    } else if (product?.route?.length) {
        let dayNum = 1;
        for (let s = 0; s < product.route.length; s += 1) {
            const stop = product.route[s];
            const isLast = s === product.route.length - 1;
            const stayLength = calendarDaysForNights(stop.nights, isLast);
            occupancyStops.push({ destinationId: stop.destinationId, nights: stop.nights || 0 });
            for (let i = 0; i < stayLength && dayNum <= daysCount; i += 1) {
                const template = (product.dayTemplates || []).find((t) => t.day === dayNum);
                days.push(composeClientDay({
                    destId: stop.destinationId,
                    dayNum,
                    stayIndex: i,
                    stayLength,
                    ideas,
                    catalog,
                    moduleId: template?.moduleId,
                }));
                dayNum += 1;
            }
        }
    }

    while (days.length < daysCount) {
        const last = days[days.length - 1];
        const destId = last?.destinationId
            || product?.destinations?.[product.destinations.length - 1]
            || 'delhi';
        const stayIndex = days.filter((d) => d.destinationId === destId).length;
        days.push(composeClientDay({
            destId,
            dayNum: days.length + 1,
            stayIndex,
            stayLength: stayIndex + 1,
            ideas,
            catalog,
        }));
    }

    const routeStops = occupancyStops.length
        ? occupancyStops.map((s) => s.destinationId)
        : (product?.route?.length ? product.route.map((r) => r.destinationId) : product?.destinations) || [];

    const hotels = occupancyStops
        .filter((r) => (r.nights || 0) > 0)
        .map((r) => ({
            name: `${titleCaseDest(r.destinationId)} stay`,
            nights: r.nights,
            location: titleCaseDest(r.destinationId),
            tier,
        }));

    return {
        id: `itinerary-${product?.id || `custom-${daysCount}d`}`,
        title: composeItineraryTitle({
            durationDays: daysCount,
            tier,
            destinations: days.map((d) => d.destinationId).filter(Boolean),
            children,
            interests: intent.interests,
        }),
        subtitle: product?.summary || stayPlan
            .map((s) => `${s.days} day${s.days === 1 ? '' : 's'} in ${titleCaseDest(s.destinationId)}`)
            .join(', '),
        heroImage: card?.image || DAY_IMAGES[4],
        duration: { days: daysCount, nights: nightsCount },
        route: routeStops.map(titleCaseDest),
        price: {
            amount: priceAmount,
            currency: priceCurrency,
            basis: product?.basePrice?.basis || 'per-person',
        },
        maharajaPointsEstimate: milesPriceUsd == null ? null : Math.round(milesPriceUsd * 2.2),
        placeId: product?.easygds?.placeId || null,
        packageId: product?.easygds?.packageId || product?.id || null,
        dates: { start, end },
        travelers: {
            adults,
            children,
            infants: facts.infants,
            childAges: facts.childAges,
        },
        origin: { name: originName, code: originCode },
        destination: {
            name: titleCaseDest(routeStops[0] || product?.destinations?.[0] || 'india'),
            code: originCode ? gatewayForRoute(routeStops) : null,
        },
        tier,
        cabin: intent.cabin || 'Economy',
        days: days.slice(0, daysCount),
        flights: originCode
            ? [
                {
                    from: originCode,
                    to: gatewayForRoute(routeStops),
                    airline: 'Air India',
                    type: 'international',
                    label: `${originName} → ${titleCaseDest(gatewayForRoute(routeStops) === 'JNB' ? 'johannesburg' : 'delhi')}`,
                },
            ]
            : [],
        hotels,
        ...withInternationalFlightsIncluded(product?.inclusions || [], product?.exclusions || []),
        catalogProductId: product?.id || null,
    };
}

/** Build a Golden Triangle itinerary fixture from trip intent + optional product card. */
export function buildGoldenTriangleItinerary(intent = {}, product = null) {
    const facts = requireTripFacts(intent);
    const adults = facts.adults;
    const children = facts.children;
    const start = facts.start;
    const end = intent.dates?.end || addDays(start, 5);
    const tier = intent.tier || product?.tier || 'classic';
    const packageId = product?.packageId || 'ddd85aba-76ad-47f0-abd4-a36d7767b624';
    const placeId = product?.placeId || '244102';
    const originName = facts.originName;
    const originCode = facts.originCode;
    const priceCurrency = displayCurrencyForOrigin(originCode);
    const fallbackUsd = tier === 'signature' ? 2495 : tier === 'comfort' ? 2100 : 1895;
    const hasProductPrice = product && Object.hasOwn(product, 'priceFrom');
    const sourcePrice = hasProductPrice ? product.priceFrom : fallbackUsd;
    const sourceCurrency = hasProductPrice ? product.currency : 'USD';
    const priceAmount = priceInDisplayCurrency(sourcePrice, sourceCurrency, priceCurrency);
    const milesPriceUsd = String(sourceCurrency || 'USD').toUpperCase() === 'USD'
        && sourcePrice != null
        && Number.isFinite(Number(sourcePrice))
        ? Number(sourcePrice)
        : null;

    return {
        id: 'itinerary-golden-triangle-6d',
        title: displayProductTitle(product?.title || 'Golden Triangle: Jaipur, Agra & Udaipur'),
        subtitle: "Jaipur's forts to Udaipur's lakes — palaces, bazaars, and the Taj Mahal at sunrise.",
        heroImage: product?.image || DAY_IMAGES[3],
        duration: { days: 6, nights: 5 },
        route: ['Jaipur', 'Agra', 'Udaipur', 'Delhi'],
        price: { amount: priceAmount, currency: priceCurrency, basis: 'per-person' },
        maharajaPointsEstimate: milesPriceUsd == null ? null : Math.round(milesPriceUsd * 2.2),
        placeId,
        packageId,
        catalogProductId: product?.id || null,
        dates: { start, end },
        travelers: { adults, children, infants: facts.infants, childAges: facts.childAges },
        origin: { name: originName, code: originCode },
        destination: { name: 'Golden Triangle', code: originCode ? 'DEL' : null },
        tier,
        cabin: intent.cabin || 'Economy',
        days: [
            {
                day: 1,
                destinationId: 'jaipur',
                title: 'Gateway to the Pink City',
                location: 'Jaipur',
                description: 'Arrive in Rajasthan\'s Pink City — Amber Fort at sunrise light, City Palace, and the bazaars of the old town.',
                image: DAY_IMAGES[1],
                highlights: ['Amber Fort', 'City Palace', 'Bazaar walk'],
            },
            {
                day: 2,
                destinationId: 'jaipur',
                title: 'Palaces and stepwells of Jaipur',
                location: 'Jaipur',
                description: 'A second day around Jaipur — Hawa Mahal, the Jantar Mantar observatory, and the Panna Meena ka Kund stepwell.',
                image: DAY_IMAGES[2],
                highlights: ['Hawa Mahal', 'Jantar Mantar', 'Panna Meena ka Kund'],
            },
            {
                day: 3,
                destinationId: 'agra',
                title: 'Sunrise at the Taj Mahal',
                location: 'Agra',
                description: 'Drive to Agra for a sunrise visit to the Taj Mahal, then Agra Fort and the marble inlay workshops nearby.',
                image: DAY_IMAGES[3],
                highlights: ['Taj Mahal at sunrise', 'Agra Fort', 'Marble inlay workshop'],
            },
            {
                day: 4,
                destinationId: 'udaipur',
                title: 'Lake palaces of Udaipur',
                location: 'Udaipur',
                description: 'Fly to Udaipur, the City of Lakes — the City Palace complex and a sunset boat ride on Lake Pichola.',
                image: DAY_IMAGES[4],
                highlights: ['City Palace complex', 'Lake Pichola boat ride'],
            },
            {
                day: 5,
                destinationId: 'udaipur',
                title: 'Udaipur at your own pace',
                location: 'Udaipur',
                description: 'A free-flowing second day in Udaipur — Jagdish Temple, the Saheliyon ki Bari gardens, and time by the lake.',
                image: DAY_IMAGES[5],
                highlights: ['Jagdish Temple', 'Saheliyon ki Bari', 'Lakeside leisure'],
            },
            {
                day: 6,
                destinationId: 'delhi',
                title: 'Return via Delhi',
                location: 'Delhi',
                description: 'Morning at leisure, then fly to Delhi for your international connection.',
                image: DAY_IMAGES[6],
                highlights: ['Domestic flight', 'Delhi gateway'],
            },
        ],
        flights: [
            ...(originCode ? [{
                from: originCode,
                to: 'DEL',
                airline: 'Air India',
                type: 'international',
                label: `${originName} → Delhi`,
            }] : []),
            {
                from: 'DEL',
                to: 'JAI',
                airline: 'Air India',
                type: 'domestic',
                label: 'Delhi → Jaipur',
            },
            {
                from: 'AGR',
                to: 'UDR',
                airline: 'Air India',
                type: 'domestic',
                label: 'Agra → Udaipur',
            },
            {
                from: 'UDR',
                to: 'DEL',
                airline: 'Air India',
                type: 'domestic',
                label: 'Udaipur → Delhi',
            },
        ],
        hotels: [
            { name: 'Jai Mahal Palace', nights: 2, location: 'Jaipur', tier },
            { name: 'ITC Mughal', nights: 1, location: 'Agra', tier },
            { name: 'Taj Lake Palace', nights: 2, location: 'Udaipur', tier },
        ],
        ...withInternationalFlightsIncluded(
            [
                'International flights',
                '5 nights accommodation & listed meals',
                'Domestic transfers & private car',
                'Expert guides & monument entry fees',
                'Water, hot drinks & cultural experiences',
            ],
            [
                'Travel insurance, visa & airport taxes',
                'Alcoholic drinks & personal expenses',
                'Tips for guides & drivers',
            ],
        ),
    };
}

const DEMO_TRIP_INTENT = Object.freeze({
    origin: { name: 'London', code: 'LHR' },
    dates: { start: '2026-10-12' },
    travelers: { adults: 2, children: 0, infants: 0, childAges: [] },
});

/** Build an explicit demo fixture without weakening chat itinerary validation. */
export async function buildDemoItinerary(productOrCard = null) {
    if (productOrCard) {
        return buildItineraryFromProduct(DEMO_TRIP_INTENT, productOrCard);
    }
    return buildGoldenTriangleItinerary(DEMO_TRIP_INTENT);
}

function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

export function intentToTripSummary(intent) {
    if (!intent) return null;
    const t = intent.travelers || {};
    const rooms = t.rooms == null ? 1 : Math.max(1, Number(t.rooms) || 1);
    const adults = Number(t.adults);
    const guests = (Number.isFinite(adults) && adults > 0 ? adults : 0)
        + (Number(t.children) || 0)
        + (Number(t.infants) || 0);
    const travelerText = guests
        ? `${rooms} room${rooms > 1 ? 's' : ''}, ${guests} traveller${guests === 1 ? '' : 's'}`
        : `${rooms} room${rooms > 1 ? 's' : ''}`;

    return {
        origin: intent.origin?.name
            ? `${intent.origin.name}${intent.origin.code ? ` (${intent.origin.code})` : ''}`
            : '',
        destination: intent.destination?.name
            ? `${intent.destination.name}${intent.destination.code ? ` (${intent.destination.code})` : ''}`
            : '',
        dates: intent.dates?.start
            ? `${intent.dates.start}${intent.dates.end ? ` → ${intent.dates.end}` : ''}`
            : '',
        travelers: travelerText,
        tier: intent.tier || null,
        cabin: intent.cabin || null,
    };
}

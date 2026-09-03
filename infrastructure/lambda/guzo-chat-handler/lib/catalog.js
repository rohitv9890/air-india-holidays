import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    amountInCurrency,
    DEFAULT_DISPLAY_CURRENCY,
    formatDisplayPrice,
    normalizeDisplayCurrency,
} from './display-currency.js';
import { displayProductTitle } from './display-title.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDataFile(name) {
    const candidates = [
        process.env.CATALOG_DIR ? join(resolve(process.env.CATALOG_DIR), name) : null,
        join(__dirname, '../data/catalog/v1', name), // packaged with Lambda
        join(__dirname, '../../../../data/catalog/v1', name), // monorepo checkout
    ].filter(Boolean);
    const hit = candidates.find((p) => existsSync(p));
    if (!hit) throw new Error(`Catalog file not found: ${name} (tried ${candidates.join(', ')})`);
    return hit;
}

let cached = null;
let destCached = null;
let primaryIataOwnersCached = null;

const LEGACY_PLACE_ID_ALIASES = {
    // EasyGDS place ids currently returned by /places but not stored in catalog data.
    2093: 'lalibela',
};

function searchable(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** First catalog destination wins each IATA so gateway codes like ADD don't alias Bale/Danakil. */
function primaryIataOwners() {
    if (primaryIataOwnersCached) return primaryIataOwnersCached;
    const map = new Map();
    for (const destination of loadDestinations().destinations || []) {
        const code = searchable(destination.iata);
        if (code && !map.has(code)) map.set(code, destination.id);
    }
    primaryIataOwnersCached = map;
    return map;
}

function destinationAliases(destination) {
    const aliases = [
        destination.id,
        destination.name,
        destination.cluster,
        ...(destination.aliases || []),
        ...(destination.easygdsPlaceIds || []),
    ];
    const iata = searchable(destination.iata);
    if (iata && primaryIataOwners().get(iata) === destination.id) {
        aliases.push(destination.iata);
    }
    return aliases.filter(Boolean).map(searchable);
}

function textMentionsAlias(text, alias) {
    if (!text || !alias) return false;
    if (alias.length <= 3) {
        return new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(text);
    }
    return text.includes(alias);
}

export function normalizeDestination(value) {
    if (value && typeof value === 'object') {
        const candidates = [value.catalogId, value.slug, value.name, value.code, value.id];
        for (const candidate of candidates) {
            const normalized = normalizeDestination(candidate);
            if (normalized) return normalized;
        }
        return '';
    }

    const input = searchable(value);
    if (!input) return '';
    if (LEGACY_PLACE_ID_ALIASES[input]) return LEGACY_PLACE_ID_ALIASES[input];

    const destinations = loadDestinations().destinations || [];
    const exact = destinations.find((destination) =>
        destinationAliases(destination).some((alias) => alias === input)
    );
    if (exact) return exact.id;

    let bestId = '';
    let bestLen = 0;
    for (const destination of destinations) {
        for (const alias of destinationAliases(destination)) {
            if (alias.length < 2 || alias.length <= bestLen) continue;
            if (textMentionsAlias(input, alias) || (alias.length > 3 && input.includes(alias))) {
                bestId = destination.id;
                bestLen = alias.length;
            }
        }
    }
    return bestId;
}

function productSearchText(product) {
    return searchable([
        product.id,
        product.name,
        product.summary,
        ...(product.destinations || []),
        ...(product.themes || []),
        ...(product.compatibility || []),
    ].join(' '));
}

function queryTerms(q) {
    const text = searchable(q);
    if (!text) return [];
    const destinations = loadDestinations().destinations || [];
    let remainder = ` ${text} `;
    const terms = [];

    for (const destination of destinations) {
        const aliases = destinationAliases(destination)
            .filter((alias) => alias.length > 2)
            .sort((a, b) => b.length - a.length);
        const match = aliases.find((alias) => remainder.includes(` ${alias} `));
        if (match) {
            terms.push(searchable(destination.id));
            remainder = remainder.replace(` ${match} `, ' ');
        }
    }

    const stopwords = new Set([
        'a', 'an', 'and', 'for', 'in', 'of', 'package', 'the', 'to', 'trip',
        'want', 'hotel', 'hotels', 'stay', 'stays', 'looking', 'need', 'book',
        'booking', 'break', 'weekend', 'please', 'me', 'my',
    ]);
    terms.push(...remainder.trim().split(/\s+/).filter((term) => term.length > 1 && !stopwords.has(term)));
    return [...new Set(terms)];
}

function catalogPath() {
    if (process.env.CATALOG_PATH) return resolve(process.env.CATALOG_PATH);
    return resolveDataFile('catalog.json');
}

export function loadCatalog({ force = false } = {}) {
    if (cached && !force) return cached;
    cached = JSON.parse(readFileSync(catalogPath(), 'utf8'));
    return cached;
}

/** Products eligible for search, ranking, composition, and quotes. */
export function isSellableProduct(product) {
    if (!product) return false;
    // Legacy catalogs without lifecycle fields remain sellable.
    if (product.status == null) return true;
    return product.status === 'active';
}

function sellableProducts(products = loadCatalog().products) {
    return products.filter(isSellableProduct);
}

export function loadDestinations({ force = false } = {}) {
    if (destCached && !force) return destCached;
    const path = process.env.DESTINATIONS_PATH
        ? resolve(process.env.DESTINATIONS_PATH)
        : resolveDataFile('destinations.json');
    destCached = JSON.parse(readFileSync(path, 'utf8'));
    primaryIataOwnersCached = null;
    return destCached;
}

export function getById(id, { includeNonActive = false } = {}) {
    const product = loadCatalog().products.find((p) => p.id === id) || null;
    if (!product) return null;
    if (includeNonActive || isSellableProduct(product)) return product;
    return null;
}

export function search({ type, destination, theme, tier, q, includeNonActive = false } = {}) {
    let results = includeNonActive ? loadCatalog().products : sellableProducts();
    if (type) {
        const types = Array.isArray(type) ? type : [type];
        results = results.filter((p) => types.includes(p.type));
    }
    if (destination) {
        const destinationSlug = normalizeDestination(destination);
        const d = searchable(destinationSlug || destination);
        results = results.filter(
            (p) =>
                p.destinations?.some((x) => searchable(x) === d) ||
                productSearchText(p).includes(d),
        );
    }
    if (theme) {
        const t = String(theme).toLowerCase();
        results = results.filter((p) => p.themes?.some((x) => x.toLowerCase() === t || x.toLowerCase().includes(t)));
    }
    if (tier) {
        results = results.filter((p) => p.tier === tier);
    }
    if (q) {
        const terms = queryTerms(q);
        results = results.filter((p) => {
            const text = productSearchText(p);
            return terms.every((term) => text.includes(term));
        });
    }
    return results;
}

function requestedDestinations(intent = {}) {
    const values = [
        intent.destination,
        ...(intent.interests || []),
        intent.preferences,
    ].filter(Boolean);
    const destinations = loadDestinations().destinations || [];
    const requested = new Set();

    for (const value of values) {
        const normalized = normalizeDestination(value);
        if (normalized) requested.add(normalized);
        const text = searchable(typeof value === 'object' ? (value.name || value.code || value.id) : value);
        for (const destination of destinations) {
            if (destinationAliases(destination).some((alias) => alias.length > 2 && textMentionsAlias(text, alias))) {
                requested.add(destination.id);
            }
        }
    }
    return [...requested];
}

function intentSearchText(intent = {}) {
    const chunks = [];
    if (intent.preferences) chunks.push(String(intent.preferences));
    const destName = typeof intent.destination === 'object'
        ? (intent.destination?.name || '')
        : intent.destination;
    if (destName) chunks.push(String(destName));
    for (const interest of intent.interests || []) {
        chunks.push(typeof interest === 'object' ? (interest.name || '') : String(interest));
    }
    return searchable(chunks.join(' '));
}

function isCityBreakIntent(intent = {}) {
    return /\b(city|cities|urban|stopover|weekend|break)\b/.test(intentSearchText(intent));
}

function intentThemeHints(intent = {}) {
    const chunks = [];
    if (intent.preferences) chunks.push(String(intent.preferences));
    const destName = typeof intent.destination === 'object'
        ? (intent.destination?.name || '')
        : intent.destination;
    if (destName && !normalizeDestination(destName)) chunks.push(String(destName));
    for (const interest of intent.interests || []) {
        // Destination labels belong in requestedDestinations, not theme scoring.
        if (normalizeDestination(interest)) continue;
        chunks.push(String(interest));
    }
    const text = searchable(chunks.join(' '));
    const hints = new Set();
    if (!text) return hints;

    if (/\b(city|cities|urban|stopover|weekend|break)\b/.test(text)) {
        for (const theme of ['city', 'stopover', 'culture']) hints.add(theme);
    }
    if (/\b(hotel|hotels|stay|stays|accommodation|lodge|resort)\b/.test(text)) {
        hints.add('city');
    }
    if (/\b(trek|trekking|hiking|mountain|mountains)\b/.test(text)) {
        for (const theme of ['trek', 'nature', 'hiking', 'trekking']) hints.add(theme);
    }
    if (/\b(wildlife|safari|nature)\b/.test(text)) {
        for (const theme of ['wildlife', 'nature']) hints.add(theme);
    }
    if (/\b(history|historic|unesco|heritage|faith)\b/.test(text)) {
        for (const theme of ['history', 'unesco', 'culture', 'historical', 'religious']) hints.add(theme);
    }
    return hints;
}

function scoreProductForIntent(product, {
    requested = [],
    primary = '',
    duration = null,
    tier = null,
    themeHints = new Set(),
    cityBreak = false,
} = {}) {
    const productDestinations = product.destinations || [];
    const overlap = requested.filter((id) => productDestinations.includes(id)).length;
    const dayDelta = duration == null
        ? 0
        : Math.abs((Number(product.duration?.days) || duration) - duration);
    const themes = (product.themes || []).map((theme) => searchable(theme));
    const themeOverlap = [...themeHints].filter((theme) =>
        themes.some((productTheme) => productTheme === theme || productTheme.includes(theme) || theme.includes(productTheme))
    ).length;
    const focusId = primary || (requested.length === 1 ? requested[0] : '');
    const focusedOnPrimary = Boolean(
        focusId
        && productDestinations.includes(focusId)
        && productDestinations.length === 1
    );
    const extraStops = cityBreak && requested.length <= 1 && focusId
        ? Math.max(0, productDestinations.filter((id) => id !== focusId).length)
        : 0;

    const score =
        overlap * 4
        + (primary && productDestinations.includes(primary) ? 5 : 0)
        + (cityBreak && focusedOnPrimary ? 6 : 0)
        + themeOverlap * 3
        + (tier && product.tier === tier ? 1 : 0)
        - dayDelta * 2
        - extraStops * 2;

    return { product, score, overlap, dayDelta, focusedOnPrimary, extraStops };
}

export function rankProductsForIntent(intent = {}, { limit = 4, types = ['package'] } = {}) {
    const typeList = Array.isArray(types) ? types : [types];
    const requested = requestedDestinations(intent);
    const primary = normalizeDestination(intent.destination);
    const duration = Number(intent.durationDays) || null;
    const tier = intent.tier || null;
    const themeHints = intentThemeHints(intent);
    const cityBreak = typeList.includes('package') && isCityBreakIntent(intent);
    const products = typeList.length === 1
        ? search({ type: typeList[0] })
        : sellableProducts().filter((product) => typeList.includes(product.type));

    const scored = products
        .map((product) => scoreProductForIntent(product, {
            requested,
            primary,
            duration,
            tier,
            themeHints,
            cityBreak,
        }))
        .filter((entry) => requested.length === 0 || entry.overlap > 0);

    const focused = cityBreak
        ? scored.filter((entry) => entry.focusedOnPrimary)
        : scored;
    const pool = focused.length ? focused : scored;

    return pool
        .sort((a, b) =>
            b.score - a.score
            || a.dayDelta - b.dayDelta
            || a.product.name.localeCompare(b.product.name)
        )
        .slice(0, limit)
        .map((entry) => entry.product);
}

export function rankPackagesForIntent(intent = {}, { limit = 4 } = {}) {
    return rankProductsForIntent(intent, { limit, types: ['package'] });
}

const ENHANCEMENT_RELATIONSHIP_PRIORITY = {
    'optional-addon': 50,
    'tier-upgrade': 45,
    extension: 35,
    alternative: 20,
};

function enhancementKind(product, relationshipType) {
    if (relationshipType === 'tier-upgrade') return 'upgrade';
    if (relationshipType === 'extension') return 'extension';
    if (relationshipType === 'alternative') return 'alternative';
    if (product.type === 'accommodation') return 'accommodation';
    if (product.type === 'transfer') return 'transfer';
    return 'experience';
}

function catalogAmountInDisplayCurrency(basePrice, displayCurrency) {
    if (basePrice?.amount == null) return null;
    const amount = Number(basePrice.amount);
    if (!Number.isFinite(amount)) return null;

    const sourceCurrency = String(basePrice.currency || 'GBP').toUpperCase();
    const targetCurrency = String(displayCurrency || sourceCurrency).toUpperCase();
    if (sourceCurrency === targetCurrency) return Math.round(amount);
    if (sourceCurrency === 'GBP') return amountInCurrency(amount, targetCurrency);
    return null;
}

/**
 * Return only active products connected to a package through a typed relationship.
 * Destination overlap breaks ties inside the relationship priority.
 */
export function suggestEnhancements({
    packageId,
    destinations = [],
    limit = 4,
    currency,
} = {}) {
    const pkg = getById(packageId, { includeNonActive: true });
    if (!pkg) throw new Error(`Unknown package: ${packageId}`);
    if (pkg.status !== 'active' || pkg.type !== 'package') {
        throw new Error(`Package not sellable: ${packageId}`);
    }

    const displayCurrency = normalizeDisplayCurrency(currency);
    const requestedDestinations = new Set(Array.isArray(destinations) ? destinations : []);
    const itineraryDestinations = new Set([
        ...(pkg.destinations || []),
        ...requestedDestinations,
    ].filter(Boolean));
    const seen = new Set();

    return (pkg.relationships || [])
        .filter((relationship) => ENHANCEMENT_RELATIONSHIP_PRIORITY[relationship.type])
        .map((relationship) => {
            const product = getById(relationship.productId, { includeNonActive: true });
            if (!product || product.status !== 'active' || seen.has(product.id)) return null;
            const overlap = (product.destinations || [])
                .filter((destination) => itineraryDestinations.has(destination));
            if (!overlap.length) return null;
            seen.add(product.id);
            const requestedOverlap = overlap.filter((destination) => requestedDestinations.has(destination));
            const kind = enhancementKind(product, relationship.type);
            const displayAmount = catalogAmountInDisplayCurrency(product.basePrice, displayCurrency);
            const reason = relationship.note
                || (overlap.length
                    ? `Relevant to ${overlap.map((id) => id.replace(/-/g, ' ')).join(', ')} on this trip`
                    : `Catalogued ${kind} for this package`);
            return {
                id: product.id,
                title: displayProductTitle(product.name),
                summary: product.summary,
                productType: product.type,
                relationshipType: relationship.type,
                kind,
                status: relationship.type === 'included' ? 'required' : 'optional',
                reason,
                destinations: product.destinations || [],
                price: displayAmount > 0
                    ? {
                        amount: displayAmount,
                        currency: displayCurrency,
                        formatted: formatDisplayPrice(displayAmount, displayCurrency),
                        basis: product.basePrice.basis,
                    }
                    : null,
                score: ENHANCEMENT_RELATIONSHIP_PRIORITY[relationship.type]
                    + overlap.length * 5
                    + requestedOverlap.length * 10,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, Math.max(0, Math.min(Number(limit) || 4, 4)))
        .map(({ score, ...item }) => item);
}

/** Repair collapsed Wikimedia thumb URLs: .../thumb/a/ab/1280px-File.jpg → .../File.jpg/1280px-File.jpg */
const IMAGE_URL_REPLACEMENTS = new Map([
    [
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Addis_Ababa_skyline.jpg/1280px-Addis_Ababa_skyline.jpg',
        'images/addis-friendship-park.jpg',
    ],
    [
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Addis_Ababa_skyline.jpg/Addis_Ababa_skyline.jpg/1280px-Addis_Ababa_skyline.jpg',
        'images/addis-friendship-park.jpg',
    ],
    [
        'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Fasil_Ghebbi_%28Gonder%2C_Ethiopia%29.jpg/1280px-Fasil_Ghebbi_%28Gonder%2C_Ethiopia%29.jpg',
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg/1280px-ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg',
    ],
    [
        'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Fasil_Ghebbi_(Gonder,_Ethiopia).jpg/1280px-Fasil_Ghebbi_(Gonder,_Ethiopia).jpg',
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg/1280px-ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg',
    ],
]);

export function normalizeImageUrl(url) {
    if (typeof url !== 'string' || !url) return url || '';
    const replaced = IMAGE_URL_REPLACEMENTS.get(url);
    if (replaced) return replaced;
    const match = url.match(
        /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^/]+\/[^/]+\/)(\d+px-.+)$/
    );
    if (!match) return url;
    const sized = match[2];
    const original = sized.replace(/^\d+px-/, '');
    const repaired = `${match[1]}${original}/${sized}`;
    return IMAGE_URL_REPLACEMENTS.get(repaired) || repaired;
}

function productImage(product) {
    const direct = product?.images?.[0];
    if (direct?.url) {
        return {
            url: normalizeImageUrl(direct.url),
            alt: direct.alt || product.name,
        };
    }

    // Hermes imports often ship without images — use primary destination media.
    for (const destId of product?.destinations || []) {
        const dest = getById(`dest-${destId}`)
            || search({ type: 'destination', destination: destId })[0];
        const img = dest?.images?.[0];
        if (img?.url) {
            return {
                url: normalizeImageUrl(img.url),
                alt: img.alt || product.name,
            };
        }
    }

    return { url: '', alt: product?.name || '' };
}

export function toRecommendation(product, { currency } = {}) {
    const media = productImage(product);
    const displayCurrency = normalizeDisplayCurrency(
        currency,
        null,
    ) || DEFAULT_DISPLAY_CURRENCY;
    const priceFrom = catalogAmountInDisplayCurrency(product.basePrice, displayCurrency);
    return {
        id: product.id,
        type: product.type,
        title: displayProductTitle(product.name),
        meta: [
            product.duration?.days ? `${product.duration.days} days` : '',
            product.tier || '',
        ].filter(Boolean).join(' · '),
        priceFrom,
        currency: displayCurrency,
        formattedPrice: priceFrom != null ? formatDisplayPrice(priceFrom, displayCurrency) : null,
        image: media.url,
        imageAlt: media.alt,
        destinations: product.destinations || [],
    };
}

export function listDestinations() {
    const fromFile = loadDestinations().destinations;
    if (fromFile?.length) return fromFile;
    return search({ type: 'destination' }).map((p) => ({
        id: p.destinations[0] || p.id,
        name: p.name,
        iata: p.iata,
        cluster: p.cluster,
        themes: p.themes,
        summary: p.summary,
    }));
}

/**
 * Rank catalog destinations to fill unnamed additional stops around known anchors.
 * Uses package co-occurrence and theme overlap only — never invents places.
 */
export function suggestStops({
    anchors = [],
    count = 2,
    totalDays = null,
    themes = [],
    tier = null,
} = {}) {
    const anchorIds = [...new Set(
        (Array.isArray(anchors) ? anchors : [])
            .map((a) => normalizeDestination(a))
            .filter(Boolean),
    )];
    const limit = Math.max(1, Math.min(Number(count) || 2, 4));
    const destinations = loadDestinations().destinations || [];
    const destById = new Map(destinations.map((d) => [d.id, d]));
    const packages = search({ type: 'package' });
    const themeHints = intentThemeHints({
        interests: Array.isArray(themes) ? themes : [],
        preferences: Array.isArray(themes) ? themes.join(' ') : String(themes || ''),
    });

    const anchorMinDays = anchorIds.reduce((sum, id) => {
        const min = Number(destById.get(id)?.stayGuidance?.minDays) || 1;
        return sum + min;
    }, 0);
    const remainingDays = totalDays != null && Number(totalDays) > 0
        ? Math.max(Number(totalDays) - anchorMinDays, 0)
        : null;

    const scored = [];
    for (const destination of destinations) {
        const id = destination.id;
        if (!id || anchorIds.includes(id)) continue;

        const minDays = Number(destination.stayGuidance?.minDays) || 1;
        if (remainingDays != null && minDays > remainingDays) continue;

        let coOccurrence = 0;
        for (const pkg of packages) {
            const stops = pkg.destinations || [];
            if (!stops.includes(id)) continue;
            if (anchorIds.some((anchor) => stops.includes(anchor))) {
                coOccurrence += 1;
            }
        }

        const destThemes = (destination.themes || []).map((theme) => searchable(theme));
        const themeOverlap = [...themeHints].filter((theme) =>
            destThemes.some((productTheme) =>
                productTheme === theme
                || productTheme.includes(theme)
                || theme.includes(productTheme)
            )
        ).length;

        const tierBonus = tier && destination.tier === tier ? 1 : 0;
        const score = coOccurrence * 4 + themeOverlap * 3 + tierBonus;
        if (score <= 0 && !themeHints.size && !anchorIds.length) {
            // Still allow weakly ranked catalog stops when no signal is available.
        }

        const reasons = [];
        if (coOccurrence > 0) {
            reasons.push(`Appears with your stops on ${coOccurrence} catalog package${coOccurrence === 1 ? '' : 's'}`);
        }
        if (themeOverlap > 0) {
            reasons.push(`Matches your themes (${[...themeHints].slice(0, 3).join(', ')})`);
        }
        if (!reasons.length && destination.summary) {
            reasons.push(destination.summary);
        }

        scored.push({ destinationId: id, score, reasons, name: destination.name || id });
    }

    return scored
        .sort((a, b) =>
            b.score - a.score
            || a.destinationId.localeCompare(b.destinationId)
        )
        .slice(0, limit)
        .map(({ destinationId, score, reasons }) => ({ destinationId, score, reasons }));
}

export function listPackages() {
    return search({ type: 'package' });
}

/** Aliases for chat-handler / route API surface */
export function searchCatalog(opts) {
    return search(opts);
}

export function getProduct(id) {
    return getById(id);
}

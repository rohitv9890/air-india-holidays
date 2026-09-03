import { displayProductTitle } from './display-title.js';

const RELATIONSHIP_PRIORITY = {
    'optional-addon': 50,
    'tier-upgrade': 45,
    extension: 35,
    alternative: 20,
};

export function catalogEnhancements(catalog, packageId, { destinations = [], limit = 4 } = {}) {
    const products = catalog?.products || [];
    const pkg = products.find((item) =>
        item.id === packageId
        && item.type === 'package'
        && item.status === 'active'
    );
    if (!pkg) return [];
    const destinationSet = new Set([...(pkg.destinations || []), ...destinations]);
    return (pkg.relationships || [])
        .map((relationship) => {
            const product = products.find((item) =>
                item.id === relationship.productId
                && item.status === 'active'
            );
            if (!product || !RELATIONSHIP_PRIORITY[relationship.type]) return null;
            const overlap = (product.destinations || []).filter((id) => destinationSet.has(id));
            if (!overlap.length) return null;
            return {
                id: product.id,
                title: displayProductTitle(product.name),
                summary: product.summary,
                productType: product.type,
                relationshipType: relationship.type,
                status: 'optional',
                reason: relationship.note || (overlap.length
                    ? `Relevant to ${overlap.map((id) => id.replace(/-/g, ' ')).join(', ')} on this trip`
                    : 'A catalogued option for this package'),
                price: Number(product.basePrice?.amount) > 0 ? product.basePrice : null,
                score: RELATIONSHIP_PRIORITY[relationship.type] + overlap.length * 5,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, Math.max(0, Math.min(Number(limit) || 4, 4)))
        .map(({ score, ...item }) => item);
}

export function toggleEnhancementId(selectedIds, productId) {
    const selected = new Set(selectedIds || []);
    if (selected.has(productId)) selected.delete(productId);
    else selected.add(productId);
    return [...selected];
}

export const READY_MADE_PATH_LABEL = 'Ready-made';
export const READY_MADE_PATH_INTRO =
    'We have some ready-made packages with great value.';
export const READY_MADE_CROSS_SELL_INTRO =
    'We also have ready-made packages with great value.';
export const LEGACY_READY_MADE_INTRO =
    'Or pick from one of our most popular ready-made itineraries:';
export const LEGACY_READY_MADE_ALSO_INTRO =
    'We also have a range of ready-made tours that offer great value.';
export const TAILOR_MADE_PATH_LABEL = 'Tailor-made';
export const TAILOR_MADE_PATH_INTRO =
    'Or we can create a tailor-made package for your exact requirements.';
export const TAILOR_MADE_PATH_READY =
    'Or open the tailor-made package we built for your exact requirements.';

export function resolveReadyMadeIntro(intro) {
    if (!intro || intro === LEGACY_READY_MADE_INTRO || intro === LEGACY_READY_MADE_ALSO_INTRO) {
        return READY_MADE_PATH_INTRO;
    }
    return intro;
}

export function itineraryCtaMessage(itineraryId, itinerary = null) {
    const built = Boolean(itineraryId);
    return {
        role: 'assistant',
        type: 'itinerary_cta',
        content: built ? 'View itinerary' : 'Build my itinerary',
        pathLabel: TAILOR_MADE_PATH_LABEL,
        pathIntro: built ? TAILOR_MADE_PATH_READY : TAILOR_MADE_PATH_INTRO,
        itineraryId: itineraryId || '',
        summary: itinerary ? {
            title: displayProductTitle(itinerary.title),
            days: itinerary.days?.length || itinerary.duration?.days,
            price: itinerary.price || (itinerary.quote ? {
                amount: itinerary.quote.perPersonAmount
                    ?? itinerary.quote.totalAmount
                    ?? itinerary.quote.gbp,
                currency: itinerary.quote.currency || 'GBP',
                basis: itinerary.quote.perPersonAmount != null ? 'per-person' : 'total-party',
            } : null),
        } : {},
    };
}

export function hasItineraryCta(messages, itineraryId) {
    return (messages || []).some((message) =>
        message.type === 'itinerary_cta'
        && (!itineraryId || message.itineraryId === itineraryId)
    );
}

const ITINERARY_ACTION_CHIPS = new Set(['Build my itinerary', 'View itinerary']);

export function isItineraryActionChip(label) {
    return ITINERARY_ACTION_CHIPS.has(String(label || '').trim());
}

export function shouldShowItineraryActionChip(messages) {
    return !hasItineraryCta(messages);
}

export function compactQuoteSummary(quote) {
    if (!quote) return null;
    return {
        totalAmount: quote.totalAmount,
        currency: quote.currency || 'GBP',
        lines: (quote.lineItems || quote.breakdown || []).map((line) => ({
            productId: line.productId,
            name: line.name || line.productId,
            status: line.status || 'priced',
            amount: line.amount ?? (quote.currency === 'EUR' ? line.eur : quote.currency === 'ZAR' ? line.zar : line.gbp),
            currency: line.currency || quote.currency || 'GBP',
            priceDelta: line.priceDelta,
            reason: line.reason,
        })),
    };
}

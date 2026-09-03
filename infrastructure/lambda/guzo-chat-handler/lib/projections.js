import {
    amountInCurrency,
    formatDisplayPrice,
    normalizeDisplayCurrency,
} from './display-currency.js';
import { displayProductTitle } from './display-title.js';

const INTERNAL_KEYS = new Set([
    'fx',
    'easygds',
    'handoff',
    'basePrice',
    'availabilitySeed',
    'seed',
    'breakdown',
    'tierMultiplier',
    'cabinMultiplier',
    'seasonalMultiplier',
    'childFactor',
    'basePerPersonGbp',
    'baseUnitGbp',
]);

export function projectCatalogResultsForModel(items = [], { currency } = {}) {
    const displayCurrency = normalizeDisplayCurrency(currency);
    return (items || []).slice(0, 4).map((item) => {
        const explicitAmount = Number(item.priceFrom);
        const hasExplicitDisplayPrice = item.priceFrom != null
            && Boolean(item.currency)
            && Number.isFinite(explicitAmount);
        const sourceAmount = Number(item.basePrice?.amount);
        const hasSourceAmount = item.basePrice?.amount != null && Number.isFinite(sourceAmount);
        const sourceCurrency = String(item.basePrice?.currency || 'GBP').toUpperCase();
        const canDisplaySourcePrice = hasSourceAmount
            && (sourceCurrency === 'GBP' || sourceCurrency === displayCurrency);
        const priceFrom = hasExplicitDisplayPrice
            ? item.priceFrom
            : (canDisplaySourcePrice
                ? (sourceCurrency === displayCurrency
                    ? item.basePrice.amount
                    : amountInCurrency(sourceAmount, displayCurrency))
                : null);
        const projectedCurrency = hasExplicitDisplayPrice
            ? item.currency
            : (canDisplaySourcePrice ? displayCurrency : null);
        const hasDisplayPrice = priceFrom != null && projectedCurrency;
        return {
            id: item.id,
            name: displayProductTitle(item.name || item.title),
            type: item.type,
            durationDays: item.duration?.days ?? null,
            tier: item.tier || null,
            destinations: item.destinations || [],
            summary: item.summary || item.meta || null,
            priceFrom: hasDisplayPrice ? priceFrom : null,
            currency: hasDisplayPrice ? projectedCurrency : null,
            formattedPrice: hasDisplayPrice
                ? (item.formattedPrice || formatDisplayPrice(priceFrom, projectedCurrency))
                : null,
            priceBasis: hasDisplayPrice ? (item.priceBasis || item.basis || item.basePrice?.basis || null) : null,
        };
    });
}

export function projectQuoteForModel(quote) {
    if (!quote) return null;
    const hasTotal = quote.totalAmount != null;
    return {
        currency: quote.currency,
        totalAmount: quote.totalAmount,
        formattedTotal: quote.formattedTotal
            || (hasTotal ? formatDisplayPrice(quote.totalAmount, quote.currency) : null),
        lineItems: (quote.lineItems || []).map((line) => ({
            name: line.name,
            status: line.status,
            amount: line.amount,
            currency: line.currency,
            reason: line.reason || null,
        })),
        available: quote.available,
        availabilityNote: quote.availabilityNote || null,
    };
}

export function projectItineraryForModel(itinerary, warnings = []) {
    if (!itinerary) return null;
    const displayCurrency = itinerary.quote?.currency || itinerary.quote?.displayCurrency;
    const hasTotal = itinerary.quote?.totalAmount != null;
    const stops = [];
    const seen = new Set();
    for (const day of itinerary.days || []) {
        const id = day.destinationId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const count = (itinerary.days || []).filter((entry) => entry.destinationId === id).length;
        stops.push({ destinationId: id, days: count });
    }
    return {
        id: itinerary.id,
        title: displayProductTitle(itinerary.title),
        durationDays: itinerary.days?.length || itinerary.duration?.days || null,
        stops,
        summary: itinerary.summary || null,
        warnings: Array.isArray(warnings) ? warnings : [],
        displayPrice: itinerary.quote
            ? {
                currency: displayCurrency,
                totalAmount: itinerary.quote.totalAmount,
                formattedTotal: itinerary.quote.formattedTotal
                    || (hasTotal ? formatDisplayPrice(itinerary.quote.totalAmount, displayCurrency) : null),
            }
            : null,
        shebaMiles: itinerary.milesEstimate?.shebaMiles
            ? `miles you could earn: ${itinerary.milesEstimate.shebaMiles}`
            : null,
        availabilityNote: itinerary.availability?.note || itinerary.quote?.availabilityNote || null,
    };
}

export function projectEnhancementsForModel(items = []) {
    return (items || []).map((item) => ({
        id: item.id,
        title: displayProductTitle(item.title),
        kind: item.kind,
        status: item.status,
        reason: item.reason,
        price: item.price
            ? {
                amount: item.price.amount,
                currency: item.price.currency,
                formatted: item.price.formatted || null,
            }
            : null,
    }));
}

export function formatItineraryReadyReply(result) {
    const itinerary = result?.itinerary;
    const title = displayProductTitle(itinerary?.title) || 'your Ethiopia holiday';
    const warnings = result?.warnings || itinerary?.warnings || [];
    if (!warnings.length) {
        return `Your itinerary is ready — ${title}. Open it to see your day-by-day plan.`;
    }
    const first = warnings[0];
    const warningText = typeof first === 'string'
        ? first
        : (first.message || first.reason || 'one stay needs a small adjustment');
    return `Your itinerary is ready — ${title}. Open it to see your day-by-day plan. ${warningText} If you like, I can adjust that stop.`;
}

export function assertNoInternalFields(value, path = 'root') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (INTERNAL_KEYS.has(key)) {
            throw new Error(`internal field leaked at ${path}.${key}`);
        }
        if (child && typeof child === 'object') {
            assertNoInternalFields(child, `${path}.${key}`);
        }
    }
}

export function stripInternalFieldsForModel(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stripInternalFieldsForModel(item));
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !INTERNAL_KEYS.has(key))
            .map(([key, child]) => [key, stripInternalFieldsForModel(child)]),
    );
}

/**
 * Air India Holidays itineraries include international flights on Air India.
 * Catalog imports and older fixtures still list them as exclusions; normalize at the edge.
 */

export const INTERNATIONAL_FLIGHTS_INCLUDED = 'International flights';

const INTL_FLIGHTS_ONLY = /^international flights?(?:\s*\([^)]*\))?$/i;
const INTL_FLIGHTS_AND_REST = /^international flights?\s+and\s+(.+)$/i;
const INTL_FLIGHTS_PREFIX = /^international flights?\b/i;

function text(item) {
    return String(item || '').trim();
}

function titleCaseRemainder(value) {
    const rest = text(value);
    if (!rest) return rest;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function isInternationalFlightsExclusion(item) {
    const value = text(item);
    return INTL_FLIGHTS_ONLY.test(value) || INTL_FLIGHTS_AND_REST.test(value);
}

export function includesInternationalFlights(items = []) {
    return (items || []).some((item) => INTL_FLIGHTS_PREFIX.test(text(item)));
}

export function withInternationalFlightsIncluded(inclusions = [], exclusions = []) {
    const nextExclusions = [];
    for (const item of exclusions || []) {
        const value = text(item);
        if (INTL_FLIGHTS_ONLY.test(value)) continue;
        const combined = value.match(INTL_FLIGHTS_AND_REST);
        if (combined) {
            nextExclusions.push(titleCaseRemainder(combined[1]));
            continue;
        }
        nextExclusions.push(item);
    }

    const nextInclusions = includesInternationalFlights(inclusions)
        ? [...(inclusions || [])]
        : [INTERNATIONAL_FLIGHTS_INCLUDED, ...(inclusions || [])];

    return {
        inclusions: nextInclusions,
        exclusions: nextExclusions,
    };
}

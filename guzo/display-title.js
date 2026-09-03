/**
 * Traveler-facing titles. Keep this file byte-identical with guzo/display-title.js.
 *
 * Catalog names may include operator SKUs such as "(GR03)". Those stay in the
 * data; strip them before any card, itinerary, or model-facing title.
 */

const SKU_TOKEN = String.raw`[A-Z]{1,6}(?:[-_][A-Z0-9]{1,8})?\d{1,5}[A-Z]?`;
const PACKAGE_ID_TOKEN = String.raw`pkg-[a-z0-9-]+`;
const CODE_GROUP = `(?:${SKU_TOKEN}|${PACKAGE_ID_TOKEN})`;

const TAJ_HOLIDAYS = new Set(['udaipur', 'jaipur', 'hyderabad', 'kochi', 'goa', 'agra', 'maldives']);
const CRICKET_WORLD_CUP = new Set(['cape-town', 'durban', 'centurion', 'gqeberha', 'johannesburg']);
const KNOWN_TIERS = new Set(['classic', 'comfort', 'signature']);

function titleCaseDest(id) {
    return String(id || '')
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function uniqueDestinations(destinations = []) {
    const seen = new Set();
    const ids = [];
    for (const value of destinations) {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

export function stripProductCodes(name) {
    if (name == null || name === '') return '';
    return String(name)
        .replace(new RegExp(String.raw`\s*[\(\[]\s*${CODE_GROUP}\s*[\)\]]`, 'gi'), '')
        .replace(new RegExp(String.raw`\s*[-–—]\s*${CODE_GROUP}\s*$`, 'gi'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function displayProductTitle(name) {
    return stripProductCodes(name);
}

export function inferTripFocus(destinations = []) {
    const ids = uniqueDestinations(destinations);
    const tajHits = ids.filter((id) => TAJ_HOLIDAYS.has(id));
    const cricketHits = ids.filter((id) => CRICKET_WORLD_CUP.has(id));

    if (tajHits.length && cricketHits.length) {
        return 'India highlights';
    }
    if (tajHits.length >= 3) return 'Golden Triangle circuit';
    if (cricketHits.length >= 3) return 'Cricket World Cup circuit';

    const named = ids.map(titleCaseDest);
    if (named.length === 1) return named[0];
    if (named.length === 2) return `${named[0]} and ${named[1]}`;
    return 'India itinerary';
}

function isFamilyTrip({ children = 0, interests = [], family = false } = {}) {
    if (family) return true;
    if (Number(children) > 0) return true;
    return (Array.isArray(interests) ? interests : [interests])
        .some((value) => /\bfamily\b/i.test(String(value || '')));
}

/**
 * Title for a composed itinerary from the trip itself, not the source SKU.
 * Example: "Classic 10-day family Golden Triangle circuit"
 */
export function composeItineraryTitle({
    durationDays,
    tier,
    destinations = [],
    children = 0,
    interests = [],
    family = false,
} = {}) {
    const days = Number(durationDays);
    const dayPart = Number.isFinite(days) && days > 0 ? `${days}-day` : '';
    const tierKey = String(tier || '').trim().toLowerCase();
    const tierPart = KNOWN_TIERS.has(tierKey)
        ? tierKey.charAt(0).toUpperCase() + tierKey.slice(1)
        : '';
    const familyPart = isFamilyTrip({ children, interests, family }) ? 'family' : '';
    const focus = inferTripFocus(destinations);
    return [tierPart, dayPart, familyPart, focus].filter(Boolean).join(' ');
}

/**
 * Traveler-facing titles. Keep this file byte-identical with guzo/display-title.js.
 *
 * Catalog names may include operator SKUs such as "(GR03)". Those stay in the
 * data; strip them before any card, itinerary, or model-facing title.
 */

const SKU_TOKEN = String.raw`[A-Z]{1,6}(?:[-_][A-Z0-9]{1,8})?\d{1,5}[A-Z]?`;
const PACKAGE_ID_TOKEN = String.raw`pkg-[a-z0-9-]+`;
const CODE_GROUP = `(?:${SKU_TOKEN}|${PACKAGE_ID_TOKEN})`;

const NORTHERN = new Set(['bahir-dar', 'gondar', 'simien', 'lalibela', 'axum']);
const SOUTHERN = new Set(['omo-valley', 'arba-minch']);
const RIFT = new Set([
    'rift-valley-lakes',
    'hawassa',
    'ziway',
    'bishoftu',
    'abijatta-shalla',
    'yirgacheffe',
    'adama',
]);
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
    const northHits = ids.filter((id) => NORTHERN.has(id));
    const southHits = ids.filter((id) => SOUTHERN.has(id));
    const riftHits = ids.filter((id) => RIFT.has(id));

    if (northHits.length >= 3 && (southHits.length || riftHits.length)) {
        return 'Ethiopia highlights';
    }
    if (northHits.length >= 3) return 'northern circuit';
    if (southHits.length && northHits.length === 0) return 'southern Ethiopia';
    if (riftHits.length && northHits.length === 0 && southHits.length === 0) {
        return 'Rift Valley';
    }

    const named = ids.map(titleCaseDest);
    if (named.length === 1) return named[0];
    if (named.length === 2) return `${named[0]} and ${named[1]}`;
    return 'Ethiopia itinerary';
}

function isFamilyTrip({ children = 0, interests = [], family = false } = {}) {
    if (family) return true;
    if (Number(children) > 0) return true;
    return (Array.isArray(interests) ? interests : [interests])
        .some((value) => /\bfamily\b/i.test(String(value || '')));
}

/**
 * Title for a composed itinerary from the trip itself, not the source SKU.
 * Example: "Classic 10-day family Ethiopia highlights"
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

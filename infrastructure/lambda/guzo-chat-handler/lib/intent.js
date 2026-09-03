/** Intent schema aligned with guzo/guzo-intent.js (+ package-planning fields) */

import { normalizeDestination } from './catalog.js';
import { normalizeTravelDate, normalizeTravelDates } from './dates.js';
import { parseStayPlanFromPreferences, stayPlanDays } from './stay-plan.js';

const PACKAGE_FIELDS = {
    interests: [],
    durationDays: null,
    pace: null,
    tier: null,
    budget: null,
    preferences: null,
    stayPlan: null,
    packageId: null,
    itineraryId: null,
    selectedAddOnIds: [],
};

/** Canonicalize tool/session stayPlan entries to catalog slugs; drop unknown stops. */
function sanitizeStayPlan(value) {
    if (value === undefined) return undefined;
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    const plan = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const destinationId = normalizeDestination(entry.destinationId);
        const days = Number(entry.days);
        if (!destinationId || !Number.isFinite(days) || days < 1) continue;
        plan.push({ destinationId, days: Math.floor(days) });
    }
    return plan.length ? plan : null;
}

function parseCalendarDate(dateStr) {
    const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }
    return { date, dayNumber: Math.floor(time / 86_400_000) };
}

function addDays(dateStr, days) {
    const parsed = parseCalendarDate(dateStr);
    if (!parsed) return null;
    const date = parsed.date;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function inclusiveDays(startStr, endStr) {
    const start = parseCalendarDate(startStr);
    const end = parseCalendarDate(endStr);
    if (!start || !end || end.dayNumber < start.dayNumber) return null;
    return end.dayNumber - start.dayNumber + 1;
}

export function createEmptyIntent(tab) {
    return {
        productTab: tab,
        origin: null,
        destination: null,
        pickup: null,
        dropoff: null,
        dates: { start: null, end: null },
        pickupDate: null,
        pickupTime: null,
        travelers: { adults: null, children: 0, childAges: [], infants: 0, rooms: null },
        cabin: null,
        cabinSource: null,
        roundTrip: true,
        ...structuredClone(PACKAGE_FIELDS),
    };
}

function mergePackageFields(intent, update) {
    if (update.interests != null) {
        intent.interests = Array.isArray(update.interests)
            ? update.interests.map(String).filter(Boolean)
            : [];
    }
    if (update.durationDays !== undefined) {
        intent.durationDays = update.durationDays == null ? null : Number(update.durationDays);
    }
    if (update.pace !== undefined) intent.pace = update.pace;
    if (update.tier !== undefined) intent.tier = update.tier;
    if (update.budget !== undefined) {
        if (update.budget == null) {
            intent.budget = null;
        } else {
            intent.budget = {
                amount: update.budget.amount ?? intent.budget?.amount ?? null,
                currency: update.budget.currency ?? intent.budget?.currency ?? 'GBP',
            };
        }
    }
    if (update.preferences !== undefined) intent.preferences = update.preferences;
    if (update.stayPlan !== undefined) intent.stayPlan = sanitizeStayPlan(update.stayPlan);
    if (update.packageId !== undefined) intent.packageId = update.packageId;
    if (update.itineraryId !== undefined) intent.itineraryId = update.itineraryId;
    if (update.selectedAddOnIds !== undefined) {
        intent.selectedAddOnIds = Array.isArray(update.selectedAddOnIds)
            ? [...new Set(update.selectedAddOnIds.map(String).filter(Boolean))]
            : [];
    }
}

export function mergeIntent(existing, update, tab) {
    const intent = existing ? structuredClone(existing) : createEmptyIntent(tab);
    for (const [k, v] of Object.entries(PACKAGE_FIELDS)) {
        if (intent[k] === undefined) intent[k] = structuredClone(v);
    }

    intent.productTab = tab || update?.productTab || intent.productTab;

    if (update?.origin) intent.origin = { ...(intent.origin || {}), ...update.origin };
    if (update?.destination) intent.destination = { ...(intent.destination || {}), ...update.destination };
    if (update?.pickup) intent.pickup = { ...(intent.pickup || {}), ...update.pickup };
    if (update?.dropoff) intent.dropoff = { ...(intent.dropoff || {}), ...update.dropoff };

    if (update?.dates) {
        const normalized = normalizeTravelDates({
            start: update.dates.start ?? intent.dates?.start ?? null,
            end: update.dates.end ?? intent.dates?.end ?? null,
        });
        intent.dates = {
            start: normalized.start,
            end: normalized.end,
        };
    }

    if (update?.pickupDate != null) {
        intent.pickupDate = normalizeTravelDate(update.pickupDate) || update.pickupDate;
    }
    if (update?.pickupTime != null) intent.pickupTime = update.pickupTime;
    if (update?.cabin != null) {
        intent.cabin = update.cabin;
        intent.cabinSource = 'user';
    }
    if (update?.roundTrip != null) intent.roundTrip = update.roundTrip;

    if (update?.travelers) {
        const t = intent.travelers || createEmptyIntent(tab).travelers;
        const s = update.travelers;
        if (s.adults != null) t.adults = s.adults;
        if (s.children != null) t.children = s.children;
        if (s.infants != null) t.infants = s.infants;
        if (s.rooms != null) t.rooms = s.rooms;
        if (s.childAges?.length) t.childAges = s.childAges;
        intent.travelers = t;
    }

    if (update) mergePackageFields(intent, update);

    if (
        update?.stayPlan === undefined
        && !(Array.isArray(intent.stayPlan) && intent.stayPlan.length)
    ) {
        const fromPreferences = parseStayPlanFromPreferences(intent.preferences);
        if (fromPreferences.length) intent.stayPlan = fromPreferences;
    }

    if (
        !(intent.durationDays > 0)
        && Array.isArray(intent.stayPlan)
        && intent.stayPlan.length
    ) {
        intent.durationDays = stayPlanDays(intent.stayPlan);
    }

    const hasExplicitDateRange = Boolean(update?.dates?.start && update?.dates?.end);
    if (hasExplicitDateRange) {
        const rangeDays = inclusiveDays(intent.dates.start, intent.dates.end);
        if (rangeDays) intent.durationDays = rangeDays;
    }

    const durationChangedWithoutExplicitEnd =
        update?.durationDays !== undefined && update?.dates?.end == null;
    if (
        intent.dates?.start
        && intent.durationDays > 0
        && (!intent.dates.end || durationChangedWithoutExplicitEnd)
    ) {
        intent.dates.end = addDays(intent.dates.start, intent.durationDays - 1);
    }

    return intent;
}

/**
 * Package planning completeness: origin, dates.start, travelers.adults,
 * and either destination or interests/durationDays.
 */
export function getPackageMissingFields(intent) {
    const missing = [];
    if (!intent?.origin?.name && !intent?.origin?.code) missing.push('origin');
    if (!intent?.dates?.start) missing.push('dates.start');
    if (intent?.travelers?.adults == null || intent.travelers.adults < 1) {
        missing.push('travelers.adults');
    }

    const hasDestination = !!(intent?.destination?.name || intent?.destination?.code);
    const hasInterests = Array.isArray(intent?.interests) && intent.interests.length > 0;
    const hasDuration = intent?.durationDays != null && intent.durationDays > 0;
    const hasStayPlan = Array.isArray(intent?.stayPlan) && intent.stayPlan.length > 0;
    if (!hasDestination && !(hasInterests || hasDuration || hasStayPlan)) {
        missing.push('destination|interests|durationDays');
    }

    return missing;
}

export function isPackageIntentComplete(intent) {
    return getPackageMissingFields(intent).length === 0;
}

function hasPlace(place) {
    return Boolean(place?.name || place?.code);
}

function missingCodesForTab(intent, tab) {
    const missing = [];
    if (tab === 'packages' || tab === 'flights') {
        if (!hasPlace(intent?.origin)) missing.push('origin');
        if (tab === 'flights' && !hasPlace(intent?.destination)) missing.push('destination');
        if (!intent?.dates?.start) missing.push('dates.start');
        if (intent?.travelers?.adults == null || intent.travelers.adults < 1) {
            missing.push('travelers.adults');
        }
        if (tab === 'packages') {
            const hasDestination = hasPlace(intent?.destination);
            const hasInterests = Array.isArray(intent?.interests) && intent.interests.length > 0;
            const hasDuration = intent?.durationDays != null && intent.durationDays > 0;
            const hasStayPlan = Array.isArray(intent?.stayPlan) && intent.stayPlan.length > 0;
            if (!hasDestination && !(hasInterests || hasDuration || hasStayPlan)) {
                missing.push('destination|interests|durationDays');
            }
        }
    }
    if (tab === 'hotels' || tab === 'tours') {
        if (!hasPlace(intent?.destination)) missing.push('destination');
        if (!intent?.dates?.start) missing.push('dates.start');
        if (!intent?.dates?.end) missing.push('dates.end');
        if (intent?.travelers?.adults == null || intent.travelers.adults < 1) {
            missing.push('travelers.adults');
        }
    }
    if (tab === 'transfers') {
        if (!hasPlace(intent?.pickup)) missing.push('pickup');
        if (!hasPlace(intent?.dropoff)) missing.push('dropoff');
        if (!intent?.pickupDate) missing.push('pickupDate');
    }
    return missing;
}

export function getMissingFieldsForAction(intent, { tab, action } = {}) {
    const activeTab = tab || intent?.productTab || 'packages';
    const missing = missingCodesForTab(intent, activeTab);
    if (action === 'search' && activeTab === 'packages') {
        return missing.filter((code) => code !== 'destination|interests|durationDays');
    }
    return missing;
}

export function getOperationalAssumptions(intent, { tab } = {}) {
    const assumptions = [];
    if (intent?.cabin == null) {
        assumptions.push({
            field: 'cabin',
            value: 'Economy',
            reason: 'No cabin preference supplied',
        });
    }
    if ((tab || intent?.productTab) === 'packages' && intent?.tier == null) {
        assumptions.push({
            field: 'tier',
            value: 'classic',
            reason: 'No travel style supplied',
        });
    }
    if (intent?.travelers?.rooms == null) {
        assumptions.push({
            field: 'rooms',
            value: 1,
            reason: 'No room count supplied',
        });
    }
    return assumptions;
}

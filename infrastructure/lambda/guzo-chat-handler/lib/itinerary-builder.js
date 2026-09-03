import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    getById,
    isSellableProduct,
    loadDestinations,
    normalizeDestination,
    normalizeImageUrl,
    rankPackagesForIntent,
    search,
} from './catalog.js';
import { composeItineraryTitle } from './display-title.js';
import { displayQuoteFromGbp, normalizeDisplayCurrency, quotePrice } from './pricing.js';
import { checkAvailability } from './availability.js';
import { findRoute, selectFlights, totalFlightGbp } from './flights.js';
import { estimateMiles } from './miles.js';
import { ideaForStayDay } from './day-content.js';
import { resolveItineraryStayPlan } from './stay-plan.js';
import {
    includesInternationalFlights,
    withInternationalFlightsIncluded,
} from './itinerary-inclusions.js';

export { buildStayPlan } from './stay-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PLANNER_FILE = join(__dirname, 'route-planner.js');
export const MIN_INTERNATIONAL_HOLIDAY_DAYS = 4;

export class MinimumDurationError extends Error {
    constructor(requestedDurationDays, minimumDurationDays = MIN_INTERNATIONAL_HOLIDAY_DAYS) {
        super(
            `${requestedDurationDays} days is too short for an Ethiopia holiday including international flights. `
            + `Allow at least ${minimumDurationDays} days for arrival, a usable land programme, and return travel.`,
        );
        this.name = 'MinimumDurationError';
        this.code = 'minimum-duration';
        this.requestedDurationDays = requestedDurationDays;
        this.minimumDurationDays = minimumDurationDays;
    }
}

/**
 * Stream B owns route-planner.js. Prefer catalogued journeys when present.
 */
let plannerResolveJourney = null;
try {
    if (existsSync(ROUTE_PLANNER_FILE)) {
        const mod = await import('./route-planner.js');
        plannerResolveJourney = typeof mod.resolveJourney === 'function'
            ? mod.resolveJourney
            : null;
    }
} catch {
    plannerResolveJourney = null;
}

function resolveCatalogFile(name) {
    const candidates = [
        process.env.CATALOG_DIR ? join(resolve(process.env.CATALOG_DIR), name) : null,
        join(__dirname, '../data/catalog/v1', name),
        join(__dirname, '../../../../data/catalog/v1', name),
    ].filter(Boolean);
    return candidates.find((p) => existsSync(p)) || null;
}

let connectionsCached = false;
let connectionsDoc = null;

function loadConnections() {
    if (connectionsCached) return connectionsDoc;
    connectionsCached = true;
    const path = process.env.CONNECTIONS_PATH
        ? resolve(process.env.CONNECTIONS_PATH)
        : resolveCatalogFile('connections.json');
    if (!path) {
        connectionsDoc = [];
        return connectionsDoc;
    }
    try {
        const doc = JSON.parse(readFileSync(path, 'utf8'));
        if (Array.isArray(doc)) connectionsDoc = doc;
        else if (Array.isArray(doc?.connections)) connectionsDoc = doc.connections;
        else connectionsDoc = [];
    } catch {
        connectionsDoc = [];
    }
    return connectionsDoc;
}

function destinationIataFromRegistry(destinationId) {
    const dests = loadDestinations().destinations || [];
    return dests.find((d) => d.id === destinationId)?.iata || null;
}

function journeyLoadFromHours(hours, consumes) {
    const tagged = String(consumes || '').toLowerCase().replace(/_/g, '-');
    if (tagged.includes('full-day') || tagged === 'full') return 'full-day';
    if (tagged.includes('half-day') || tagged === 'half') return 'half-day';
    if (tagged.includes('short') || tagged === 'light') return 'short';
    if (hours == null || !Number.isFinite(Number(hours))) return null;
    const n = Number(hours);
    if (n >= 6) return 'full-day';
    if (n >= 2.5) return 'half-day';
    return 'short';
}

function loadForMode(mode) {
    if (mode === 'flight') return 'half-day';
    if (mode === 'road') return 'half-day';
    return 'short';
}

/** Resolve a directed journey without assuming every custom leg is a flight. */
export function resolveJourney(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return null;

    if (plannerResolveJourney) {
        const planned = plannerResolveJourney(fromId, toId);
        if (planned?.path) {
            return {
                from: fromId,
                to: toId,
                mode: planned.mode || 'road',
                hours: Number.isFinite(planned.hours) ? planned.hours : null,
                load: planned.load || loadForMode(planned.mode),
                flightRouteId: planned.flightRouteId || null,
                transferId: planned.transferId || null,
            };
        }
    }

    const hit = loadConnections().find((c) => c.from === fromId && c.to === toId);
    if (hit) {
        const hours = hit.hours ?? hit.journeyHours ?? hit.totalHours ?? null;
        return {
            from: fromId,
            to: toId,
            mode: hit.mode || 'road',
            hours,
            load: journeyLoadFromHours(hours, hit.consumes || hit.journeyLoad || hit.load) || loadForMode(hit.mode),
            flightRouteId: hit.flightRouteId || null,
            transferId: hit.transferId || null,
        };
    }

    const fromIata = destinationIataFromRegistry(fromId);
    const toIata = destinationIataFromRegistry(toId);
    if (!fromIata || !toIata || fromIata === toIata) {
        return {
            from: fromId,
            to: toId,
            mode: 'road',
            hours: null,
            load: 'half-day',
        };
    }

    const flight = findRoute(fromIata, toIata);
    if (flight) {
        return {
            from: fromId,
            to: toId,
            mode: 'flight',
            hours: flight.durationHours ?? null,
            load: 'half-day',
            flightRouteId: flight.id,
            transferId: null,
        };
    }

    return {
        from: fromId,
        to: toId,
        mode: 'road',
        hours: null,
        load: 'full-day',
    };
}

function internationalArrival(originIata, destId) {
    if (!originIata || !destId) return null;
    return {
        from: originIata,
        to: destId,
        mode: 'flight',
        hours: null,
        load: 'half-day',
        kind: 'international',
    };
}

function journeyForLeg(fromId, toId, transportHint) {
    const resolved = resolveJourney(fromId, toId);
    if (resolved) {
        if (transportHint && transportHint !== resolved.mode) {
            return { ...resolved, mode: transportHint, load: resolved.load || loadForMode(transportHint) };
        }
        return resolved;
    }
    if (transportHint) {
        return {
            from: fromId,
            to: toId,
            mode: transportHint,
            hours: null,
            load: loadForMode(transportHint),
        };
    }
    return null;
}

function destinationMedia(destinationId) {
    if (!destinationId) return { image: '', imageAlt: '' };
    const product = getById(`dest-${destinationId}`)
        || search({ type: 'destination', destination: destinationId })[0]
        || null;
    const img = product?.images?.[0];
    return {
        image: normalizeImageUrl(img?.url || ''),
        imageAlt: img?.alt || product?.name || destinationId.replace(/-/g, ' '),
    };
}

function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function pickStay(destinationId, tier) {
    const stays = search({ type: 'accommodation', destination: destinationId });
    if (!stays.length) return null;
    return stays.find((s) => s.tier === tier) || stays[0];
}

function pickTransfers(destinationId) {
    return search({ type: 'transfer', destination: destinationId }).slice(0, 1).map((t) => t.id);
}

function templateForDay(pkg, dayNum) {
    return (pkg?.dayTemplates || []).find((t) => t.day === dayNum) || null;
}

/** Occupancy nights from a calendar-day allocation. */
export function nightsForAllocatedDays(days, isFinal) {
    const d = Math.max(Number(days) || 0, 0);
    return isFinal ? Math.max(d - 1, 0) : d;
}

/** Calendar days from package occupancy nights. */
export function calendarDaysForNights(nights, isFinal) {
    const n = Math.max(Number(nights) || 0, 0);
    return isFinal ? n + 1 : Math.max(n, 1);
}

function composeStayDay({
    destId,
    dayNum,
    date,
    stayIndex,
    stayLength,
    tier,
    journey,
    moduleId,
    templateExperienceIds,
    includeTransfer,
}) {
    const idea = ideaForStayDay(
        destId,
        stayIndex,
        stayLength,
        stayIndex === 0 ? (journey?.load || null) : null,
        { moduleId },
    );
    const destMedia = destinationMedia(destId);
    const image = normalizeImageUrl(idea.image || destMedia.image || '');
    const imageAlt = idea.imageAlt || destMedia.imageAlt || idea.title;
    const stay = pickStay(destId, tier);
    const experienceIds = idea.experienceIds?.length
        ? idea.experienceIds
        : (Array.isArray(templateExperienceIds) ? templateExperienceIds.filter(Boolean) : []);

    const day = {
        day: dayNum,
        date,
        title: idea.title,
        destinationId: destId,
        summary: idea.summary,
        description: idea.summary,
        highlights: idea.highlights || [],
        image,
        imageAlt,
        moduleId: idea.moduleId || moduleId || null,
        experienceIds,
        accommodationId: stay?.id || null,
        transferIds: includeTransfer ? pickTransfers(destId) : [],
    };
    if (stayIndex === 0 && journey) day.journey = journey;
    return day;
}

function routeFromStayPlan(plan) {
    return (plan || []).map((stop, i) => {
        const isLast = i === plan.length - 1;
        const next = plan[i + 1];
        const journey = next ? resolveJourney(stop.destinationId, next.destinationId) : null;
        return {
            sequence: i + 1,
            destinationId: stop.destinationId,
            days: stop.days,
            nights: nightsForAllocatedDays(stop.days, isLast),
            transportToNext: isLast ? null : (journey?.mode || null),
        };
    });
}

function expandStayPlanDays(plan, { startDate, tier, originIata, pkg = null }) {
    const days = [];
    let dayNum = 1;
    let cursor = startDate;
    for (let s = 0; s < plan.length; s += 1) {
        const stop = plan[s];
        const stayLength = stop.days;
        const prev = s > 0 ? plan[s - 1] : null;
        const journey = prev
            ? journeyForLeg(prev.destinationId, stop.destinationId)
            : internationalArrival(originIata, stop.destinationId);
        for (let i = 0; i < stayLength; i += 1) {
            const template = templateForDay(pkg, dayNum);
            days.push(composeStayDay({
                destId: stop.destinationId,
                dayNum,
                date: cursor,
                stayIndex: i,
                stayLength,
                tier,
                journey,
                moduleId: template?.moduleId,
                templateExperienceIds: template?.experienceIds,
                includeTransfer: dayNum === 1 || i === 0,
            }));
            dayNum += 1;
            cursor = addDays(cursor, 1);
        }
    }
    return days;
}

function staySpansFromRoute(route, totalDays) {
    const spans = route.map((stop, i) => calendarDaysForNights(stop.nights, i === route.length - 1));
    let sum = spans.reduce((n, x) => n + x, 0);
    if (totalDays && sum < totalDays && spans.length) {
        spans[spans.length - 1] += totalDays - sum;
        sum = totalDays;
    }
    if (totalDays && sum > totalDays) {
        let extra = sum - totalDays;
        for (let i = spans.length - 1; i >= 0 && extra > 0; i -= 1) {
            const take = Math.min(extra, Math.max(spans[i] - 1, 0));
            spans[i] -= take;
            extra -= take;
        }
    }
    return spans;
}

function expandPackageRouteDays(pkg, startDate, totalDaysOverride, originIata) {
    const route = pkg.route?.length
        ? pkg.route
        : [{
            sequence: 1,
            destinationId: pkg.destinations[0],
            nights: Math.max((pkg.duration?.nights || 1), 1),
            transportToNext: null,
        }];

    const totalDays = totalDaysOverride || pkg.duration?.days || null;
    const spans = staySpansFromRoute(route, totalDays);
    const days = [];
    let dayNum = 1;
    let cursor = startDate;

    for (let s = 0; s < route.length; s += 1) {
        const stop = route[s];
        const stayLength = spans[s] || 0;
        const prev = s > 0 ? route[s - 1] : null;
        const journey = prev
            ? journeyForLeg(prev.destinationId, stop.destinationId, prev.transportToNext)
            : internationalArrival(originIata, stop.destinationId);
        for (let i = 0; i < stayLength; i += 1) {
            const template = templateForDay(pkg, dayNum);
            days.push(composeStayDay({
                destId: stop.destinationId,
                dayNum,
                date: cursor,
                stayIndex: i,
                stayLength,
                tier: pkg.tier,
                journey,
                moduleId: template?.moduleId,
                templateExperienceIds: template?.experienceIds,
                includeTransfer: dayNum === 1 || i === 0,
            }));
            dayNum += 1;
            cursor = addDays(cursor, 1);
        }
    }

    return totalDays ? days.slice(0, totalDays) : days;
}

function buildStays(days) {
    const groups = [];
    for (const day of days) {
        const last = groups[groups.length - 1];
        if (
            last
            && last.destinationId === day.destinationId
            && last.accommodationId === day.accommodationId
        ) {
            last.days.push(day);
        } else {
            groups.push({
                destinationId: day.destinationId,
                accommodationId: day.accommodationId,
                days: [day],
            });
        }
    }

    const stays = [];
    for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        if (!group.accommodationId) continue;
        const isLast = i === groups.length - 1;
        const nights = nightsForAllocatedDays(group.days.length, isLast);
        if (nights <= 0) continue;
        const acc = getById(group.accommodationId);
        const checkIn = group.days[0].date;
        const checkOut = addDays(checkIn, nights);
        stays.push({
            accommodationId: group.accommodationId,
            name: acc?.name || group.accommodationId,
            destinationId: group.destinationId,
            checkIn,
            checkOut,
            nights,
            tier: acc?.tier || null,
        });
    }
    return stays;
}

function chargeableFlights(pkg, flights, economyFlights) {
    const inclusions = pkg.inclusions || [];
    const internationalIncluded = includesInternationalFlights(inclusions);
    const domesticIncluded = inclusions.some((item) => /\b(?:all\s+)?domestic flights?\b/i.test(String(item)));
    const economyByRoute = new Map((economyFlights || []).map((flight) => [
        `${flight.routeId}:${flight.direction}`,
        flight.baseFareGbp,
    ]));

    return flights.map((flight) => {
        const included = flight.direction === 'domestic'
            ? domesticIncluded
            : internationalIncluded;
        if (!included) return flight;

        const economyFare = economyByRoute.get(`${flight.routeId}:${flight.direction}`)
            ?? flight.baseFareGbp;
        return {
            ...flight,
            baseFareGbp: Math.max(flight.baseFareGbp - economyFare, 0),
        };
    });
}

/**
 * Compose a multi-day itinerary from a package template + traveler intent.
 * Honors requested durationDays / stay preferences for bespoke plans when the
 * catalog package length does not match (e.g. 6-day Addis + Lalibela).
 */
export function buildItinerary(intent = {}) {
    const {
        packageId: packageIdIn,
        origin,
        originIata,
        startDate,
        endDate,
        adults,
        children = 0,
        childAges = [],
        cabin = 'Economy',
        tier,
        destination,
        durationDays: durationHint,
        currency,
        preferences,
        interests,
        stayPlan: stayPlanIn,
        bespoke,
    } = intent;

    let packageId = packageIdIn;
    if (!packageId) {
        packageId = rankPackagesForIntent({
            destination: normalizeDestination(destination),
            durationDays: durationHint,
            tier,
            interests,
        }, { limit: 1 })[0]?.id;
    }
    packageId = packageId || 'pkg-northern-historic-7d';

    const originCode = String(originIata || origin || '').toUpperCase() || null;
    if (!originCode) {
        throw new Error('origin is required');
    }
    if (!startDate) {
        throw new Error('startDate is required');
    }
    if (adults == null || !Number.isFinite(Number(adults)) || Number(adults) < 1) {
        throw new Error('adults is required');
    }
    const displayCurrency = normalizeDisplayCurrency(currency, originCode);

    const pkg = getById(packageId, { includeNonActive: true });
    if (!pkg || pkg.type !== 'package') {
        throw new Error(`Unknown package: ${packageId}`);
    }
    if (!isSellableProduct(pkg)) {
        throw new Error(`Package not sellable (status=${pkg.status || 'unknown'}): ${packageId}`);
    }

    const pkgDays = pkg.duration?.days || 7;
    const requestedDays = Number(durationHint) > 0 ? Number(durationHint) : null;
    const resolved = resolveItineraryStayPlan({
        stayPlan: stayPlanIn,
        preferences,
        interests,
        destination,
        originIata: originCode,
        pkg,
        requestedDays,
        bespoke,
    });
    const stayPlan = resolved.stayPlan;
    const wantsBespoke = resolved.wantsBespoke;

    const durationDays = wantsBespoke && requestedDays ? requestedDays : (requestedDays || pkgDays);
    if (originCode !== 'ADD' && durationDays < MIN_INTERNATIONAL_HOLIDAY_DAYS) {
        throw new MinimumDurationError(durationDays);
    }
    const start = startDate;
    const end = endDate || addDays(start, durationDays - 1);
    const chosenTier = (wantsBespoke ? (tier || pkg.tier) : (pkg.tier || tier)) || 'comfort';
    const durationNights = Math.max(durationDays - 1, 0);

    const template = wantsBespoke && stayPlan?.length
        ? {
            ...pkg,
            summary: stayPlan
                .map((s) => `${s.days} day${s.days === 1 ? '' : 's'} in ${s.destinationId.replace(/-/g, ' ')}`)
                .join(', '),
            duration: { days: durationDays, nights: durationNights },
            destinations: stayPlan.map((s) => s.destinationId),
            route: routeFromStayPlan(stayPlan),
            tier: chosenTier,
            dayTemplates: [],
        }
        : {
            ...pkg,
            duration: { days: durationDays, nights: durationNights },
            tier: chosenTier,
        };
    const title = composeItineraryTitle({
        durationDays,
        tier: chosenTier,
        destinations: template.destinations,
        children,
        interests,
    });

    const days = wantsBespoke && stayPlan?.length
        ? expandStayPlanDays(stayPlan, {
            startDate: start,
            tier: chosenTier,
            originIata: originCode,
        })
        : expandPackageRouteDays(template, start, durationDays, originCode);
    const stays = buildStays(days);
    const routeStops = template.route?.map((r) => r.destinationId) || template.destinations;
    const flightSelection = {
        originIata: originCode,
        routeStops,
        startDate: start,
        durationDays,
    };
    const flights = selectFlights({ ...flightSelection, cabin });
    const economyFlights = cabin === 'Economy'
        ? flights
        : selectFlights({ ...flightSelection, cabin: 'Economy' });

    const flightGbp = totalFlightGbp(chargeableFlights(pkg, flights, economyFlights))
        * Math.max(adults + children * 0.7, 1);
    const quote = quotePrice({
        productId: packageId,
        startDate: start,
        adults,
        children,
        cabin,
        tier: chosenTier,
        cabinMultiplier: 1,
        flightGbp,
    });

    const availability = checkAvailability(packageId, start, adults);
    quote.available = availability.available;
    quote.availabilityNote = availability.note;
    Object.assign(quote, displayQuoteFromGbp(quote.gbp, displayCurrency));
    const perPersonDisplay = displayQuoteFromGbp(quote.perPersonGbp, displayCurrency);
    quote.perPersonAmount = perPersonDisplay.totalAmount;
    quote.formattedPerPerson = perPersonDisplay.formattedTotal;

    const milesEstimate = estimateMiles({
        totalGbp: quote.gbp,
        totalAmount: quote.gbp,
        currency: 'GBP',
        cabin,
        tier: chosenTier,
    });

    const hotelIds = stays.map((s) => getById(s.accommodationId)?.easygds?.hotelId).filter(Boolean);

    const heroImage = normalizeImageUrl(pkg.images?.[0]?.url || days[0]?.image || '');
    const itineraryIdBase = wantsBespoke
        ? `itin-custom-${durationDays}d-${start}-${originCode}`
        : `itin-${packageId}-${start}-${originCode}`;
    const { inclusions, exclusions } = withInternationalFlightsIncluded(
        pkg.inclusions || [],
        pkg.exclusions || [],
    );

    return {
        id: itineraryIdBase.toLowerCase(),
        packageId: wantsBespoke ? null : packageId,
        sourcePackageId: packageId,
        bespoke: wantsBespoke,
        title,
        summary: template.summary,
        heroImage,
        origin: originCode,
        originIata: originCode,
        startDate: start,
        dates: { start, end },
        travelers: { adults, children, childAges },
        adults,
        children,
        cabin,
        tier: chosenTier,
        destinations: template.destinations,
        themes: pkg.themes,
        duration: { days: durationDays, nights: durationNights },
        route: template.route || [],
        days,
        flights,
        stays,
        inclusions,
        exclusions,
        quote,
        milesEstimate,
        availability,
        easygds: {
            packageId: pkg.easygds?.packageId || null,
            placeId: pkg.easygds?.placeId || null,
            hotelIds,
            flightConfigId: pkg.easygds?.flightConfigId || 'et-pkg',
            handoff: {
                process: 'bundle',
                origin: originCode,
                startPlaceCode: originCode,
                desCode: pkg.easygds?.placeId || 'ADD',
                flCabinClass: cabin,
                flDepartureDate: start,
                flReturnDate: end,
                adults,
                children,
                productCode: pkg.easygds?.productCode || packageId,
            },
        },
    };
}

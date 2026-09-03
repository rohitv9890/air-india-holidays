import { loadDestinations, normalizeDestination } from './catalog.js';
import { planRoute, resolveJourney } from './route-planner.js';

const HOURS_PER_ALLOCATED_DAY = 12;

function labelDestination(destinationId) {
    return String(destinationId || '').replace(/-/g, ' ');
}

/** True when two catalog stops share a connection path, including hub transfers. */
export function destinationsConnected(fromId, toId, opts = {}) {
    if (!fromId || !toId || fromId === toId) return true;
    const journey = resolveJourney(fromId, toId, opts);
    return Array.isArray(journey?.path);
}

/**
 * Feasibility checks for a structured stay plan.
 * Missing connections or journeys longer than the stay allocation are blocking.
 * Min-stay and stop-count findings remain warnings.
 */
export function validateStayPlan(stayPlan, opts = {}) {
    const warnings = [];
    const errors = [];
    const plan = (Array.isArray(stayPlan) ? stayPlan : [])
        .map((stop) => ({
            destinationId: normalizeDestination(stop?.destinationId) || String(stop?.destinationId || ''),
            days: Number(stop?.days),
        }))
        .filter((stop) => stop.destinationId && Number.isFinite(stop.days) && stop.days > 0);

    if (!plan.length) return { ok: true, warnings, errors, journeys: [] };

    const destById = new Map(
        (loadDestinations().destinations || []).map((destination) => [destination.id, destination]),
    );
    const totalDays = plan.reduce((sum, stop) => sum + stop.days, 0);

    for (const stop of plan) {
        const minDays = Number(destById.get(stop.destinationId)?.stayGuidance?.minDays);
        if (minDays > 0 && stop.days < minDays) {
            warnings.push({
                code: 'min-days',
                destinationId: stop.destinationId,
                message: `${labelDestination(stop.destinationId)} usually needs at least ${minDays} day${minDays === 1 ? '' : 's'} (plan has ${stop.days}).`,
            });
        }
    }

    const route = planRoute({
        stayPlan: plan,
        explicitOrder: opts.explicitOrder !== false,
        originIata: opts.originIata,
        openJaw: opts.openJaw,
        gatewayId: opts.gatewayId,
        connections: opts.connections,
        destinationRecords: opts.destinationRecords,
    });

    warnings.push(...(route.warnings || []));
    errors.push(...(route.errors || []));

    for (const journey of route.journeys || []) {
        if (journey.kind === 'outbound') continue;
        const arriving = plan.find((stop) => stop.destinationId === journey.to);
        const days = Number(arriving?.days) || 0;
        if (days > 0 && Number.isFinite(journey.hours) && journey.hours > days * HOURS_PER_ALLOCATED_DAY) {
            errors.push({
                code: 'journey-too-long',
                destinationId: journey.to,
                from: journey.from,
                to: journey.to,
                hours: journey.hours,
                load: journey.load,
                message: `The ${journey.hours}h journey into ${labelDestination(journey.to)} exceeds the ${days}-day allocation.`,
            });
        }
    }

    if (plan.length > Math.ceil(totalDays / 2)) {
        warnings.push({
            code: 'too-many-stops',
            message: `${plan.length} stops in ${totalDays} days is a tight circuit — consider fewer places or more days.`,
        });
    }

    // Surface blocking connection gaps in warnings too so existing compose callers still see them.
    for (const error of errors) {
        if (error.code !== 'no-route') continue;
        if (warnings.some((warning) => warning.code === 'no-route' && warning.from === error.from && warning.to === error.to)) {
            continue;
        }
        warnings.push(error);
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        journeys: route.journeys || [],
        route,
    };
}

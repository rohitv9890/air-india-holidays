import { randomUUID } from 'node:crypto';
import { putItinerary, getItinerary } from './itinerary-store.js';

function corsOrigin(event) {
    const allowed = (process.env.CORS_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const requestOrigin = event.headers?.origin || event.headers?.Origin;
    if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
    return allowed[0] || '*';
}

function jsonResponse(statusCode, body, event) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': corsOrigin(event),
        },
        body: JSON.stringify(body),
    };
}

function queryParams(event) {
    return event.queryStringParameters || event.query || {};
}

function sessionPayload(session) {
    return {
        sessionId: session.sessionId,
        tab: session.tab,
        intent: session.intent,
        itinerary: session.itinerary || null,
        messages: session.messages || [],
        title: session.title || null,
        createdAt: session.createdAt || null,
        updatedAt: session.updatedAt || null,
        diagnostics: session.diagnostics || [],
    };
}

/** GET /guzo/session?sessionId= — hydrate an existing chat */
export async function handleSessionGet(event) {
    const q = queryParams(event);
    const sessionId = q.sessionId;
    if (!sessionId) return jsonResponse(400, { error: 'sessionId query param is required' }, event);

    const { getSession } = await import('./sessions.js');
    const session = await getSession(sessionId);
    if (!session) return jsonResponse(404, { error: 'Session not found' }, event);
    return jsonResponse(200, sessionPayload(session), event);
}

/** POST /guzo/session — create or upsert a session */
export async function handleSession(event) {
    const body = event.body ? JSON.parse(event.body) : {};
    const { upsertSession } = await import('./sessions.js');

    const sessionId = body.sessionId || `guzo_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const tab = body.tab || 'packages';
    const patch = { tab };
    if (body.title != null) patch.title = body.title;
    if (body.intent != null) patch.intent = body.intent;
    const session = await upsertSession(sessionId, patch);

    return jsonResponse(200, sessionPayload(session), event);
}

export function handleHealth(event) {
    return jsonResponse(200, {
        status: 'ok',
        service: 'guzo-chat-handler',
        model: process.env.GUZO_MODEL || 'openai/gpt-5.6-luna',
    }, event);
}

export async function handleCatalogSearch(event) {
    const q = queryParams(event);
    const { searchCatalog } = await import('./catalog.js');
    const items = searchCatalog({
        q: q.q || '',
        type: q.type,
        destination: q.destination,
        theme: q.theme,
    });
    return jsonResponse(200, { count: items.length, items }, event);
}

export async function handleCatalogProduct(event) {
    const q = queryParams(event);
    const path = getRoutePath(event);
    const pathMatch = path.match(/\/guzo\/catalog\/product\/([^/?]+)/);
    const id = decodeURIComponent(
        event.pathParameters?.id || pathMatch?.[1] || q.id || '',
    );
    if (!id) return jsonResponse(400, { error: 'id is required' }, event);

    const { getProduct } = await import('./catalog.js');
    const product = getProduct(id);
    if (!product) return jsonResponse(404, { error: 'Product not found' }, event);
    return jsonResponse(200, { product }, event);
}

/** GET /guzo/enhancements?packageId=&destinations=a,b */
export async function handleEnhancements(event) {
    const q = queryParams(event);
    if (!q.packageId) return jsonResponse(400, { error: 'packageId is required' }, event);
    try {
        const { suggestEnhancements } = await import('./catalog.js');
        const items = suggestEnhancements({
            packageId: q.packageId,
            destinations: String(q.destinations || '').split(',').filter(Boolean),
            limit: Number(q.limit) || 4,
        });
        return jsonResponse(200, { packageId: q.packageId, count: items.length, items }, event);
    } catch (err) {
        return jsonResponse(400, { error: err.message || 'Enhancement suggestions failed' }, event);
    }
}

/** POST /guzo/quote — deterministic package + explicit add-on quote */
export async function handleQuote(event) {
    const body = event.body ? JSON.parse(event.body) : {};
    if (!body.packageId || !body.startDate || body.adults == null) {
        return jsonResponse(400, { error: 'packageId, startDate, and adults are required' }, event);
    }
    try {
        const { quoteItinerary, normalizeDisplayCurrency } = await import('./pricing.js');
        const { estimateMiles } = await import('./miles.js');
        const quote = quoteItinerary({
            packageId: body.packageId,
            addOnProductIds: body.addOnProductIds || [],
            startDate: body.startDate,
            adults: body.adults,
            children: body.children || 0,
            cabin: body.cabin || 'Economy',
            tier: body.tier || 'classic',
            currency: normalizeDisplayCurrency(body.currency, body.originIata),
            nights: body.nights,
            rooms: body.rooms,
        });
        const milesEstimate = estimateMiles({
            totalAmount: quote.totals.GBP,
            currency: 'GBP',
            cabin: body.cabin || 'Economy',
            tier: body.tier || 'classic',
        });
        return jsonResponse(200, { quote, milesEstimate }, event);
    } catch (err) {
        return jsonResponse(400, { error: err.message || 'Quote failed' }, event);
    }
}

export async function handleItineraryPost(event) {
    const body = event.body ? JSON.parse(event.body) : {};
    if (!body.startDate || !(body.originIata || body.origin) || body.adults == null) {
        return jsonResponse(400, {
            error: 'startDate, originIata, and adults are required',
        }, event);
    }

    try {
        const { buildItinerary } = await import('./itinerary-builder.js');
        const { normalizeDisplayCurrency } = await import('./pricing.js');
        const originIata = body.originIata || body.origin;
        const itinerary = buildItinerary({
            packageId: body.packageId,
            destination: body.destination,
            durationDays: body.durationDays,
            startDate: body.startDate,
            originIata,
            adults: body.adults,
            children: body.children ?? 0,
            cabin: body.cabin || 'Economy',
            tier: body.tier || 'classic',
            currency: normalizeDisplayCurrency(body.currency, originIata),
        });

        putItinerary(itinerary);

        if (body.sessionId) {
            try {
                const { saveItinerary } = await import('./sessions.js');
                await saveItinerary(body.sessionId, itinerary);
            } catch (err) {
                console.warn('Could not persist itinerary to session:', err.message);
            }
        }

        return jsonResponse(200, { itinerary }, event);
    } catch (err) {
        return jsonResponse(400, { error: err.message || 'Failed to build itinerary' }, event);
    }
}

/**
 * GET /guzo/itinerary?id=
 * Looks up process-local memory first, then DynamoDB session.itinerary
 * if sessionId is also provided (?id=&sessionId=).
 * Note: memory map is per-Lambda instance; prefer sessionId for durability.
 */
export async function handleItineraryGet(event) {
    const q = queryParams(event);
    const id = q.id;
    if (!id) return jsonResponse(400, { error: 'id query param is required' }, event);

    let itinerary = getItinerary(id);

    if (!itinerary && q.sessionId) {
        try {
            const { getSession } = await import('./sessions.js');
            const session = await getSession(q.sessionId);
            if (session?.itinerary?.id === id) itinerary = session.itinerary;
        } catch (err) {
            console.warn('Session itinerary lookup failed:', err.message);
        }
    }

    if (!itinerary) {
        return jsonResponse(404, {
            error: 'Itinerary not found',
            note: 'Itineraries are stored in process memory and optionally on the session. Pass sessionId if available.',
        }, event);
    }

    return jsonResponse(200, { itinerary }, event);
}

export function getRoutePath(event) {
    return event.requestContext?.http?.path
        || event.rawPath
        || event.path
        || '';
}

export function getCorsHeaders(event) {
    return {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': corsOrigin(event),
    };
}

export { jsonResponse, corsOrigin };

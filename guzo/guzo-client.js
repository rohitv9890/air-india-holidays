import { GUZO_CONFIG } from './guzo-config.js';

function apiBase() {
    const url = (GUZO_CONFIG.apiUrl || '').replace(/\/$/, '');
    if (!url) throw new Error('Guzo API URL is not configured');
    return url;
}

function parseSseChunk(buffer, onEvent) {
    const lines = buffer.split('\n');
    const remainder = lines.pop() || '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload) continue;

        try {
            onEvent(JSON.parse(payload));
        } catch {
            // ignore malformed chunks
        }
    }

    return remainder;
}

function applyChatEvent(event, acc, callbacks = {}) {
    if (event.type === 'text_delta') {
        acc.text += event.content || '';
        callbacks.onTextDelta?.(acc.text, event.content || '');
    } else if (event.type === 'intent_update' && event.intent) {
        acc.intent = event.intent;
        callbacks.onIntentUpdate?.(acc.intent);
    } else if (event.type === 'recommendations' && Array.isArray(event.items)) {
        acc.recommendations = event.items;
        callbacks.onRecommendations?.(event.items);
    } else if (event.type === 'cross_sell_packages' && Array.isArray(event.items)) {
        acc.recommendations = event.items;
        acc.crossSell = {
            intro: event.intro
                || 'We have some ready-made packages with great value.',
            items: event.items,
        };
        callbacks.onCrossSellPackages?.(acc.crossSell.intro, event.items);
    } else if (event.type === 'trip_summary' && event.summary) {
        acc.tripSummary = event.summary;
        callbacks.onTripSummary?.(event.summary);
    } else if (event.type === 'itinerary_ready') {
        if (event.itinerary) acc.itinerary = event.itinerary;
        acc.itineraryId = event.itineraryId || event.itinerary?.id || event.id || null;
        callbacks.onItineraryReady?.(acc.itineraryId, event.itinerary || null);
    } else if (event.type === 'enhancement_suggestions') {
        acc.enhancements = Array.isArray(event.items) ? event.items : [];
        callbacks.onEnhancements?.(acc.enhancements, event.packageId);
    } else if (event.type === 'composite_quote') {
        acc.compositeQuote = event.quote || null;
        callbacks.onCompositeQuote?.(acc.compositeQuote, event.milesEstimate || null);
    } else if (event.type === 'error') {
        throw new Error(event.message || 'Chat stream error');
    }
}

/**
 * Ensure backend session exists (optional; chat also accepts client sessionId).
 */
export async function ensureSession(sessionId, tab = 'packages') {
    const res = await fetch(`${apiBase()}/guzo/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, tab }),
    });

    if (!res.ok) {
        throw new Error(`Session request failed (${res.status})`);
    }

    return res.json();
}

/** Load a persisted session (messages + intent) for resume. */
export async function fetchSession(sessionId) {
    if (!sessionId || !GUZO_CONFIG.apiUrl || GUZO_CONFIG.mockMode) return null;
    const res = await fetch(
        `${apiBase()}/guzo/session?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Session fetch failed (${res.status})`);
    return res.json();
}

/**
 * Stream chat completion from Guzo API.
 * @returns {{ text: string, intent: object|null, recommendations: array|null, tripSummary: object|null, itineraryId: string|null, itinerary: object|null }}
 */
export async function streamChat({
    message,
    tab,
    pendingIntent,
    sessionId,
    onTextDelta,
    onIntentUpdate,
    onRecommendations,
    onCrossSellPackages,
    onTripSummary,
    onItineraryReady,
    onEnhancements,
    onCompositeQuote,
}) {
    const res = await fetch(`${apiBase()}/guzo/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
        },
        body: JSON.stringify({
            message,
            tab,
            intent: pendingIntent,
            sessionId,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Chat request failed (${res.status})${errText ? `: ${errText}` : ''}`);
    }

    const callbacks = {
        onTextDelta,
        onIntentUpdate,
        onRecommendations,
        onCrossSellPackages,
        onTripSummary,
        onItineraryReady,
        onEnhancements,
        onCompositeQuote,
    };

    const acc = {
        text: '',
        intent: pendingIntent,
        recommendations: null,
        tripSummary: null,
        itineraryId: null,
        itinerary: null,
        enhancements: null,
        compositeQuote: null,
        crossSell: null,
    };

    if (!res.body) {
        const text = await res.text();
        parseSseChunk(text + '\n', (event) => applyChatEvent(event, acc, callbacks));
        return acc;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, (event) => applyChatEvent(event, acc, callbacks));
    }

    if (buffer.trim()) {
        parseSseChunk(buffer + '\n', (event) => applyChatEvent(event, acc, callbacks));
    }

    return acc;
}

export async function checkHealth() {
    const res = await fetch(`${apiBase()}/guzo/health`);
    if (!res.ok) throw new Error(`Health check failed (${res.status})`);
    return res.json();
}

/** Optional REST fetch when API is available (structured itinerary by id). */
export async function fetchItinerary(itineraryId) {
    if (!GUZO_CONFIG.apiUrl || GUZO_CONFIG.mockMode) return null;
    const res = await fetch(`${apiBase()}/guzo/itinerary?id=${encodeURIComponent(itineraryId)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    return payload.itinerary || payload;
}

export async function fetchEnhancements(packageId, destinations = []) {
    const params = new URLSearchParams({ packageId, limit: '4' });
    if (destinations.length) params.set('destinations', destinations.join(','));
    const res = await fetch(`${apiBase()}/guzo/enhancements?${params}`);
    if (!res.ok) throw new Error(`Enhancements request failed (${res.status})`);
    return res.json();
}

export async function quoteCompositeTrip(payload) {
    const res = await fetch(`${apiBase()}/guzo/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Quote request failed (${res.status})`);
    return body;
}

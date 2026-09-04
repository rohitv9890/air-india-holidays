import { GUZO_CONFIG } from './guzo-config.js';
import { streamChat, ensureSession } from './guzo-client.js';
import { guzoState } from './guzo-state.js';
import {
    parseSlotsFromMessage,
    parseAnswerForMissing,
    mergeIntent,
    getMissingFieldsForAction,
    getConversationalPrompt,
    summarizeIntent,
    createEmptyIntent,
} from './guzo-intent.js';
import {
    getPackageRecommendations,
    getCatalogRecommendations,
    buildItineraryFromProduct,
    intentToTripSummary,
    preferredCurrencyForOrigin,
    TripDurationValidationError,
    TripFactsValidationError,
} from './guzo-catalog-client.js';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function hasParsedSlots(slots) {
    return Object.keys(slots).length > 0;
}

const BUILD_ITINERARY_PATTERN = /^build\s+my\s+itinerary\.?$/i;

function isFeaturedDestinationPackage(text, intent) {
    const hay = [
        text || '',
        intent?.destination?.name || '',
        intent?.destination?.code || '',
    ].join(' ').toLowerCase();

    return /\b(agra|taj\s*mahal|udaipur|jaipur|hyderabad|kochi|goa|maldives|golden\s*triangle|taj\s*holidays|delhi|mumbai|india|johannesburg|wanderers|cape\s*town|newlands|durban|kingsmead|centurion|supersport\s*park|gqeberha|port\s*elizabeth|st\s*george|cricket|world\s*cup|cwc|family)\b/.test(hay);
}

function isPackagesRichReady(intent) {
    return Boolean(
        intent?.origin?.code
        && intent?.destination?.name
        && intent?.dates?.start
        && intent?.dates?.end
        && (intent?.travelers?.adults || 0) >= 1
    );
}

/**
 * The two flagship packages should recommend themselves on the first mention,
 * not after a 3-question interrogation. When a message unambiguously names one
 * of them, fill in any still-missing trip facts with sensible defaults so
 * isPackagesRichReady() passes immediately.
 */
const FLAGSHIP_PACKAGES = [
    {
        match: /\b(india\s*v(?:s)?\.?\s*australia|cwc\s*opener|world\s*cup\s*open(?:er|ing)|johannesburg\s*opener|wanderers)\b/i,
        destination: { name: 'Johannesburg', code: 'JNB' },
        defaultStart: '2027-10-02',
        nights: 5,
        taj: false,
    },
    {
        match: /\b(taj\s*lake\s*palace|udaipur)\b/i,
        destination: { name: 'Udaipur', code: 'UDR' },
        defaultStart: '2027-02-15',
        nights: 3,
        taj: true,
    },
];

function matchFlagshipPackage(text) {
    return FLAGSHIP_PACKAGES.find((p) => p.match.test(text || '')) || null;
}

function addDaysIso(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

function applyFlagshipDefaults(intent, flagship) {
    const next = structuredClone(intent);
    if (!next.destination?.name) next.destination = flagship.destination;
    if (!next.origin?.code) next.origin = { name: 'Delhi', code: 'DEL' };
    if (!next.dates) next.dates = {};
    if (!next.dates.start) next.dates.start = flagship.defaultStart;
    if (!next.dates.end) next.dates.end = addDaysIso(next.dates.start, flagship.nights);
    if (!next.travelers) next.travelers = {};
    if (!(next.travelers.adults >= 1)) next.travelers.adults = 2;
    return next;
}

function formatItineraryReadyReply(result) {
    const itinerary = result?.itinerary;
    const title = itinerary?.title || 'your India holiday';
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

async function evaluateIntent(intent, tab, action = 'search') {
    await delay(GUZO_CONFIG.typingDelayMs);

    const missing = getMissingFieldsForAction(intent, { tab, action });
    const summary = summarizeIntent(intent, tab);

    if (missing.length > 0) {
        return {
            intent,
            complete: false,
            response: {
                role: 'assistant',
                type: 'text',
                content: getConversationalPrompt(missing, intent, tab),
            },
        };
    }

    return {
        intent,
        complete: true,
        response: {
            role: 'assistant',
            type: 'text',
            content: `Here's your trip:\n${summary}\n\nI can search the catalog whenever you're ready.`,
        },
    };
}

export async function evaluateTripIntent(intent, tab) {
    return evaluateIntent(intent, tab);
}

async function planFromApi(text, tab, pendingIntent, callbacks = {}) {
    await ensureSession(guzoState.sessionId, tab);

    const result = await streamChat({
        message: text,
        tab,
        pendingIntent,
        sessionId: guzoState.sessionId,
        onTextDelta: callbacks.onTextDelta,
        onIntentUpdate: callbacks.onIntentUpdate,
        onRecommendations: callbacks.onRecommendations,
        onCrossSellPackages: callbacks.onCrossSellPackages,
        onTripSummary: callbacks.onTripSummary,
        onItineraryReady: callbacks.onItineraryReady,
        onEnhancements: callbacks.onEnhancements,
        onCompositeQuote: callbacks.onCompositeQuote,
    });

    const intent = result.intent || pendingIntent || createEmptyIntent(tab);

    return {
        intent,
        complete: false,
        recommendations: result.recommendations,
        tripSummary: result.tripSummary,
        itineraryId: result.itineraryId,
        itinerary: result.itinerary,
        enhancements: result.enhancements,
        compositeQuote: result.compositeQuote,
        crossSell: result.crossSell,
        response: {
            role: 'assistant',
            type: 'text',
            content: result.text || 'How can I help with your trip?',
        },
    };
}

async function buildRichPackageResponse(intent, { family = false, taj = false } = {}) {
    await delay(GUZO_CONFIG.typingDelayMs);

    const destination = intent.destination?.name || '';
    const currency = preferredCurrencyForOrigin(intent.origin?.code);
    const cards = await getPackageRecommendations({ family, taj, destination, limit: 4, currency });
    const tripSummary = intentToTripSummary(intent);
    const summaryText = summarizeIntent(intent, 'packages');

    return {
        intent,
        complete: true,
        rich: true,
        recommendations: cards,
        tripSummary,
        itineraryReady: false,
        responses: [
            {
                role: 'assistant',
                type: 'text',
                content: `Great — here's what I have so far:\n${summaryText}\n\nI found some India holidays for you. Choose a card, then tap Build my itinerary.`,
            },
            {
                role: 'assistant',
                type: 'product_cards',
                items: cards,
            },
        ],
        response: {
            role: 'assistant',
            type: 'text',
            content: `Great — here's what I have so far:\n${summaryText}\n\nI found some India holidays for you. Choose a card, then tap Build my itinerary.`,
        },
    };
}

async function buildCatalogSearchResponse(intent, tab) {
    await delay(GUZO_CONFIG.typingDelayMs);

    const cards = await getCatalogRecommendations(tab, intent);
    const tripSummary = intentToTripSummary(intent);
    const summaryText = summarizeIntent(intent, tab);
    const label = GUZO_CONFIG.tabLabels[tab] || tab;

    if (!cards.length) {
        return {
            intent,
            complete: true,
            rich: true,
            recommendations: [],
            tripSummary,
            responses: [
                {
                    role: 'assistant',
                    type: 'text',
                    content: `I looked for ${label.toLowerCase()} matching:\n${summaryText}\n\nI couldn't find a suitable option yet. Try another city or different dates.`,
                },
            ],
            response: {
                role: 'assistant',
                type: 'text',
                content: `I couldn't find a matching ${label.toLowerCase()} option yet.`,
            },
        };
    }

    const buildHint = tab === 'packages'
        ? 'Tap a card, then Build my itinerary.'
        : `Prices are shown in ${preferredCurrencyForOrigin(intent.origin?.code)}.`;

    return {
        intent,
        complete: true,
        rich: true,
        recommendations: cards,
        tripSummary,
        itineraryReady: false,
        responses: [
            {
                role: 'assistant',
                type: 'text',
                content: `Here's your trip:\n${summaryText}\n\nI found ${cards.length} ${label.toLowerCase()} option${cards.length === 1 ? '' : 's'} for you. ${buildHint}`,
            },
            {
                role: 'assistant',
                type: 'product_cards',
                items: cards,
            },
        ],
        response: {
            role: 'assistant',
            type: 'text',
            content: `I found ${cards.length} ${label.toLowerCase()} option${cards.length === 1 ? '' : 's'} for you.`,
        },
    };
}

async function buildItineraryResponse(intent, selectedProductId) {
    await delay(GUZO_CONFIG.typingDelayMs);

    const cards = guzoState.recommendations?.length
        ? guzoState.recommendations
        : await getPackageRecommendations({
            family: (intent.travelers?.children || 0) > 0,
            destination: intent.destination?.name || '',
            limit: 4,
            currency: preferredCurrencyForOrigin(intent.origin?.code),
        });
    const product = cards.find(c => c.id === selectedProductId) || cards[0] || null;
    let itinerary;
    try {
        itinerary = await buildItineraryFromProduct(intent, product);
    } catch (error) {
        console.warn('Could not build Guzo itinerary', error);
        const missingFact = error instanceof TripFactsValidationError
            ? {
                origin: 'departure airport',
                'dates.start': 'start date',
                'travelers.adults': 'number of adults',
            }[error.fact]
            : null;
        const content = error instanceof TripFactsValidationError
            ? `I still need your ${missingFact || 'trip details'} before I can build the itinerary. Please add it and try again.`
            : error instanceof TripDurationValidationError
                ? `${error.message} I can build the shortest sensible option if you extend the trip.`
                : 'I could not build your itinerary just now. Please try again; if it still fails, choose the package again before rebuilding.';
        return {
            intent,
            complete: false,
            itineraryReady: false,
            response: {
                role: 'assistant',
                type: 'text',
                content,
            },
        };
    }
    const tripSummary = intentToTripSummary(intent);

    try {
        sessionStorage.setItem('guzoItinerary', JSON.stringify(itinerary));
    } catch {
        // ignore quota errors
    }

    return {
        intent,
        complete: true,
        rich: true,
        recommendations: cards,
        tripSummary,
        itineraryId: itinerary.id,
        itinerary,
        itineraryReady: true,
        responses: [
            {
                role: 'assistant',
                type: 'text',
                content: formatItineraryReadyReply({ itinerary, warnings: itinerary.warnings || [] }),
            },
            {
                role: 'assistant',
                type: 'itinerary_cta',
                content: 'View itinerary',
                itineraryId: itinerary.id,
                summary: {
                    title: itinerary.title,
                    price: itinerary.price,
                    days: itinerary.duration.days,
                },
            },
        ],
        response: {
            role: 'assistant',
            type: 'itinerary_cta',
            content: 'View itinerary',
            itineraryId: itinerary.id,
        },
    };
}

export async function planFromMessage(text, tab, pendingIntent, callbacks = {}) {
    if (!GUZO_CONFIG.mockMode && GUZO_CONFIG.apiUrl) {
        return planFromApi(text, tab, pendingIntent, callbacks);
    }

    const lower = text.toLowerCase();

    if (BUILD_ITINERARY_PATTERN.test(text.trim())) {
        const intent = pendingIntent || createEmptyIntent(tab);
        const missing = getMissingFieldsForAction(intent, { tab, action: 'compose' });
        if (missing.length) {
            return evaluateIntent(intent, tab, 'compose');
        }
        return buildItineraryResponse(intent, guzoState.selectedProductId);
    }

    if (/^search\s*now\.?$/i.test(text.trim()) && pendingIntent) {
        const intent = structuredClone(pendingIntent);
        const missing = getMissingFieldsForAction(intent, { tab, action: 'search' });
        if (missing.length) {
            return evaluateIntent(intent, tab, 'search');
        }
        if (tab === 'packages') {
            return buildRichPackageResponse(intent, {
                family: (intent.travelers?.children || 0) > 0,
                taj: /taj\s*mahal|agra/i.test(intent.destination?.name || ''),
            });
        }
        return buildCatalogSearchResponse(intent, tab);
    }

    if (lower.includes('miles') || lower.includes('points') || lower.includes('shebamiles') || lower.includes('maharaja')) {
        await delay(GUZO_CONFIG.typingDelayMs);
        return {
            intent: pendingIntent || createEmptyIntent(tab),
            complete: false,
            response: {
                role: 'assistant',
                type: 'text',
                content: "Sign in to Maharaja Club to see your balance, membership benefits, and the Maharaja Points you could earn on this trip. I can still search for you as a guest!",
            },
        };
    }

    let slots = parseSlotsFromMessage(text, tab);
    if (!hasParsedSlots(slots) && pendingIntent) {
        slots = { ...slots, ...parseAnswerForMissing(text, pendingIntent, tab) };
    }

    let intent = mergeIntent(pendingIntent, slots, tab);

    // Flagship packages recommend themselves on first mention — no interrogation,
    // and no short-message bailout below should pre-empt this.
    if (tab === 'packages') {
        const flagship = matchFlagshipPackage(text) || matchFlagshipPackage(intent?.destination?.name || '');
        if (flagship) {
            const readyIntent = applyFlagshipDefaults(intent, flagship);
            const family = (readyIntent.travelers?.children || 0) > 0;
            return buildRichPackageResponse(readyIntent, { family, taj: flagship.taj });
        }
    }

    if (!hasParsedSlots(slots) && text.length < 20 && !pendingIntent) {
        await delay(GUZO_CONFIG.typingDelayMs);
        return {
            intent,
            complete: false,
            response: {
                role: 'assistant',
                type: 'text',
                content: getFollowUpText(tab, text),
            },
        };
    }

    // Packages: show catalog cards (synthetic + Hermes) when enough slots are ready
    if (tab === 'packages' && isFeaturedDestinationPackage(text, intent)) {
        if (isPackagesRichReady(intent)) {
            const family = /\bfamily\b/i.test(text) || (intent.travelers?.children || 0) > 0;
            const taj = /\btaj\s*mahal\b/i.test(text) || /\bagra\b/i.test(text) || /taj\s*mahal|agra/i.test(intent.destination?.name || '');
            return buildRichPackageResponse(intent, { family, taj });
        }
    }

    return evaluateIntent(intent, tab);
}

/** Catalog inventory search for mock mode (hotels / tours / transfers / flights / packages). */
export async function searchCatalogForTab(intent, tab) {
    if (tab === 'packages') {
        return buildRichPackageResponse(structuredClone(intent), {
            family: (intent.travelers?.children || 0) > 0,
            taj: /taj\s*mahal|agra/i.test(intent.destination?.name || ''),
        });
    }
    return buildCatalogSearchResponse(structuredClone(intent), tab);
}

export function getFollowUpText(tab, message) {
    const tabLabel = GUZO_CONFIG.tabLabels[tab] || tab;
    const snippets = {
        packages: "Tell me where you're flying from and to, your dates, and who's travelling.",
        hotels: 'Which city or hotel, what dates, and how many guests?',
        tours: 'Which destination or experience, and when would you like to go?',
        transfers: 'Where should I pick you up and drop you off, and when?',
        flights: 'What route, dates, and cabin class are you looking for?',
    };

    if (message.length < 12) {
        return `I'd love to help with your ${tabLabel.toLowerCase()} search. ${snippets[tab] || snippets.packages}`;
    }

    return `Got it! ${snippets[tab] || snippets.packages}`;
}

export { BUILD_ITINERARY_PATTERN };

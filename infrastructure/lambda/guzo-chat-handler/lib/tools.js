import { sanitizeToolArgs } from './guardrails.js';
import { stayPlanFromItinerary } from './stay-plan.js';

const STAY_PLAN_PARAM = {
    type: 'array',
    description: 'Ordered multi-stop day split. Preferred over encoding the split in the preferences string.',
    items: {
        type: 'object',
        properties: {
            destinationId: {
                type: 'string',
                description: 'Catalog destination slug or place name, e.g. "lalibela" or "Addis Ababa"',
            },
            days: { type: 'integer', minimum: 1 },
        },
        required: ['destinationId', 'days'],
    },
};

export const GUZO_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'search_places',
            description: 'Search EasyGDS for airports, cities, hotels, or tour regions. Use to resolve place names to codes before updating intent.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search text, e.g. "Addis Ababa" or "Sheraton"' },
                    type: {
                        type: 'string',
                        enum: ['airport_code', 'place_id', 'hotel', 'tour_region'],
                        description: 'airport_code for flights/packages; hotel for hotels; tour_region for tours; place_id otherwise',
                    },
                },
                required: ['query', 'type'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'extract_trip_intent',
            description: 'Merge structured trip fields into the session intent. Call whenever you learn or confirm trip details from the user. Supports package-planning fields.',
            parameters: {
                type: 'object',
                properties: {
                    productTab: { type: 'string', enum: ['packages', 'hotels', 'tours', 'transfers', 'flights'] },
                    origin: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                        },
                    },
                    destination: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                            catalogId: { type: 'string', description: 'Canonical catalog destination slug' },
                        },
                    },
                    pickup: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                        },
                    },
                    dropoff: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                        },
                    },
                    dates: {
                        type: 'object',
                        properties: {
                            start: {
                                type: 'string',
                                description: 'YYYY-MM-DD. If user said day+month only, resolve year within the next 12 months — never leave year unknown.',
                            },
                            end: {
                                type: 'string',
                                description: 'YYYY-MM-DD. Resolve year within the next 12 months when omitted.',
                            },
                        },
                    },
                    pickupDate: {
                        type: 'string',
                        description: 'YYYY-MM-DD for transfers; resolve year within 12 months if omitted',
                    },
                    pickupTime: { type: 'string', description: 'HH:MM 24h' },
                    travelers: {
                        type: 'object',
                        properties: {
                            adults: { type: 'integer' },
                            children: { type: 'integer' },
                            childAges: { type: 'array', items: { type: 'integer' } },
                            infants: { type: 'integer' },
                            rooms: { type: 'integer' },
                        },
                    },
                    cabin: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
                    roundTrip: { type: 'boolean' },
                    interests: { type: 'array', items: { type: 'string' } },
                    durationDays: { type: 'integer', description: 'Inclusive trip days. A 7-night trip is 8 days.' },
                    pace: { type: 'string', enum: ['relaxed', 'moderate', 'active'] },
                    tier: { type: 'string', enum: ['classic', 'comfort', 'signature'] },
                    budget: {
                        type: 'object',
                        properties: {
                            amount: { type: 'number' },
                            currency: { type: 'string' },
                        },
                    },
                    preferences: { type: 'string' },
                    stayPlan: STAY_PLAN_PARAM,
                    packageId: { type: 'string' },
                    itineraryId: { type: 'string' },
                    selectedAddOnIds: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_package_intent',
            description: 'Merge Ethiopia package-planning fields (interests, duration, pace, tier, budget, preferences, stayPlan, package/itinerary ids) into session intent.',
            parameters: {
                type: 'object',
                properties: {
                    origin: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                        },
                    },
                    destination: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            code: { type: 'string' },
                            id: { type: 'string' },
                            type: { type: 'string' },
                            catalogId: { type: 'string', description: 'Canonical catalog destination slug' },
                        },
                    },
                    dates: {
                        type: 'object',
                        properties: {
                            start: {
                                type: 'string',
                                description: 'YYYY-MM-DD; resolve year within 12 months if user omitted it',
                            },
                            end: {
                                type: 'string',
                                description: 'YYYY-MM-DD; resolve year within 12 months if user omitted it',
                            },
                        },
                    },
                    travelers: {
                        type: 'object',
                        properties: {
                            adults: { type: 'integer' },
                            children: { type: 'integer' },
                            childAges: { type: 'array', items: { type: 'integer' } },
                            infants: { type: 'integer' },
                            rooms: { type: 'integer' },
                        },
                    },
                    cabin: { type: 'string' },
                    interests: { type: 'array', items: { type: 'string' } },
                    durationDays: { type: 'integer', description: 'Inclusive trip days. A 7-night trip is 8 days.' },
                    pace: { type: 'string', enum: ['relaxed', 'moderate', 'active'] },
                    tier: { type: 'string', enum: ['classic', 'comfort', 'signature'] },
                    budget: {
                        type: 'object',
                        properties: {
                            amount: { type: 'number' },
                            currency: { type: 'string' },
                        },
                    },
                    preferences: { type: 'string' },
                    stayPlan: STAY_PLAN_PARAM,
                    packageId: { type: 'string' },
                    itineraryId: { type: 'string' },
                    selectedAddOnIds: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_catalog',
            description: 'Search the Ethiopia holiday catalog for packages, stays, experiences, or transfers. Destination accepts a catalog slug or place name. Free-text q is optional and supports multiple terms.',
            parameters: {
                type: 'object',
                properties: {
                    q: { type: 'string', description: 'Free-text query' },
                    type: { type: 'string', description: 'product type filter, e.g. package, accommodation, experience' },
                    destination: { type: 'string' },
                    theme: { type: 'string' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_product',
            description: 'Fetch a single catalog product by id.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                },
                required: ['id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'compose_itinerary',
            description: 'Build a multi-day Ethiopia itinerary from a package or a bespoke stay plan. When duration/preferences do not match a catalog package, pass durationDays + stayPlan (and optional interests) for a custom day-by-day plan.',
            parameters: {
                type: 'object',
                properties: {
                    packageId: { type: 'string' },
                    destination: { type: 'string' },
                    durationDays: { type: 'integer' },
                    startDate: { type: 'string', description: 'YYYY-MM-DD' },
                    endDate: { type: 'string', description: 'YYYY-MM-DD inclusive trip end date' },
                    originIata: { type: 'string', description: 'Origin airport IATA, e.g. LHR' },
                    adults: { type: 'integer' },
                    children: { type: 'integer' },
                    childAges: { type: 'array', items: { type: 'integer' } },
                    cabin: { type: 'string' },
                    tier: { type: 'string', enum: ['classic', 'comfort', 'signature'] },
                    preferences: {
                        type: 'string',
                        description: 'Free-text traveller preferences; use stayPlan for the day split',
                    },
                    stayPlan: STAY_PLAN_PARAM,
                    interests: { type: 'array', items: { type: 'string' } },
                    bespoke: {
                        type: 'boolean',
                        description: 'Force a custom itinerary length/route instead of the package template',
                    },
                },
                required: ['startDate', 'originIata', 'adults'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'suggest_stops',
            description: 'Rank catalog destinations to fill unnamed additional stops (e.g. "2 other places" after Addis). Returns grounded destination slugs with brief reasons — never invent places outside this result.',
            parameters: {
                type: 'object',
                properties: {
                    anchors: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Already-chosen destination slugs or place names to build around',
                    },
                    count: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 4,
                        description: 'How many additional stops to suggest (default 2)',
                    },
                    totalDays: {
                        type: 'integer',
                        description: 'Full trip length in days; used to drop stops that cannot fit',
                    },
                    themes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Theme hints such as trekking, history, wildlife',
                    },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'suggest_trip_enhancements',
            description: 'Suggest a small set of active catalog-grounded additions, extensions, upgrades, or alternatives for a selected package.',
            parameters: {
                type: 'object',
                properties: {
                    packageId: { type: 'string' },
                    destinations: { type: 'array', items: { type: 'string' } },
                    limit: { type: 'integer', minimum: 1, maximum: 4 },
                },
                required: ['packageId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'apply_itinerary_changes',
            description: 'Apply one or more validated itinerary changes atomically, then recompose when the canonical trip actually changed. Use this instead of guessing. Do not call it for price questions.',
            parameters: {
                type: 'object',
                properties: {
                    operations: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: [
                                        'set_duration',
                                        'set_dates',
                                        'set_travelers',
                                        'set_cabin',
                                        'set_travel_style',
                                        'set_pace',
                                        'add_stop',
                                        'remove_stop',
                                        'replace_stop',
                                        'set_stop_days',
                                        'add_preference',
                                        'remove_preference',
                                    ],
                                },
                                durationDays: { type: 'integer', minimum: 1 },
                                start: { type: 'string' },
                                end: { type: 'string' },
                                adults: { type: 'integer' },
                                children: { type: 'integer' },
                                cabin: { type: 'string' },
                                tier: { type: 'string' },
                                pace: { type: 'string' },
                                destinationId: { type: 'string' },
                                days: { type: 'integer', minimum: 1 },
                                from: { type: 'string' },
                                to: { type: 'string' },
                                note: { type: 'string' },
                            },
                            required: ['type'],
                        },
                    },
                },
                required: ['operations'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'quote_trip',
            description: 'Deterministic price quote for selected catalog products. Never invent prices outside this result.',
            parameters: {
                type: 'object',
                properties: {
                    productIds: { type: 'array', items: { type: 'string' } },
                    packageId: { type: 'string' },
                    addOnProductIds: { type: 'array', items: { type: 'string' } },
                    startDate: { type: 'string' },
                    adults: { type: 'integer' },
                    children: { type: 'integer' },
                    cabin: { type: 'string' },
                    tier: { type: 'string', enum: ['classic', 'comfort', 'signature'] },
                },
                required: ['startDate', 'adults'],
            },
        },
    },
];

function tripSummaryFromIntent(intent, quote, miles) {
    return {
        origin: intent?.origin || null,
        destination: intent?.destination || null,
        dates: intent?.dates || null,
        travelers: intent?.travelers || null,
        cabin: intent?.cabin || null,
        tier: intent?.tier || null,
        interests: intent?.interests || [],
        durationDays: intent?.durationDays ?? null,
        packageId: intent?.packageId || null,
        itineraryId: intent?.itineraryId || null,
        selectedAddOnIds: intent?.selectedAddOnIds || [],
        quote: quote || null,
        milesEstimate: miles || null,
    };
}

async function mergeAndNotify(ctx, args) {
    const { mergeIntent, getPackageMissingFields, isPackageIntentComplete } = await import('./intent.js');
    const merged = mergeIntent(ctx.intent, { ...args, productTab: args.productTab || ctx.tab || 'packages' }, ctx.tab);
    ctx.intent = merged;
    if (ctx.onIntentUpdate) await ctx.onIntentUpdate(merged);

    const summary = tripSummaryFromIntent(merged);
    ctx.tripSummary = summary;
    if (ctx.onTripSummary) await ctx.onTripSummary(summary);

    return {
        ok: true,
        intent: merged,
        packageComplete: isPackageIntentComplete(merged),
        missing: getPackageMissingFields(merged),
    };
}

export async function runTool(name, rawArgs, ctx) {
    const args = sanitizeToolArgs(rawArgs);

    if (name === 'search_places') {
        const { searchPlaces } = await import('./places.js');
        return searchPlaces(args.query, args.type || 'place_id');
    }

    if (name === 'extract_trip_intent' || name === 'update_package_intent') {
        return mergeAndNotify(ctx, args);
    }

    if (name === 'search_catalog') {
        const {
            rankPackagesForIntent,
            rankProductsForIntent,
            searchCatalog,
            toRecommendation,
        } = await import('./catalog.js');
        const { mergeIntent } = await import('./intent.js');

        const tab = args.productTab || ctx.tab || ctx.intent?.productTab || 'packages';
        const queryText = [args.q, args.destination, ctx.intent?.preferences, ...(ctx.intent?.interests || [])]
            .filter(Boolean)
            .join(' ');
        const hotelIntent = tab === 'hotels'
            || args.type === 'accommodation'
            || /\b(hotel|hotels|stay|stays|accommodation|lodge|resort)\b/i.test(queryText);

        let searchIntent = ctx.intent;
        if (args.destination || args.theme || args.q) {
            searchIntent = mergeIntent(ctx.intent, {
                destination: args.destination
                    ? (typeof args.destination === 'object'
                        ? args.destination
                        : { name: String(args.destination) })
                    : undefined,
                preferences: args.q || ctx.intent?.preferences,
                interests: args.theme
                    ? [...(ctx.intent?.interests || []), args.theme]
                    : ctx.intent?.interests,
            }, tab);
        }

        let items;
        if (hotelIntent) {
            items = rankProductsForIntent(searchIntent, { limit: 4, types: ['accommodation'] });
            if (!items.length) {
                items = searchCatalog({
                    q: args.q,
                    type: 'accommodation',
                    destination: args.destination || searchIntent?.destination,
                    theme: args.theme,
                }).slice(0, 4);
            }
        } else if (
            (args.type === 'package' || tab === 'packages' || !args.type)
            && (
                searchIntent?.destination
                || searchIntent?.interests?.length
                || searchIntent?.preferences
                || args.q
                || args.destination
            )
        ) {
            items = rankPackagesForIntent(searchIntent, { limit: 4 });
            if (!items.length) {
                items = searchCatalog({
                    q: args.q,
                    type: args.type || 'package',
                    destination: args.destination || searchIntent?.destination,
                    theme: args.theme,
                }).slice(0, 4);
            }
        } else {
            items = searchCatalog({
                q: args.q,
                type: args.type,
                destination: args.destination,
                theme: args.theme,
            }).slice(0, 4);
        }

        ctx.recommendations = items;
        // Defer UI emission to end of the chat turn so cards stay in message order.
        const { projectCatalogResultsForModel } = await import('./projections.js');
        const { displayCurrencyForOrigin } = await import('./display-currency.js');
        const currency = displayCurrencyForOrigin(ctx.intent?.origin?.code);
        return {
            ok: true,
            count: items.length,
            items: projectCatalogResultsForModel(items, { currency }),
        };
    }

    if (name === 'get_product') {
        const { getProduct } = await import('./catalog.js');
        const product = await getProduct(args.id);
        if (!product) return { ok: false, error: 'Product not found' };
        const { displayCurrencyForOrigin } = await import('./display-currency.js');
        const { projectCatalogResultsForModel } = await import('./projections.js');
        const currency = displayCurrencyForOrigin(ctx.intent?.origin?.code);
        const [projectedProduct] = projectCatalogResultsForModel([product], { currency });
        return { ok: true, product: projectedProduct };
    }

    if (name === 'compose_itinerary') {
        try {
            const { buildItinerary } = await import('./itinerary-builder.js');
            const { resolveItineraryStayPlan } = await import('./stay-plan.js');
            const { mergeIntent } = await import('./intent.js');
            const { getById, normalizeDestination, rankPackagesForIntent } = await import('./catalog.js');
            const { validateStayPlan } = await import('./stay-validation.js');
            const { displayCurrencyForOrigin } = await import('./display-currency.js');
            // Session intent is authoritative. Model-supplied tool arguments may
            // fill an unknown origin, but must never replace a known traveller origin.
            const originIata = String(ctx.intent?.origin?.code || args.originIata || '').toUpperCase() || null;
            const packageId = args.packageId
                || ctx.intent?.packageId
                || rankPackagesForIntent({
                    ...ctx.intent,
                    destination: args.destination || ctx.intent?.destination,
                    durationDays: args.durationDays ?? ctx.intent?.durationDays,
                    tier: args.tier || ctx.intent?.tier,
                }, { limit: 1 })[0]?.id;
            const requestedDays = args.durationDays ?? ctx.intent?.durationDays;
            const pkg = packageId ? getById(packageId) : null;
            const stayPlanArg = args.stayPlan ?? ctx.intent?.stayPlan;
            const preferences = args.preferences ?? ctx.intent?.preferences;
            const interests = args.interests ?? ctx.intent?.interests;
            const destination = normalizeDestination(args.destination || ctx.intent?.destination);
            const resolved = resolveItineraryStayPlan({
                stayPlan: stayPlanArg,
                preferences,
                interests,
                destination,
                pkg,
                requestedDays,
                bespoke: Boolean(
                    args.bespoke
                    || /bespoke|custom|exact|tailor/i.test(String(preferences || '')),
                ),
            });
            const validation = validateStayPlan(resolved.stayPlan, { startDate: args.startDate });

            const itinerary = buildItinerary({
                packageId,
                destination,
                durationDays: requestedDays,
                startDate: args.startDate,
                endDate: args.endDate ?? ctx.intent?.dates?.end,
                originIata,
                adults: args.adults ?? ctx.intent?.travelers?.adults,
                children: args.children ?? ctx.intent?.travelers?.children ?? 0,
                childAges: args.childAges ?? ctx.intent?.travelers?.childAges ?? [],
                cabin: args.cabin ?? ctx.intent?.cabin ?? 'Economy',
                tier: args.tier ?? ctx.intent?.tier ?? 'classic',
                currency: displayCurrencyForOrigin(originIata),
                preferences,
                interests,
                stayPlan: resolved.stayPlan,
                bespoke: resolved.wantsBespoke,
            });

            ctx.itinerary = itinerary;
            const persistedStayPlan = stayPlanFromItinerary(itinerary);
            const merged = mergeIntent(ctx.intent, {
                packageId: itinerary.bespoke ? null : itinerary.packageId,
                itineraryId: itinerary.id,
                durationDays: itinerary.days?.length || requestedDays,
                dates: {
                    start: itinerary.dates?.start,
                    end: itinerary.dates?.end,
                },
                preferences,
                interests,
                stayPlan: persistedStayPlan.length ? persistedStayPlan : (resolved.stayPlan || stayPlanArg),
                tier: itinerary.tier ?? args.tier ?? ctx.intent?.tier,
            }, ctx.tab);
            ctx.intent = merged;
            if (ctx.onIntentUpdate) await ctx.onIntentUpdate(merged);

            const summary = tripSummaryFromIntent(merged, itinerary.quote, itinerary.milesEstimate);
            ctx.tripSummary = summary;
            if (ctx.onTripSummary) await ctx.onTripSummary(summary);
            if (ctx.onItineraryReady) await ctx.onItineraryReady(itinerary);

            const { projectItineraryForModel } = await import('./projections.js');
            return {
                ok: true,
                itinerary: projectItineraryForModel(itinerary, validation.warnings || []),
                warnings: validation.warnings || [],
            };
        } catch (err) {
            return {
                ok: false,
                error: err.message || 'Failed to compose itinerary',
                ...(err.code ? { code: err.code } : {}),
                ...(err.minimumDurationDays ? { minimumDurationDays: err.minimumDurationDays } : {}),
                ...(err.requestedDurationDays ? { requestedDurationDays: err.requestedDurationDays } : {}),
            };
        }
    }

    if (name === 'suggest_stops') {
        try {
            const { suggestStops } = await import('./catalog.js');
            const stops = suggestStops({
                anchors: args.anchors || [],
                count: args.count,
                totalDays: args.totalDays ?? ctx.intent?.durationDays,
                themes: args.themes || ctx.intent?.interests || [],
                tier: args.tier || ctx.intent?.tier,
            });
            return { ok: true, stops };
        } catch (err) {
            return { ok: false, error: err.message || 'Failed to suggest stops' };
        }
    }

    if (name === 'suggest_trip_enhancements') {
        try {
            const { suggestEnhancements } = await import('./catalog.js');
            const { displayCurrencyForOrigin } = await import('./display-currency.js');
            const packageId = args.packageId || ctx.intent?.packageId || ctx.itinerary?.packageId;
            if (!packageId) return { ok: false, error: 'packageId required' };
            const items = suggestEnhancements({
                packageId,
                destinations: args.destinations || ctx.itinerary?.destinations || [],
                limit: args.limit || 4,
                currency: displayCurrencyForOrigin(ctx.intent?.origin?.code || ctx.itinerary?.originIata),
            });
            ctx.enhancements = items;
            if (ctx.onEnhancements) await ctx.onEnhancements(items, packageId);
            const { projectEnhancementsForModel } = await import('./projections.js');
            return { ok: true, packageId, count: items.length, items: projectEnhancementsForModel(items) };
        } catch (err) {
            return { ok: false, error: err.message || 'Enhancement suggestions failed' };
        }
    }

    if (name === 'apply_itinerary_changes') {
        const { applyChangesThenCompose } = await import('./itinerary-changes.js');
        const previousIntent = ctx.intent;
        const previousItinerary = ctx.itinerary;
        const result = await applyChangesThenCompose({
            intent: ctx.intent,
            itinerary: ctx.itinerary,
            operations: args.operations,
            tab: ctx.tab,
            executeTool: async (toolName, toolArgs) => {
                if (toolName !== 'compose_itinerary') return { ok: false, error: 'unsupported' };
                return runTool(toolName, toolArgs, ctx);
            },
        });
        if (!result.ok || !result.changed) {
            ctx.intent = previousIntent;
            ctx.itinerary = previousItinerary;
            return result;
        }
        ctx.intent = result.intent;
        if (ctx.onIntentUpdate) await ctx.onIntentUpdate(result.intent);
        return result;
    }

    if (name === 'quote_trip') {
        try {
            const { displayCurrencyForOrigin, quoteItinerary } = await import('./pricing.js');
            const { estimateMiles } = await import('./miles.js');
            const packageId = args.packageId || ctx.intent?.packageId || null;
            const addOnProductIds = args.addOnProductIds || ctx.intent?.selectedAddOnIds || [];
            const productIds = args.productIds?.length
                ? args.productIds
                : (packageId ? [packageId] : []);
            if (!productIds.length && !packageId) {
                return { ok: false, error: 'productIds required' };
            }
            const quote = quoteItinerary({
                productIds,
                packageId: args.packageId || (addOnProductIds.length ? packageId : undefined),
                addOnProductIds,
                startDate: args.startDate,
                adults: args.adults ?? ctx.intent?.travelers?.adults,
                children: args.children ?? 0,
                cabin: args.cabin || 'Economy',
                tier: args.tier || 'classic',
                currency: displayCurrencyForOrigin(ctx.intent?.origin?.code),
            });
            const milesEstimate = estimateMiles({
                totalAmount: quote.totals?.GBP ?? quote.totalAmount,
                currency: 'GBP',
                cabin: args.cabin || 'Economy',
                tier: args.tier || 'classic',
            });
            const summary = tripSummaryFromIntent(ctx.intent, quote, milesEstimate);
            ctx.tripSummary = summary;
            if (ctx.onTripSummary) await ctx.onTripSummary(summary);
            if (ctx.onQuote) await ctx.onQuote(quote, milesEstimate);
            const { projectQuoteForModel } = await import('./projections.js');
            return { ok: true, quote: projectQuoteForModel(quote), milesEstimate };
        } catch (err) {
            return { ok: false, error: err.message || 'Quote failed' };
        }
    }

    return { error: `Unknown tool: ${name}` };
}

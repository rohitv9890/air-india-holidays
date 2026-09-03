import { randomUUID } from 'node:crypto';
import { getOpenRouterApiKey } from './secrets.js';
import { GUZO_TOOLS, runTool } from './tools.js';
import { buildSystemPrompt, buildTripContextMessage, projectIntentForModel } from './prompts.js';
import { sanitizeToolArgs, assessChatScope } from './guardrails.js';
import { parseChatRequest, resolveSessionIntent } from './chat-request.js';
import { putItinerary } from './itinerary-store.js';
import { displayCurrencyForOrigin } from './display-currency.js';
import { assertNoInternalFields, stripInternalFieldsForModel } from './projections.js';
import { isPackageIntentComplete } from './intent.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.GUZO_MODEL || 'openai/gpt-5.6-luna';
const BUILD_ITINERARY_PATTERN = /\b(build|create|compose|make)\b.{0,30}\bitinerary\b/i;
const READY_MADE_CROSS_SELL_INTRO = 'We also have ready-made packages with great value.';

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function applyExplicitNightCount(args, message, currentIntent) {
    if (/\b(extend|shorten)\b/i.test(String(message || ''))) return args;
    const match = String(message || '').match(/\b(\d{1,3})\s*[- ]?nights?\b/i);
    if (!match) return args;

    const nights = Number(match[1]);
    if (!Number.isInteger(nights) || nights < 1) return args;

    const start = args.dates?.start || currentIntent?.dates?.start;
    return {
        ...args,
        durationDays: nights + 1,
        ...(start ? {
            dates: {
                ...(args.dates || {}),
                start,
                end: addDays(start, nights),
            },
        } : {}),
    };
}

function sseLine(stream, payload) {
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function diagnosticResult(result) {
    return {
        ok: result?.ok !== false && !result?.error,
        count: result?.count,
        error: result?.error,
        packageId: result?.itinerary?.packageId || result?.itinerary?.sourcePackageId,
        itineraryId: result?.itinerary?.id,
        days: result?.itinerary?.days?.length,
        bespoke: result?.itinerary?.bespoke,
        productIds: result?.items?.slice?.(0, 10).map((item) => item.id),
    };
}

export function prepareToolResultForModel(result) {
    try {
        assertNoInternalFields(result);
        return result;
    } catch (err) {
        console.warn('Stripping internal fields from model tool result:', err.message);
        return stripInternalFieldsForModel(result);
    }
}

export function shouldEmitRecommendations({
    activeTab = 'packages',
    intent,
    recommendations,
    hadItineraryAtStart = false,
} = {}) {
    return Boolean(
        recommendations?.length
        && !hadItineraryAtStart
        && (activeTab !== 'packages' || isPackageIntentComplete(intent)),
    );
}

export async function handleChatStream(body, responseStream) {
    const parsed = parseChatRequest(body);
    if (!parsed.ok) {
        sseLine(responseStream, { type: 'error', message: parsed.error });
        sseLine(responseStream, { type: 'done' });
        responseStream.end();
        return;
    }

    const { message, tab, sessionId, clientIntent } = parsed.request;

    const {
        upsertSession,
        appendMessage,
        appendDiagnostic,
        saveIntent,
        saveItinerary,
    } = await import('./sessions.js');
    const {
        getPackageMissingFields,
        mergeIntent,
    } = await import('./intent.js');

    const sid = sessionId || `guzo_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const session = await upsertSession(sid, { tab });
    const scope = assessChatScope(message, { hasActiveTrip: Boolean(session?.itinerary?.id) });
    if (!scope.inScope) {
        sseLine(responseStream, { type: 'text_delta', content: scope.reply });
        sseLine(responseStream, { type: 'done' });
        responseStream.end();
        return;
    }

    const activeTab = tab || session?.tab || 'packages';
    let intent = resolveSessionIntent({
        sessionIntent: session?.intent,
        clientIntent,
        tab: activeTab,
    });
    const hadItineraryAtStart = Boolean(session?.itinerary?.id);

    const ctx = {
        tab: activeTab,
        intent,
        itinerary: session?.itinerary || null,
        async onIntentUpdate(merged) {
            intent = merged;
            sseLine(responseStream, { type: 'intent_update', intent: merged });
            if (sid) await saveIntent(sid, merged);
        },
        async onRecommendations(items) {
            sseLine(responseStream, { type: 'recommendations', items: items || [] });
        },
        async onTripSummary(summary) {
            sseLine(responseStream, { type: 'trip_summary', summary: summary || {} });
        },
        async onEnhancements(items, packageId) {
            sseLine(responseStream, {
                type: 'enhancement_suggestions',
                packageId,
                items: items || [],
            });
        },
        async onQuote(quote, milesEstimate) {
            sseLine(responseStream, { type: 'composite_quote', quote, milesEstimate });
        },
        async onItineraryReady(itinerary) {
            putItinerary(itinerary);
            ctx.itinerary = itinerary;
            sseLine(responseStream, { type: 'itinerary_ready', itinerary });
            if (sid) await saveItinerary(sid, itinerary);
        },
    };

    const history = (session?.messages || []).slice(-12).map(m => ({
        role: m.role,
        content: m.content,
    }));

    const messages = [
        { role: 'system', content: buildSystemPrompt(activeTab, { today: new Date().toISOString().slice(0, 10) }) },
        ...history,
        buildTripContextMessage(projectIntentForModel(intent, getPackageMissingFields(intent))),
        { role: 'user', content: message.trim() },
    ];

    if (sid) await appendMessage(sid, 'user', message.trim());

    const executeTool = async (name, args) => {
        let cleanArgs = sanitizeToolArgs(args);
        if (name === 'extract_trip_intent' || name === 'update_package_intent') {
            cleanArgs = applyExplicitNightCount(cleanArgs, message, intent);
        }
        if (sid) await appendDiagnostic(sid, { type: 'tool_call', name, args: cleanArgs });
        const result = await runTool(name, cleanArgs, ctx);
        if (sid) {
            await appendDiagnostic(sid, {
                type: 'tool_result',
                name,
                result: diagnosticResult(result),
            });
        }
        return result;
    };

    if (
        activeTab === 'packages'
        && BUILD_ITINERARY_PATTERN.test(message)
        && isPackageIntentComplete(intent)
    ) {
        const { getProduct, rankPackagesForIntent, toRecommendation } = await import('./catalog.js');
        const selected = intent.packageId ? getProduct(intent.packageId) : null;
        const matches = rankPackagesForIntent(intent, { limit: 4 });
        const closest = selected?.type === 'package' ? selected : matches[0];
        const wantsBespoke = /\b(bespoke|custom|exact|tailor(?:-|\s)?made)\b/i.test(message)
            || (intent.durationDays
                && closest?.duration?.days
                && Number(intent.durationDays) !== Number(closest.duration.days));

        if (closest || wantsBespoke) {
            const result = await executeTool('compose_itinerary', {
                packageId: wantsBespoke ? (closest?.id || intent.packageId || undefined) : closest?.id,
                destination: intent.destination,
                durationDays: intent.durationDays,
                startDate: intent.dates?.start,
                endDate: intent.dates?.end,
                originIata: intent.origin?.code,
                adults: intent.travelers?.adults,
                children: intent.travelers?.children,
                childAges: intent.travelers?.childAges,
                cabin: intent.cabin,
                tier: intent.tier,
                preferences: intent.preferences,
                stayPlan: intent.stayPlan,
                interests: intent.interests,
                bespoke: wantsBespoke,
            });
            const { formatItineraryReadyReply } = await import('./projections.js');
            const reply = result.ok
                ? formatItineraryReadyReply(result)
                : result.code === 'minimum-duration'
                    ? `${result.error} I can build the shortest sensible option if you extend the trip.`
                    : 'I found suitable holidays, but I could not finish your itinerary just now. Please try again.';
            sseLine(responseStream, { type: 'text_delta', content: reply });
            if (sid) await appendMessage(sid, 'assistant', reply);
            if (result.ok && matches.length && !hadItineraryAtStart) {
                ctx.recommendations = matches;
                sseLine(responseStream, {
                    type: 'cross_sell_packages',
                    intro: READY_MADE_CROSS_SELL_INTRO,
                    items: matches.map((item) => toRecommendation(item, {
                        currency: displayCurrencyForOrigin(intent.origin?.code),
                    })),
                });
            }
            sseLine(responseStream, { type: 'done' });
            responseStream.end();
            return;
        }
    }

    const apiKey = await getOpenRouterApiKey();
    let pendingMessages = [...messages];
    let emittedText = '';
    const maxToolRounds = 4;

    for (let round = 0; round < maxToolRounds; round++) {
        const res = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://ethiopianholidays.com',
                'X-Title': 'Guzo Ethiopian Holidays',
            },
            body: JSON.stringify({
                model: MODEL,
                messages: pendingMessages,
                tools: GUZO_TOOLS,
                stream: true,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('OpenRouter error:', res.status, errText);
            sseLine(responseStream, { type: 'error', message: 'Upstream model error' });
            break;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        const toolCalls = new Map();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                let chunk;
                try {
                    chunk = JSON.parse(data);
                } catch {
                    continue;
                }

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    assistantContent += delta.content;
                    emittedText += delta.content;
                    sseLine(responseStream, { type: 'text_delta', content: delta.content });
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCalls.has(idx)) {
                            toolCalls.set(idx, { id: tc.id, name: '', arguments: '' });
                        }
                        const entry = toolCalls.get(idx);
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name = tc.function.name;
                        if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                    }
                }
            }
        }

        if (toolCalls.size === 0) {
            if (assistantContent && sid) {
                await appendMessage(sid, 'assistant', assistantContent);
            }
            break;
        }

        const assistantToolMsg = {
            role: 'assistant',
            content: assistantContent || null,
            tool_calls: [...toolCalls.values()].map((tc, i) => ({
                id: tc.id || `call_${round}_${i}`,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
            })),
        };

        pendingMessages = [...pendingMessages, assistantToolMsg];

        for (const tc of assistantToolMsg.tool_calls) {
            let args = {};
            try {
                args = JSON.parse(tc.function.arguments || '{}');
            } catch {
                args = {};
            }

            const result = await executeTool(tc.function.name, args);
            const modelResult = prepareToolResultForModel(result);
            pendingMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(modelResult),
            });
        }
    }

    const recommendationChoicesReady = activeTab !== 'packages'
        || isPackageIntentComplete(intent);

    if (
        activeTab === 'packages'
        && !ctx.itinerary
        && !ctx.recommendations?.length
        && recommendationChoicesReady
    ) {
        const { rankPackagesForIntent } = await import('./catalog.js');
        const matches = rankPackagesForIntent(intent, { limit: 4 });
        if (matches.length) {
            ctx.recommendations = matches;
        }
    }

    if (!emittedText.trim()) {
        let fallback = '';
        if (ctx.itinerary) {
            const { formatItineraryReadyReply } = await import('./projections.js');
            fallback = formatItineraryReadyReply({ itinerary: ctx.itinerary, warnings: ctx.itinerary.warnings || [] });
        } else if (!ctx.recommendations?.length || !recommendationChoicesReady) {
            // Ready-made cards + tailor-made CTA carry the offer when matches exist.
            fallback = 'I have those trip details. Tell me what matters most, and I’ll find a great Ethiopia holiday.';
        }
        if (fallback) {
            sseLine(responseStream, { type: 'text_delta', content: fallback });
            if (sid) await appendMessage(sid, 'assistant', fallback);
        }
    }

    // Emit package cards once, after text — and after a new custom itinerary as a cross-sell.
    if (shouldEmitRecommendations({
        activeTab,
        intent,
        recommendations: ctx.recommendations,
        hadItineraryAtStart,
    })) {
        const { toRecommendation } = await import('./catalog.js');
        const displayCurrency = displayCurrencyForOrigin(intent?.origin?.code);
        const items = ctx.recommendations.map((item) => (
            item?.title != null && item?.id
                ? item
                : toRecommendation(item, { currency: displayCurrency })
        ));
        if (ctx.itinerary) {
            sseLine(responseStream, {
                type: 'cross_sell_packages',
                intro: READY_MADE_CROSS_SELL_INTRO,
                items,
            });
        } else {
            await ctx.onRecommendations(items);
        }
    }

    sseLine(responseStream, { type: 'done' });
    responseStream.end();
}

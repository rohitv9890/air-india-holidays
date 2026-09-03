import { GUZO_CONFIG } from './guzo-config.js';
import {
    guzoState,
    subscribe,
    setInputMode,
    setPanelOpen,
    setHistoryOpen,
    setActiveTab,
    addMessage,
    setSingletonMessage,
    updateMessageContent,
    setTyping,
    setPendingIntent,
    setTripSummary,
    setRecommendations,
    markReadyMadeOffered,
    setItineraryId,
    setSelectedProductId,
    setItineraryReady,
    ensureItineraryCta,
    setEnhancements,
    toggleSelectedEnhancement,
    setCompositeQuote,
    hasGreeting,
    startNewSession,
    adoptSessionId,
    hydrateFromSession,
    touchSessionHistory,
} from './guzo-state.js';
import { fetchSession, fetchEnhancements, quoteCompositeTrip } from './guzo-client.js';
import { getActiveSearchTab, expandSearchPanelIfSticky } from './guzo-context.js';
import {
    planFromMessage,
    evaluateTripIntent,
    searchCatalogForTab,
    BUILD_ITINERARY_PATTERN,
} from './guzo-planner.js';
import { getGreeting } from './guzo-mock.js';
import { getMaharajaClubWelcome } from './guzo-auth.js';
import { initModeToggle } from './guzo-mode-toggle.js';
import { initVoice } from './guzo-voice.js';
import { executeSearch, isSearchApiReady } from './guzo-search-engine.js';
import { getMissingFieldsForAction, PLACE_ALIASES } from './guzo-intent.js';
import {
    renderMessagesContainer,
    renderChipsContainer,
    renderTripSummaryStrip,
    formatOriginLabel,
    formatTravelersRoomsLabel,
    updateSubtitles,
    updateMaharajaBanner,
    syncPanelVisibility,
    refreshIcons,
} from './guzo-ui.js';
import { fetchCatalog, intentToTripSummary } from './guzo-catalog-client.js';
import {
    catalogEnhancements,
    compactQuoteSummary,
    READY_MADE_PATH_INTRO,
    READY_MADE_PATH_LABEL,
    resolveReadyMadeIntro,
} from './guzo-enhancements.js';

const SEARCH_NOW_PATTERN = /^search\s*now\.?$/i;
const VIEW_ITINERARY_PATTERN = /^view\s+itinerary\.?$/i;

function formatChatPrice(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(Math.round(Number(amount) || 0));
}

function renderAll(state) {
    const activeSurface = state.panelOpen ? 'panel' : 'inline';
    const inactiveSurface = state.panelOpen ? 'inline' : 'panel';

    renderMessagesContainer(
        document.getElementById(`guzo-${activeSurface}-messages`),
        state.messages,
        state.isTyping,
    );
    renderChipsContainer(
        document.getElementById(`guzo-${activeSurface}-chips`),
        state.activeTab,
    );
    renderTripSummaryStrip(
        document.getElementById(`guzo-${activeSurface}-trip-summary`),
        state.pendingIntent,
    );
    enhanceTripSummary(`guzo-${activeSurface}-trip-summary`, state.pendingIntent);

    // Keep the dormant surface empty so it cannot scroll or receive input alongside the active one.
    const inactiveMessages = document.getElementById(`guzo-${inactiveSurface}-messages`);
    if (inactiveMessages) inactiveMessages.innerHTML = '';
    const inactiveChips = document.getElementById(`guzo-${inactiveSurface}-chips`);
    if (inactiveChips) {
        inactiveChips.innerHTML = '';
        inactiveChips.classList.add('hidden');
    }
    const inactiveSummary = document.getElementById(`guzo-${inactiveSurface}-trip-summary`);
    if (inactiveSummary) {
        inactiveSummary.classList.add('hidden');
        inactiveSummary.innerHTML = '';
    }

    updateSubtitles(state);
    updateMaharajaBanner();
    syncPanelVisibility(state);
    refreshIcons();
}

function ensureGreeting() {
    if (hasGreeting()) return;

    const welcome = getMaharajaClubWelcome();
    if (welcome) {
        addMessage({ role: 'assistant', type: 'greeting', content: welcome });
    }
    addMessage(getGreeting(guzoState.activeTab));
}

function applyPlanMeta(result) {
    if (result.intent) setPendingIntent(result.intent);
    if (result.tripSummary) setTripSummary(result.tripSummary);
    if (result.recommendations && shouldOfferTwoPaths(result.intent || guzoState.pendingIntent)) {
        setRecommendations(result.recommendations);
    }
    if (result.itineraryId) setItineraryId(result.itineraryId);
    if (result.itineraryReady != null) setItineraryReady(result.itineraryReady);
    if (result.enhancements) setEnhancements(result.enhancements);
    if (result.compositeQuote) setCompositeQuote(compactQuoteSummary(result.compositeQuote));
    if (result.itinerary) {
        try {
            sessionStorage.setItem('guzoItinerary', JSON.stringify(result.itinerary));
        } catch {
            // ignore
        }
    }
}

function shouldOfferTwoPaths(intent = guzoState.pendingIntent) {
    return Boolean(intent)
        && getMissingFieldsForAction(intent, {
            tab: 'packages',
            action: 'compose',
        }).length === 0;
}

function showApiRecommendations(items) {
    if (!shouldOfferTwoPaths()) {
        setRecommendations([]);
        return;
    }
    setRecommendations(items);
    if (!Array.isArray(items) || !items.length) return;
    if (guzoState.readyMadeOffered) return;
    if (shouldOfferTwoPaths()) {
        showReadyMadeCrossSell(items);
        return;
    }
    // One rail only — replace rather than stacking mid-thread cards.
    setSingletonMessage('product_cards', {
        role: 'assistant',
        items,
    });
}

function showReadyMadeCrossSell(items, intro = READY_MADE_PATH_INTRO) {
    if (guzoState.readyMadeOffered) return;
    if (!Array.isArray(items) || !items.length) return;
    if (!guzoState.itineraryId && !shouldOfferTwoPaths()) return;
    setRecommendations(items);
    // Drop any earlier discovery cards so only one ready-made rail follows the build.
    guzoState.messages = guzoState.messages.filter((m) => m.type !== 'product_cards');
    setSingletonMessage('product_cards', {
        role: 'assistant',
        items,
        pathLabel: READY_MADE_PATH_LABEL,
        intro: resolveReadyMadeIntro(intro),
    });
    markReadyMadeOffered();
}

async function showTailoringOptions() {
    const packageId = guzoState.selectedProductId
        || guzoState.pendingIntent?.packageId
        || guzoState.tripSummary?.packageId;
    if (!packageId) {
        addMessage({ role: 'assistant', type: 'text', content: 'Choose a holiday first, then I can show relevant ways to tailor it.' });
        return;
    }
    try {
        const payload = useApiChat()
            ? await fetchEnhancements(packageId)
            : { items: catalogEnhancements(await fetchCatalog(), packageId) };
        setEnhancements(payload.items);
        if (!payload.items.length) {
            addMessage({ role: 'assistant', type: 'text', content: 'There are no catalogued additions for this trip right now. Your current plan is unchanged.' });
            return;
        }
        setSingletonMessage('enhancement_cards', { role: 'assistant', items: payload.items });
    } catch (err) {
        console.warn('Could not load enhancements:', err);
        addMessage({ role: 'assistant', type: 'text', content: 'I could not load optional additions just now. Your current trip is unchanged.' });
    }
}

async function refreshCompositeQuote() {
    const intent = guzoState.pendingIntent || {};
    const packageId = guzoState.selectedProductId || intent.packageId;
    if (!packageId || !intent.dates?.start || !useApiChat()) {
        addMessage({
            role: 'assistant',
            type: 'text',
            content: 'Your choices are saved. I can show the combined price once live pricing and travel dates are available.',
        });
        return;
    }
    try {
        const result = await quoteCompositeTrip({
            packageId,
            addOnProductIds: guzoState.selectedEnhancementIds,
            startDate: intent.dates.start,
            adults: intent.travelers?.adults || 2,
            children: intent.travelers?.children || 0,
            rooms: intent.travelers?.rooms || 1,
            cabin: intent.cabin || 'Economy',
            tier: intent.tier || 'classic',
            originIata: intent.origin?.code,
            currency: intent.budget?.currency,
        });
        const summary = compactQuoteSummary(result.quote);
        setCompositeQuote(summary);
        setSingletonMessage('quote_summary', { role: 'assistant', quote: summary });
    } catch (err) {
        addMessage({ role: 'assistant', type: 'text', content: `I could not price that combination: ${err.message}` });
    }
}

async function handlePlanResult(result, { skipAddResponse = false } = {}) {
    applyPlanMeta(result);
    if (skipAddResponse) return;

    const messages = result.responses?.length
        ? result.responses
        : (result.response ? [result.response] : []);

    for (const msg of messages) {
        addMessage(msg);
    }
}

function useApiChat() {
    return !GUZO_CONFIG.mockMode && Boolean(GUZO_CONFIG.apiUrl);
}

function openItineraryPage(itineraryId) {
    const id = itineraryId || guzoState.itineraryId || 'itinerary-golden-triangle-6d';
    const url = new URL('itinerary.html', window.location.href);
    url.searchParams.set('id', id);
    window.location.href = url.toString();
}

async function runSearch(intent, tab) {
    // Offline / mock: surface catalog inventory instead of EasyGDS redirect
    if (GUZO_CONFIG.mockMode || !GUZO_CONFIG.apiUrl) {
        setTyping(true);
        try {
            const result = await searchCatalogForTab(intent, tab);
            setTyping(false);
            await handlePlanResult(result);
        } catch (err) {
            console.error('Guzo catalog search error:', err);
            setTyping(false);
            addMessage({
                role: 'assistant',
                type: 'text',
                content: 'I could not find holiday options just now. Please try again.',
            });
        }
        return;
    }

    if (!isSearchApiReady()) {
        addMessage({
            role: 'assistant',
            type: 'text',
            content: 'Search is still loading - please wait a moment and try again.',
        });
        return;
    }

    try {
        executeSearch(intent, tab);
    } catch (err) {
        console.error('Guzo search error:', err);
        addMessage({
            role: 'assistant',
            type: 'text',
            content: 'I could not start the search. Please try again.',
        });
    }
}

async function triggerSearchNow({ showUserMessage = true } = {}) {
    if (guzoState.isTyping) return;

    const intent = guzoState.pendingIntent;
    const tab = intent?.productTab || guzoState.activeTab;

    if (!intent) {
        addMessage({
            role: 'assistant',
            type: 'text',
            content: 'Tell me about your trip first - where, when, and who is travelling?',
        });
        return;
    }

    setTyping(true);
    const result = await evaluateTripIntent(intent, tab);
    setTyping(false);

    setPendingIntent(result.intent);

    if (!result.complete) {
        addMessage(result.response);
        return;
    }

    if (showUserMessage) {
        addMessage({ role: 'user', type: 'text', content: 'Search now' });
    }

    if (!(GUZO_CONFIG.mockMode || !GUZO_CONFIG.apiUrl)) {
        addMessage({
            role: 'assistant',
            type: 'text',
            content: 'On it - taking you to results now!',
        });
    }

    await runSearch(result.intent, tab);
}

async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || guzoState.isTyping) return;

    if (VIEW_ITINERARY_PATTERN.test(trimmed)) {
        addMessage({ role: 'user', type: 'text', content: trimmed });
        if (guzoState.itineraryId || sessionStorage.getItem('guzoItinerary')) {
            openItineraryPage(guzoState.itineraryId);
            return;
        }
        // No itinerary yet — build one first
        setTyping(true);
        try {
            const result = await planFromMessage('Build my itinerary', guzoState.activeTab, guzoState.pendingIntent);
            setTyping(false);
            await handlePlanResult(result);
            if (result.itineraryId) openItineraryPage(result.itineraryId);
        } catch (err) {
            console.error('Guzo itinerary error:', err);
            setTyping(false);
            addMessage({
                role: 'assistant',
                type: 'text',
                content: 'I could not open the itinerary. Try Build my itinerary first.',
            });
        }
        return;
    }

    if (SEARCH_NOW_PATTERN.test(trimmed)) {
        addMessage({ role: 'user', type: 'text', content: trimmed });
        await triggerSearchNow({ showUserMessage: false });
        return;
    }

    addMessage({ role: 'user', type: 'text', content: trimmed });
    touchSessionHistory({
        title: trimmed,
        preview: '',
        tab: guzoState.activeTab,
    });

    const streaming = useApiChat();
    let streamMsgId = null;
    let pendingRecommendations = null;
    let pendingCrossSell = null;

    if (streaming) {
        addMessage({ role: 'assistant', type: 'text', content: '' });
        streamMsgId = guzoState.messages[guzoState.messages.length - 1].id;
    } else {
        setTyping(true);
    }

    try {
        const result = await planFromMessage(trimmed, guzoState.activeTab, guzoState.pendingIntent, {
            onTextDelta: (fullText) => {
                if (streamMsgId) updateMessageContent(streamMsgId, fullText);
            },
            onIntentUpdate: (intent) => setPendingIntent(intent),
            onRecommendations: (items) => {
                pendingRecommendations = items;
            },
            onCrossSellPackages: (intro, items) => {
                pendingCrossSell = { intro, items };
                setRecommendations(items);
            },
            onTripSummary: (summary) => setTripSummary(summary),
            onItineraryReady: (id, itinerary) => {
                setItineraryId(id);
                setItineraryReady(true);
                if (itinerary) {
                    try {
                        sessionStorage.setItem('guzoItinerary', JSON.stringify(itinerary));
                    } catch {
                        // ignore
                    }
                }
            },
            onEnhancements: (items) => setEnhancements(items),
            onCompositeQuote: (quote) => setCompositeQuote(compactQuoteSummary(quote)),
        });

        if (!streaming) setTyping(false);

        if (streaming) {
            if (streamMsgId && result.response?.content) {
                updateMessageContent(streamMsgId, result.response.content);
            }
            applyPlanMeta(result);
            if (result.responses?.length) {
                for (const msg of result.responses.slice(1)) addMessage(msg);
            }
        } else {
            await handlePlanResult(result);
        }

        const crossSell = pendingCrossSell || result.crossSell;
        if (crossSell?.items?.length) {
            showReadyMadeCrossSell(crossSell.items, resolveReadyMadeIntro(crossSell.intro));
        } else if (
            !result.itineraryId
            && !guzoState.itineraryId
            && (pendingRecommendations || result.recommendations)?.length
            && !guzoState.readyMadeOffered
        ) {
            // Discovery only — a single card rail, replaced rather than stacked.
            showApiRecommendations(pendingRecommendations || result.recommendations);
        }

        const itineraryId = result.itineraryId || guzoState.itineraryId;
        if (itineraryId) {
            ensureItineraryCta(itineraryId, result.itinerary);
        } else if (guzoState.readyMadeOffered && shouldOfferTwoPaths()) {
            ensureItineraryCta(null);
        }

        const assistantPreview = result.response?.content
            || result.responses?.find(m => m.role === 'assistant')?.content
            || '';
        touchSessionHistory({
            title: trimmed,
            preview: assistantPreview,
            tab: guzoState.activeTab,
        });
    } catch (err) {
        console.error('Guzo chat error:', err);
        if (!streaming) setTyping(false);
        if (streamMsgId) {
            updateMessageContent(streamMsgId, 'Sorry, something went wrong. Please try again.');
        } else {
            addMessage({
                role: 'assistant',
                type: 'text',
                content: 'Sorry, something went wrong. Please try again.',
            });
        }
    }
}

function bindInput(inputId, sendId) {
    const input = document.getElementById(inputId);
    const sendBtn = document.getElementById(sendId);
    if (!input || !sendBtn) return;

    const doSend = () => {
        sendMessage(input.value);
        input.value = '';
        input.style.height = 'auto';
        input.focus();
    };

    sendBtn.addEventListener('click', doSend);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 128) + 'px';
    });
}

function bindChips(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.guzo-chip');
        if (!chip) return;
        const text = chip.textContent.trim();
        if (VIEW_ITINERARY_PATTERN.test(text) && (guzoState.itineraryId || sessionStorage.getItem('guzoItinerary'))) {
            openItineraryPage(guzoState.itineraryId);
            return;
        }
        sendMessage(text);
    });
}

function bindMessageActions(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', (e) => {
        const card = e.target.closest('[data-guzo-card]');
        if (card) {
            const id = card.dataset.guzoCard;
            setSelectedProductId(id);
            if (guzoState.pendingIntent) {
                setPendingIntent({
                    ...guzoState.pendingIntent,
                    packageId: id,
                });
            }
            const product = guzoState.recommendations.find(r => r.id === id);
            if (product) {
                addMessage({
                    role: 'assistant',
                    type: 'text',
                    content: `Selected ${product.title}${product.priceFrom != null ? ` (from ${formatChatPrice(product.priceFrom, product.currency)} per person)` : ''}. Tap Build my itinerary when you're ready.`,
                });
                setSingletonMessage('actions', {
                    role: 'assistant',
                    actions: [{ id: 'tailor_trip', label: 'Tailor this trip' }],
                });
            }
            return;
        }

        const cta = e.target.closest('[data-guzo-itinerary-cta]');
        if (cta) {
            const itineraryId = cta.dataset.itineraryId || guzoState.itineraryId;
            if (itineraryId) {
                openItineraryPage(itineraryId);
                return;
            }
            sendMessage('Build my itinerary');
            return;
        }

        const action = e.target.closest('[data-guzo-action]');
        if (action) {
            const label = action.dataset.guzoAction;
            if (label === 'build_itinerary' || BUILD_ITINERARY_PATTERN.test(label)) {
                sendMessage('Build my itinerary');
            } else if (label === 'tailor_trip' || /tailor|enhance/i.test(action.textContent)) {
                showTailoringOptions();
            } else if (action.dataset.href) {
                window.location.href = action.dataset.href;
            } else {
                sendMessage(action.textContent.trim());
            }
        }

        const enhancement = e.target.closest('[data-guzo-enhancement]');
        if (enhancement) {
            const selectedAddOnIds = toggleSelectedEnhancement(enhancement.dataset.guzoEnhancement);
            if (guzoState.pendingIntent) {
                setPendingIntent({ ...guzoState.pendingIntent, selectedAddOnIds });
            }
            refreshCompositeQuote();
        }
    });
}

function resolveOriginInput(value, inputEl) {
    const trimmed = (value || '').trim();
    if (!trimmed && !inputEl?.dataset?.code) return null;

    if (inputEl?.dataset?.code) {
        const code = String(inputEl.dataset.code).toUpperCase();
        const name = trimmed.replace(/\s*\([A-Za-z]{3}\)\s*$/, '').trim() || code;
        return {
            name,
            code,
            type: inputEl.dataset.selType || 'airport_code',
            id: inputEl.dataset.id || undefined,
        };
    }

    const lower = trimmed.toLowerCase();
    const codeMatch = trimmed.match(/\(([A-Za-z]{3})\)/);
    if (PLACE_ALIASES[lower]) return { ...PLACE_ALIASES[lower] };
    let best = null;
    let bestLen = 0;
    for (const [key, place] of Object.entries(PLACE_ALIASES)) {
        if (lower.includes(key) && key.length > bestLen) {
            best = place;
            bestLen = key.length;
        }
    }
    if (best) return { ...best };
    if (codeMatch) {
        return {
            name: trimmed.replace(/\s*\([A-Za-z]{3}\)/, '').trim() || codeMatch[1],
            code: codeMatch[1].toUpperCase(),
            type: 'airport_code',
        };
    }
    if (/^[A-Za-z]{3}$/.test(trimmed)) {
        return { name: trimmed.toUpperCase(), code: trimmed.toUpperCase(), type: 'airport_code' };
    }
    return { name: trimmed, code: null, type: 'place_id' };
}

function roomsFromIntent(intent) {
    const t = intent?.travelers || { adults: 2, children: 0, childAges: [], infants: 0, rooms: 1 };
    const roomCount = Math.max(1, Number(t.rooms) || 1);
    const adults = Number(t.adults) || 2;
    const childAges = Array.isArray(t.childAges) && t.childAges.length
        ? [...t.childAges]
        : Array.from({ length: Number(t.children) || 0 }, () => 8);
    const infants = Number(t.infants) || 0;

    if (roomCount === 1) {
        return [{ id: 1, adults, children: childAges, infants }];
    }

    const rooms = [];
    let adultsLeft = adults;
    let childrenLeft = [...childAges];
    let infantsLeft = infants;
    for (let i = 0; i < roomCount; i++) {
        const roomsRemaining = roomCount - i;
        const roomAdults = Math.max(1, Math.ceil(adultsLeft / roomsRemaining));
        const roomChildrenCount = Math.ceil(childrenLeft.length / roomsRemaining);
        const roomInfants = Math.ceil(infantsLeft / roomsRemaining);
        rooms.push({
            id: i + 1,
            adults: roomAdults,
            children: childrenLeft.splice(0, roomChildrenCount),
            infants: roomInfants,
        });
        adultsLeft -= roomAdults;
        infantsLeft -= roomInfants;
    }
    return rooms;
}

function travelersFromRooms(rooms) {
    const list = Array.isArray(rooms) && rooms.length ? rooms : [{ adults: 2, children: [], infants: 0 }];
    return {
        adults: list.reduce((n, r) => n + (r.adults || 0), 0),
        children: list.reduce((n, r) => n + (r.children?.length || 0), 0),
        childAges: list.flatMap(r => r.children || []),
        infants: list.reduce((n, r) => n + (r.infants || 0), 0),
        rooms: list.length,
    };
}

function applyTripSummaryIntent(mutator) {
    if (!guzoState.pendingIntent) return;
    const intent = structuredClone(guzoState.pendingIntent);
    if (!intent.travelers) {
        intent.travelers = { adults: 2, children: 0, childAges: [], infants: 0, rooms: 1 };
    }
    mutator(intent);
    setPendingIntent(intent);
    setTripSummary(intentToTripSummary(intent));
}

function renderSummaryRooms(container) {
    const roomsContainer = container.querySelector('[data-summary-rooms-container]');
    const summaryInput = container.querySelector('[data-summary-field="travelers"]');
    if (!roomsContainer) return;

    const rooms = container._guzoRooms || roomsFromIntent(guzoState.pendingIntent);
    container._guzoRooms = rooms;
    roomsContainer.innerHTML = '';

    rooms.forEach((room, index) => {
        const roomEl = document.createElement('div');
        roomEl.className = 'guzo-summary-room';

        const header = document.createElement('div');
        header.className = 'guzo-summary-room-header';
        header.innerHTML = `<strong>Room ${index + 1}</strong>`;
        if (rooms.length > 1) {
            const rmBtn = document.createElement('button');
            rmBtn.type = 'button';
            rmBtn.className = 'guzo-summary-remove-room';
            rmBtn.textContent = 'Remove';
            rmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                rooms.splice(index, 1);
                renderSummaryRooms(container);
                commitTravelersFromRooms(container);
            });
            header.appendChild(rmBtn);
        }
        roomEl.appendChild(header);

        const createRow = (label, val, min, onChange) => {
            const row = document.createElement('div');
            row.className = 'guzo-summary-counter-row';
            row.innerHTML = `<span>${label}</span>`;
            const ctrls = document.createElement('div');
            ctrls.className = 'guzo-summary-counter';

            const btnM = document.createElement('button');
            btnM.type = 'button';
            btnM.textContent = '−';
            btnM.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (val > min) onChange(val - 1);
            });

            const txt = document.createElement('span');
            txt.textContent = String(val);

            const btnP = document.createElement('button');
            btnP.type = 'button';
            btnP.textContent = '+';
            btnP.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(val + 1);
            });

            ctrls.append(btnM, txt, btnP);
            row.appendChild(ctrls);
            return row;
        };

        roomEl.appendChild(createRow('Adults', room.adults, 1, (v) => {
            room.adults = v;
            renderSummaryRooms(container);
            commitTravelersFromRooms(container);
        }));
        roomEl.appendChild(createRow('Children', room.children.length, 0, (v) => {
            const delta = v - room.children.length;
            if (delta > 0) for (let i = 0; i < delta; i++) room.children.push(8);
            else room.children.splice(delta);
            renderSummaryRooms(container);
            commitTravelersFromRooms(container);
        }));
        roomEl.appendChild(createRow('Infants', room.infants, 0, (v) => {
            room.infants = v;
            renderSummaryRooms(container);
            commitTravelersFromRooms(container);
        }));

        if (room.children.length) {
            const ages = document.createElement('div');
            ages.className = 'guzo-summary-child-ages';
            room.children.forEach((age, ai) => {
                const wrap = document.createElement('label');
                wrap.innerHTML = `<span>Child ${ai + 1} age</span>`;
                const sel = document.createElement('select');
                for (let k = 2; k <= 17; k++) {
                    const opt = document.createElement('option');
                    opt.value = String(k);
                    opt.textContent = String(k);
                    if (k === age) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.addEventListener('change', (e) => {
                    room.children[ai] = parseInt(e.target.value, 10);
                    commitTravelersFromRooms(container);
                });
                sel.addEventListener('click', (e) => e.stopPropagation());
                wrap.appendChild(sel);
                ages.appendChild(wrap);
            });
            roomEl.appendChild(ages);
        }

        roomsContainer.appendChild(roomEl);
    });

    if (summaryInput) {
        summaryInput.value = formatTravelersRoomsLabel(travelersFromRooms(rooms));
    }
}

function commitTravelersFromRooms(container) {
    const rooms = container._guzoRooms || roomsFromIntent(guzoState.pendingIntent);
    applyTripSummaryIntent((intent) => {
        intent.travelers = { ...intent.travelers, ...travelersFromRooms(rooms) };
    });
}

function enhanceTripSummary(containerId, intent) {
    const container = document.getElementById(containerId);
    if (!container || container.classList.contains('hidden') || !intent) return;
    if (!container.querySelector('.guzo-trip-summary-inner')) return;

    if (container.dataset.guzoEnhanced === '1') {
        if (!container._guzoRooms || !container.querySelector('[data-summary-traveler-popover]:not(.hidden)')) {
            container._guzoRooms = roomsFromIntent(intent);
        }
        return;
    }

    container.dataset.guzoEnhanced = '1';
    container._guzoRooms = roomsFromIntent(intent);

    const datesInput = container.querySelector('[data-summary-field="dates"]');
    if (datesInput && typeof window.flatpickr === 'function' && !datesInput._flatpickr) {
        const defaults = [];
        if (intent.dates?.start) defaults.push(intent.dates.start);
        if (intent.dates?.end) defaults.push(intent.dates.end);
        window.flatpickr(datesInput, {
            mode: 'range',
            dateFormat: 'Y-m-d',
            minDate: 'today',
            defaultDate: defaults.length ? defaults : undefined,
            appendTo: document.body,
            onClose: (selectedDates, _str, instance) => {
                if (!selectedDates.length) return;
                const start = instance.formatDate(selectedDates[0], 'Y-m-d');
                const end = selectedDates[1]
                    ? instance.formatDate(selectedDates[1], 'Y-m-d')
                    : (guzoState.pendingIntent?.dates?.end || null);
                applyTripSummaryIntent((intentNext) => {
                    intentNext.dates = { ...intentNext.dates, start, end };
                });
            },
        });
    }

    const originInput = container.querySelector('[data-summary-field="origin"]');
    if (originInput && typeof window.EHSearch?.setupAutocomplete === 'function') {
        window.EHSearch.setupAutocomplete(originInput);
        originInput.addEventListener('input', () => {
            delete originInput.dataset.code;
            delete originInput.dataset.id;
            delete originInput.dataset.selType;
        });
    }

    renderSummaryRooms(container);
}

function bindTripSummary(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('change', (e) => {
        const field = e.target.closest('[data-summary-field]');
        if (!field || !guzoState.pendingIntent) return;

        const key = field.dataset.summaryField;
        if (key === 'origin') {
            const next = resolveOriginInput(field.value, field);
            if (!next) return;
            applyTripSummaryIntent((intent) => {
                intent.origin = next;
            });
            field.value = formatOriginLabel(next);
        } else if (key === 'tier') {
            applyTripSummaryIntent((intent) => {
                intent.tier = field.value || 'classic';
            });
        }
    });

    container.addEventListener('click', (e) => {
        const addRoom = e.target.closest('[data-summary-add-room]');
        if (addRoom) {
            e.preventDefault();
            e.stopPropagation();
            if (!container._guzoRooms) container._guzoRooms = roomsFromIntent(guzoState.pendingIntent);
            container._guzoRooms.push({ id: Date.now(), adults: 1, children: [], infants: 0 });
            renderSummaryRooms(container);
            commitTravelersFromRooms(container);
            return;
        }

        const done = e.target.closest('[data-summary-done-travelers]');
        if (done) {
            e.preventDefault();
            e.stopPropagation();
            container.querySelector('[data-summary-traveler-popover]')?.classList.add('hidden');
            commitTravelersFromRooms(container);
            return;
        }

        const trigger = e.target.closest('[data-summary-traveler-trigger]');
        if (trigger) {
            e.preventDefault();
            e.stopPropagation();
            const pop = container.querySelector('[data-summary-traveler-popover]');
            if (!pop) return;
            const opening = pop.classList.contains('hidden');
            document.querySelectorAll('[data-summary-traveler-popover]').forEach((el) => {
                if (el !== pop) el.classList.add('hidden');
            });
            if (opening) {
                container._guzoRooms = roomsFromIntent(guzoState.pendingIntent);
                renderSummaryRooms(container);
                pop.classList.remove('hidden');
            } else {
                pop.classList.add('hidden');
            }
        }
    });

    document.addEventListener('click', (e) => {
        const pop = container.querySelector('[data-summary-traveler-popover]');
        if (!pop || pop.classList.contains('hidden')) return;
        if (container.contains(e.target)) return;
        pop.classList.add('hidden');
    });
}

function openPanel() {
    setPanelOpen(true);
    ensureGreeting();
    setTimeout(() => document.getElementById('guzo-panel-input')?.focus(), 350);
}

function closePanel() {
    setHistoryOpen(false);
    setPanelOpen(false);
}

function minimizePanel() {
    closePanel();
    setInputMode('guzo');
    expandSearchPanelIfSticky();
}

async function beginNewChat() {
    setHistoryOpen(false);
    startNewSession(guzoState.activeTab);
    ensureGreeting();
    setPanelOpen(true);
    setTimeout(() => document.getElementById('guzo-panel-input')?.focus(), 200);
}

async function resumeSession(sessionId) {
    if (!sessionId || sessionId === guzoState.sessionId) {
        setHistoryOpen(false);
        return;
    }

    setHistoryOpen(false);
    adoptSessionId(sessionId);

    try {
        const session = await fetchSession(sessionId);
        if (session && hydrateFromSession(session)) {
            setPanelOpen(true);
            return;
        }
    } catch (err) {
        console.warn('Could not resume session:', err);
    }

    // Fallback: open a fresh greeting if the server no longer has it.
    ensureGreeting();
    setPanelOpen(true);
}

function initFab() {
    document.getElementById('guzo-fab')?.addEventListener('click', openPanel);
}

function initPanelControls() {
    document.getElementById('guzo-panel-close')?.addEventListener('click', closePanel);
    document.getElementById('guzo-panel-minimize')?.addEventListener('click', minimizePanel);
    document.getElementById('guzo-panel-backdrop')?.addEventListener('click', closePanel);
    document.getElementById('guzo-inline-expand')?.addEventListener('click', openPanel);
    document.getElementById('guzo-panel-new')?.addEventListener('click', () => {
        beginNewChat();
    });
    document.getElementById('guzo-panel-history')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setHistoryOpen(!guzoState.historyOpen);
    });

    document.getElementById('guzo-history-menu')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-session-id]');
        if (!item) return;
        resumeSession(item.dataset.sessionId);
    });

    document.addEventListener('click', (e) => {
        if (!guzoState.historyOpen) return;
        const menu = document.getElementById('guzo-history-menu');
        const btn = document.getElementById('guzo-panel-history');
        if (menu?.contains(e.target) || btn?.contains(e.target)) return;
        setHistoryOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && guzoState.panelOpen) {
            if (guzoState.historyOpen) {
                setHistoryOpen(false);
                return;
            }
            closePanel();
        }
    });
}

function initSearchTabSync() {
    const tabsContainer = document.getElementById('search-tabs-container');
    if (!tabsContainer) return;

    tabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.search-tab');
        if (!tab?.dataset.target) return;
        setActiveTab(tab.dataset.target);
    });

    setActiveTab(getActiveSearchTab());
}

function initMaharajaLinks() {
    const signIn = document.getElementById('guzo-sheba-signin');
    if (signIn) signIn.href = GUZO_CONFIG.signInUrl;
}

function initGuzoModeSideEffects() {
    let prevMode = guzoState.inputMode;

    subscribe((state) => {
        if (state.inputMode === 'guzo' && prevMode !== 'guzo') {
            ensureGreeting();
        }
        prevMode = state.inputMode;
    });
}

async function init() {
    initModeToggle(setInputMode);
    initFab();
    initPanelControls();
    initSearchTabSync();
    initMaharajaLinks();
    initVoice();
    bindInput('guzo-inline-input', 'guzo-inline-send');
    bindInput('guzo-panel-input', 'guzo-panel-send');
    bindChips('guzo-inline-chips');
    bindChips('guzo-panel-chips');
    bindMessageActions('guzo-inline-messages');
    bindMessageActions('guzo-panel-messages');
    bindTripSummary('guzo-panel-trip-summary');
    bindTripSummary('guzo-inline-trip-summary');
    initGuzoModeSideEffects();

    subscribe(renderAll);

    renderAll(guzoState);
    if (guzoState.inputMode === 'guzo') ensureGreeting();

    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('guzoPrompt');
    const packageId = params.get('packageId');
    if (prompt) {
        let itinerary = null;
        try { itinerary = JSON.parse(sessionStorage.getItem('guzoItinerary') || 'null'); } catch { /* ignore */ }
        if (packageId) {
            setSelectedProductId(packageId);
            setPendingIntent({
                ...(guzoState.pendingIntent || {}),
                productTab: 'packages',
                packageId,
                itineraryId: params.get('itineraryId') || itinerary?.id || null,
                dates: itinerary?.dates || guzoState.pendingIntent?.dates || { start: null, end: null },
                travelers: itinerary?.travelers || guzoState.pendingIntent?.travelers,
                origin: itinerary?.origin || guzoState.pendingIntent?.origin,
                tier: itinerary?.tier || guzoState.pendingIntent?.tier,
                cabin: itinerary?.cabin || guzoState.pendingIntent?.cabin,
            });
        }
        setInputMode('guzo');
        openPanel();
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => sendMessage(prompt), 100);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

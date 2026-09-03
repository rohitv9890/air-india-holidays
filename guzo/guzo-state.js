import { hasItineraryCta, itineraryCtaMessage, toggleEnhancementId } from './guzo-enhancements.js';

const listeners = new Set();

const SESSION_KEY = 'guzoSessionId';
const INDEX_KEY = 'guzoSessionIndex';
const MAX_HISTORY = 20;

function storageSet(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        /* ignore unavailable storage */
    }
}

function createSessionId() {
    return 'guzo_' + Math.random().toString(36).slice(2, 11);
}

function readActiveSessionId() {
    try {
        // Remove the legacy persisted active chat. Previous chats remain in History.
        localStorage.removeItem(SESSION_KEY);
    } catch {
        /* ignore unavailable storage */
    }
    const id = createSessionId();
    storageSet(SESSION_KEY, id);
    return id;
}

export function listSessionHistory() {
    try {
        const raw = localStorage.getItem(INDEX_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function writeSessionHistory(list) {
    try {
        localStorage.setItem(INDEX_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
    } catch {
        /* ignore quota */
    }
}

/** Upsert the active session into the local history index. */
export function touchSessionHistory({ title, preview, tab } = {}) {
    const id = guzoState.sessionId;
    if (!id) return;

    const now = new Date().toISOString();
    const list = listSessionHistory().filter(item => item.sessionId !== id);
    const prior = listSessionHistory().find(item => item.sessionId === id);
    list.unshift({
        sessionId: id,
        title: (title || prior?.title || 'New chat').slice(0, 72),
        preview: (preview || prior?.preview || '').slice(0, 120),
        tab: tab || guzoState.activeTab || prior?.tab || 'packages',
        updatedAt: now,
        createdAt: prior?.createdAt || now,
    });
    writeSessionHistory(list);
}

export function removeSessionFromHistory(sessionId) {
    writeSessionHistory(listSessionHistory().filter(item => item.sessionId !== sessionId));
}

export const guzoState = {
    sessionId: readActiveSessionId(),
    inputMode: 'manual',
    panelOpen: false,
    historyOpen: false,
    activeTab: 'packages',
    messages: [],
    isTyping: false,
    maharajaClubPromptShown: false,
    pendingIntent: null,
    tripSummary: null,
    recommendations: [],
    itineraryId: null,
    selectedProductId: null,
    itineraryReady: false,
    enhancements: [],
    selectedEnhancementIds: [],
    compositeQuote: null,
    readyMadeOffered: false,
};

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function notify() {
    listeners.forEach(fn => fn(guzoState));
}

export function setInputMode(mode) {
    guzoState.inputMode = mode;
    notify();
}

export function setPanelOpen(open) {
    guzoState.panelOpen = open;
    if (!open) guzoState.historyOpen = false;
    notify();
}

export function setHistoryOpen(open) {
    guzoState.historyOpen = Boolean(open);
    notify();
}

export function setActiveTab(tab) {
    guzoState.activeTab = tab;
    notify();
}

export function addMessage(message) {
    guzoState.messages.push({
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        ...message,
    });
    notify();
}

/** Replace transient rich output so reruns cannot leave stale interactive cards. */
export function setSingletonMessage(type, message) {
    guzoState.messages = guzoState.messages.filter(m => m.type !== type);
    guzoState.messages.push({
        id: `msg_${type}_` + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        ...message,
        type,
    });
    notify();
}

export function updateMessageContent(msgId, content) {
    const msg = guzoState.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.content = content;
    notify();
}

export function setTyping(isTyping) {
    guzoState.isTyping = isTyping;
    notify();
}

export function markMaharajaClubPromptShown() {
    guzoState.maharajaClubPromptShown = true;
    notify();
}

export function setPendingIntent(intent) {
    guzoState.pendingIntent = intent;
    notify();
}

export function clearPendingIntent() {
    guzoState.pendingIntent = null;
    notify();
}

export function setTripSummary(summary) {
    guzoState.tripSummary = summary;
    notify();
}

export function setRecommendations(items) {
    guzoState.recommendations = Array.isArray(items) ? items : [];
    notify();
}

export function markReadyMadeOffered() {
    guzoState.readyMadeOffered = true;
    notify();
}

export function setItineraryId(id) {
    guzoState.itineraryId = id || null;
    notify();
}

export function setSelectedProductId(id) {
    const nextId = id || null;
    if (nextId !== guzoState.selectedProductId) {
        guzoState.enhancements = [];
        guzoState.selectedEnhancementIds = [];
        guzoState.compositeQuote = null;
        guzoState.messages = guzoState.messages.filter(message =>
            message.type !== 'enhancement_cards'
            && message.type !== 'quote_summary'
        );
    }
    guzoState.selectedProductId = nextId;
    notify();
}

export function setItineraryReady(ready) {
    guzoState.itineraryReady = Boolean(ready);
    notify();
}

export function ensureItineraryCta(id, itinerary = null) {
    const existing = guzoState.messages.find((message) => message.type === 'itinerary_cta');
    const next = itineraryCtaMessage(id, itinerary);
    if (
        existing
        && existing.itineraryId === next.itineraryId
        && existing.content === next.content
    ) {
        if (itinerary) {
            Object.assign(existing, next, { id: existing.id });
            notify();
        }
        return false;
    }

    guzoState.messages = guzoState.messages.filter((message) => message.type !== 'itinerary_cta');
    if (!itinerary && existing?.summary) next.summary = existing.summary;
    guzoState.messages.push({
        id: existing?.id || `msg_itinerary_${id || 'build'}`,
        ...next,
    });
    notify();
    return true;
}

export function setEnhancements(items) {
    guzoState.enhancements = Array.isArray(items) ? items.slice(0, 4) : [];
    notify();
}

export function toggleSelectedEnhancement(id) {
    guzoState.selectedEnhancementIds = toggleEnhancementId(guzoState.selectedEnhancementIds, id);
    notify();
    return guzoState.selectedEnhancementIds;
}

export function setCompositeQuote(quote) {
    guzoState.compositeQuote = quote || null;
    notify();
}

export function hasGreeting() {
    return guzoState.messages.some(m => m.role === 'assistant' && m.type === 'greeting');
}

function clearConversationFields() {
    guzoState.messages = [];
    guzoState.isTyping = false;
    guzoState.maharajaClubPromptShown = false;
    guzoState.pendingIntent = null;
    guzoState.tripSummary = null;
    guzoState.recommendations = [];
    guzoState.itineraryId = null;
    guzoState.selectedProductId = null;
    guzoState.itineraryReady = false;
    guzoState.enhancements = [];
    guzoState.selectedEnhancementIds = [];
    guzoState.compositeQuote = null;
    guzoState.readyMadeOffered = false;
    guzoState.historyOpen = false;
    try { sessionStorage.removeItem('guzoItinerary'); } catch { /* ignore */ }
}

/** Start a brand-new chat (keeps prior sessions in the history index). */
export function startNewSession(tab = guzoState.activeTab) {
    const id = createSessionId();
    storageSet(SESSION_KEY, id);
    guzoState.sessionId = id;
    guzoState.activeTab = tab || 'packages';
    clearConversationFields();
    notify();
    return id;
}

/** Switch to an existing session id and clear local transcript pending hydrate. */
export function adoptSessionId(sessionId, tab) {
    if (!sessionId) return;
    storageSet(SESSION_KEY, sessionId);
    guzoState.sessionId = sessionId;
    if (tab) guzoState.activeTab = tab;
    clearConversationFields();
    notify();
}

/** Hydrate UI state from a GET /guzo/session payload. */
export function hydrateFromSession(session) {
    if (!session?.sessionId) return false;

    storageSet(SESSION_KEY, session.sessionId);
    guzoState.sessionId = session.sessionId;
    if (session.tab) guzoState.activeTab = session.tab;

    clearConversationFields();

    const mapped = (session.messages || []).map((m, i) => ({
        id: `hydrated_${i}_${m.at || i}`,
        role: m.role === 'user' ? 'user' : 'assistant',
        type: m.role === 'user' ? 'text' : (i === 0 ? 'greeting' : 'text'),
        content: m.content || '',
    })).filter(m => m.content);

    guzoState.messages = mapped;
    guzoState.pendingIntent = session.intent || null;
    guzoState.selectedEnhancementIds = Array.isArray(session.intent?.selectedAddOnIds)
        ? [...session.intent.selectedAddOnIds]
        : [];
    guzoState.itineraryId = session.itinerary?.id || null;
    guzoState.itineraryReady = Boolean(session.itinerary?.id);
    if (session.itinerary) {
        try {
            sessionStorage.setItem('guzoItinerary', JSON.stringify(session.itinerary));
        } catch { /* ignore */ }
    }
    if (guzoState.itineraryId && !hasItineraryCta(guzoState.messages, guzoState.itineraryId)) {
        guzoState.messages.push({
            id: `hydrated_itinerary_${guzoState.itineraryId}`,
            ...itineraryCtaMessage(guzoState.itineraryId, session.itinerary),
        });
    }

    touchSessionHistory({
        title: session.title || mapped.find(m => m.role === 'user')?.content || 'Chat',
        preview: mapped.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '',
        tab: guzoState.activeTab,
    });

    notify();
    return mapped.length > 0;
}

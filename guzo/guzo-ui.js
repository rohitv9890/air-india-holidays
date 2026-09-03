import { GUZO_CONFIG } from './guzo-config.js';
import { guzoState, listSessionHistory } from './guzo-state.js';
import { isIntentComplete, getMissingFieldsForAction } from './guzo-intent.js';
import { getMaharajaClubContext, getMaharajaClubSubtitle } from './guzo-auth.js';
import { isItineraryActionChip, shouldShowItineraryActionChip } from './guzo-enhancements.js';
import { displayProductTitle } from './display-title.js';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function formatPrice(amount, currency = 'GBP') {
    if (amount == null || amount === '') return '';
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        return `${currency} ${Math.round(Number(amount) || 0)}`;
    }
}

/** Inline markdown after HTML-escaping: **bold**, *italic*, `code`. */
function formatInlineMarkdown(escaped) {
    return String(escaped || '')
        .replace(/`([^`]+)`/g, '<code class="guzo-md-code">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

/**
 * Lightweight markdown for assistant chat bubbles.
 * Escapes HTML first, then enables bold/italic, lists, and paragraphs.
 */
function formatAssistantMarkdown(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    const blocks = raw.split(/\n{2,}/);
    return blocks.map((block) => {
        const lines = block.split('\n');
        const listLines = lines.filter((line) => line.trim());
        const isList = listLines.length > 0
            && listLines.every((line) => /^[-*]\s+/.test(line.trim()));

        if (isList) {
            const items = listLines.map((line) => {
                const body = line.trim().replace(/^[-*]\s+/, '');
                return `<li>${formatInlineMarkdown(escapeHtml(body))}</li>`;
            }).join('');
            return `<ul class="guzo-md-list">${items}</ul>`;
        }

        const html = formatInlineMarkdown(escapeHtml(lines.join('\n'))).replace(/\n/g, '<br>');
        return `<p class="guzo-md-p">${html}</p>`;
    }).join('');
}

function formatMessageHtml(content, { markdown = false } = {}) {
    if (!markdown) return escapeHtml(content).replace(/\n/g, '<br>');
    return formatAssistantMarkdown(content);
}

function renderTextBubble(msg, isUser) {
    let content = msg.content || '';
    if (msg.type === 'maharaja' && !getMaharajaClubContext().authenticated) {
        content += `\n\nSign in to Maharaja Club to save your plan and see Maharaja Points you could earn.`;
    }

    return `
        <div class="guzo-msg ${isUser ? 'guzo-msg-user' : 'guzo-msg-assistant'}" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">${isUser ? 'You' : 'M'}</div>
            <div class="guzo-msg-bubble">${formatMessageHtml(content, { markdown: !isUser })}</div>
        </div>
    `;
}

function renderCard(item, selectedId) {
    const selected = selectedId && item.id === selectedId ? ' is-selected' : '';
    const price = item.priceFrom != null
        ? `From ${formatPrice(item.priceFrom, item.currency || 'GBP')}`
        : '';
    const img = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.imageAlt || item.title)}" loading="lazy">`
        : `<div class="guzo-card-img-fallback" aria-hidden="true"></div>`;

    return `
        <button type="button" class="guzo-reco-card${selected}" data-guzo-card="${escapeHtml(item.id)}"
            data-card-type="${escapeHtml(item.type || 'package')}">
            <div class="guzo-card-media">${img}</div>
            <div class="guzo-card-body">
                <h4 class="guzo-card-title">${escapeHtml(displayProductTitle(item.title))}</h4>
                ${item.meta ? `<p class="guzo-card-meta">${escapeHtml(item.meta)}</p>` : ''}
                ${price ? `<p class="guzo-card-price">${escapeHtml(price)}</p>` : ''}
            </div>
        </button>
    `;
}

function renderCardsMessage(msg) {
    const items = msg.items || [];
    const selectedId = guzoState.selectedProductId;
    const pathLabel = msg.pathLabel || '';
    const intro = msg.intro || '';
    const pathHead = pathLabel || intro
        ? `${pathLabel ? `<p class="guzo-choice-path-label">${escapeHtml(pathLabel)}</p>` : ''}
           ${intro ? `<p class="guzo-choice-path-copy">${escapeHtml(intro)}</p>` : ''}`
        : '';
    const rail = `
                <div class="guzo-card-rail" role="list">
                    ${items.map(item => renderCard(item, selectedId)).join('')}
                </div>`;

    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich">
                ${pathHead
                    ? `<div class="guzo-choice-path">${pathHead}${rail}</div>`
                    : rail}
            </div>
        </div>
    `;
}

function renderItineraryCta(msg) {
    const id = msg.itineraryId || guzoState.itineraryId || '';
    const summary = msg.summary || {};
    const price = summary.price?.amount != null
        ? formatPrice(summary.price.amount, summary.price.currency || 'GBP')
        : '';
    const pathLabel = msg.pathLabel || 'Tailor-made';
    const pathIntro = msg.pathIntro || '';
    const metaBits = [];
    if (summary.days) metaBits.push(`${summary.days} days`);
    if (price) {
        metaBits.push(summary.price?.basis === 'per-person'
            ? `from ${price} per person`
            : `${price} total`);
    }
    const meta = metaBits.length
        ? metaBits.join(' · ')
        : (id ? 'Ready to view' : '');

    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich">
                <div class="guzo-itinerary-cta">
                    <p class="guzo-choice-path-label">${escapeHtml(pathLabel)}</p>
                    ${pathIntro ? `<p class="guzo-choice-path-copy">${escapeHtml(pathIntro)}</p>` : ''}
                    ${summary.title ? `<p class="guzo-itinerary-cta-title">${escapeHtml(displayProductTitle(summary.title))}</p>` : ''}
                    ${meta ? `<p class="guzo-itinerary-cta-meta">${escapeHtml(meta)}</p>` : ''}
                    <button type="button" class="guzo-cta-btn" data-guzo-itinerary-cta
                        data-itinerary-id="${escapeHtml(id)}">
                        ${escapeHtml(msg.content || (id ? 'View itinerary' : 'Build my itinerary'))}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderActionsMessage(msg) {
    const actions = msg.actions || [];
    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich">
                <div class="guzo-actions-row">
                    ${actions.map(a => `
                        <button type="button" class="guzo-action-btn" data-guzo-action="${escapeHtml(a.id || a.label)}"
                            ${a.href ? `data-href="${escapeHtml(a.href)}"` : ''}>
                            ${escapeHtml(a.label || a.id)}
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderEnhancementsMessage(msg) {
    const selected = new Set(guzoState.selectedEnhancementIds || []);
    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich guzo-enhancements">
                <p class="guzo-enhancements-title">Optional ways to tailor this trip</p>
                ${(msg.items || []).slice(0, 4).map(item => {
                    const isSelected = selected.has(item.id);
                    const price = item.price?.amount != null
                        ? `From ${formatPrice(item.price.amount, item.price.currency)}`
                        : 'Price unavailable';
                    return `<button type="button" class="guzo-enhancement${isSelected ? ' is-selected' : ''}"
                        data-guzo-enhancement="${escapeHtml(item.id)}" aria-pressed="${isSelected}">
                        <span><strong>${escapeHtml(displayProductTitle(item.title))}</strong><small>${escapeHtml(item.reason || '')}</small></span>
                        <span class="guzo-enhancement-price">${escapeHtml(price)} · ${isSelected ? 'Remove' : 'Add'}</span>
                    </button>`;
                }).join('')}
            </div>
        </div>
    `;
}

function renderQuoteMessage(msg) {
    const quote = msg.quote || {};
    const lines = quote.lines || [];
    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich guzo-quote">
                <p class="guzo-quote-title">Trip price</p>
                ${lines.map(line => `<div class="guzo-quote-line">
                    <span>${escapeHtml(line.name)}</span>
                    <strong>${line.status === 'priced' && line.amount != null
                        ? escapeHtml(formatPrice(line.amount, line.currency || quote.currency))
                        : escapeHtml(line.status === 'included' ? 'Included' : 'Unavailable')}</strong>
                </div>`).join('')}
                <div class="guzo-quote-total"><span>Total</span><strong>${escapeHtml(formatPrice(quote.totalAmount, quote.currency))}</strong></div>
            </div>
        </div>
    `;
}

function renderTripSummaryInline(msg) {
    const s = msg.summary || {};
    return `
        <div class="guzo-msg guzo-msg-assistant guzo-msg-wide" data-msg-id="${escapeHtml(msg.id || '')}">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-rich">
                <div class="guzo-summary-chip-row">
                    ${s.origin ? `<span class="guzo-summary-pill">${escapeHtml(s.origin)}</span>` : ''}
                    ${s.dates ? `<span class="guzo-summary-pill">${escapeHtml(s.dates)}</span>` : ''}
                    ${s.travelers ? `<span class="guzo-summary-pill">${escapeHtml(s.travelers)}</span>` : ''}
                    ${s.tier ? `<span class="guzo-summary-pill">${escapeHtml(s.tier)}</span>` : ''}
                </div>
            </div>
        </div>
    `;
}

function renderMessage(msg) {
    const isUser = msg.role === 'user';
    const type = msg.type || 'text';

    if (!isUser) {
        if (type === 'product_cards' || type === 'destination_cards') return renderCardsMessage(msg);
        if (type === 'itinerary_cta') return renderItineraryCta(msg);
        if (type === 'actions') return renderActionsMessage(msg);
        if (type === 'enhancement_cards') return renderEnhancementsMessage(msg);
        if (type === 'quote_summary') return renderQuoteMessage(msg);
        if (type === 'trip_summary') return renderTripSummaryInline(msg);
    }

    return renderTextBubble(msg, isUser);
}

function renderTyping() {
    return `
        <div class="guzo-msg guzo-msg-assistant guzo-typing-msg" aria-label="Maharaja is typing">
            <div class="guzo-msg-avatar" aria-hidden="true">M</div>
            <div class="guzo-msg-bubble">
                <div class="guzo-typing"><span></span><span></span><span></span></div>
            </div>
        </div>
    `;
}

function hasTripSummaryData(intent) {
    if (!intent) return false;
    return Boolean(
        intent.origin?.name
        || intent.destination?.name
        || intent.dates?.start
        || (intent.travelers && intent.travelers.adults)
    );
}

export function formatOriginLabel(origin) {
    if (!origin) return '';
    if (origin.name && origin.code) return `${origin.name} (${origin.code})`;
    return origin.code || origin.name || '';
}

export function formatTravelersRoomsLabel(travelers) {
    const t = travelers || {};
    const rooms = t.rooms == null ? 1 : Math.max(1, Number(t.rooms) || 1);
    const adults = Number(t.adults);
    const guests = (Number.isFinite(adults) && adults > 0 ? adults : 0)
        + (Number(t.children) || 0)
        + (Number(t.infants) || 0);
    if (!guests) return `${rooms} room${rooms > 1 ? 's' : ''}`;
    return `${rooms} room${rooms > 1 ? 's' : ''}, ${guests} traveller${guests === 1 ? '' : 's'}`;
}

export function formatDatesRangeLabel(dates) {
    if (!dates?.start) return '';
    return dates.end ? `${dates.start} to ${dates.end}` : dates.start;
}

function isTripSummaryEditing(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active)) return false;
    return Boolean(active.closest('[data-summary-field], [data-summary-traveler-popover]'));
}

function isTravelerPopoverOpen(container) {
    const pop = container.querySelector('[data-summary-traveler-popover]');
    return Boolean(pop && !pop.classList.contains('hidden'));
}

function buildTripSummaryHtml(intent) {
    const tierLabel = intent.tier || 'classic';
    const originLabel = formatOriginLabel(intent.origin) || '';
    const datesLabel = formatDatesRangeLabel(intent.dates);
    const travelersLabel = formatTravelersRoomsLabel(intent.travelers);
    const originCode = intent.origin?.code || '';

    return `
        <div class="guzo-trip-summary-inner" role="group" aria-label="Trip summary">
            <div class="guzo-summary-field guzo-summary-field-origin" data-autocomplete-root>
                <span>From</span>
                <input type="text" class="auto-input" data-type="airport_code" data-summary-field="origin"
                    value="${escapeHtml(originLabel)}" data-code="${escapeHtml(originCode)}"
                    placeholder="City or Airport" aria-label="Origin" autocomplete="off">
            </div>
            <div class="guzo-summary-field guzo-summary-field-wide">
                <span>Dates</span>
                <input type="text" data-summary-field="dates" value="${escapeHtml(datesLabel)}"
                    placeholder="Departure - Return" aria-label="Dates" readonly>
            </div>
            <div class="guzo-summary-field guzo-summary-field-travelers">
                <span>Travellers</span>
                <div class="guzo-summary-traveler-trigger" data-summary-traveler-trigger>
                    <input type="text" data-summary-field="travelers" value="${escapeHtml(travelersLabel)}"
                        placeholder="1 room, 2 travellers" readonly class="cursor-pointer" aria-label="Travellers"
                        aria-haspopup="dialog">
                </div>
                <div class="guzo-summary-traveler-popover traveler-popover hidden" data-summary-traveler-popover>
                    <div data-summary-rooms-container class="guzo-summary-rooms max-h-[240px] overflow-y-auto mb-3"></div>
                    <button type="button" data-summary-add-room
                        class="guzo-summary-link-btn text-brand-primary font-semibold text-xs mb-3 hover:underline flex items-center gap-1">
                        + Add Room
                    </button>
                    <button type="button" data-summary-done-travelers
                        class="guzo-summary-done-btn w-full bg-brand-primary text-white py-2 rounded-lg font-semibold text-xs hover:bg-brand-secondary transition-colors">
                        Done
                    </button>
                </div>
            </div>
            <div class="guzo-summary-field">
                <span>Travel style</span>
                <select data-summary-field="tier" aria-label="Travel style">
                    ${['classic', 'comfort', 'signature'].map(tName =>
                        `<option value="${tName}" ${tName === tierLabel ? 'selected' : ''}>${tName}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
    `;
}

function syncTripSummaryDom(container, intent) {
    if (isTripSummaryEditing(container) || isTravelerPopoverOpen(container)) return;

    const originInput = container.querySelector('[data-summary-field="origin"]');
    const datesInput = container.querySelector('[data-summary-field="dates"]');
    const travelersInput = container.querySelector('[data-summary-field="travelers"]');
    const tierSelect = container.querySelector('[data-summary-field="tier"]');

    const originLabel = formatOriginLabel(intent.origin) || '';
    const datesLabel = formatDatesRangeLabel(intent.dates);
    const travelersLabel = formatTravelersRoomsLabel(intent.travelers);
    const tierLabel = intent.tier || 'classic';

    if (originInput && document.activeElement !== originInput) {
        originInput.value = originLabel;
        if (intent.origin?.code) originInput.dataset.code = intent.origin.code;
        else delete originInput.dataset.code;
    }

    if (datesInput && document.activeElement !== datesInput) {
        const fp = datesInput._flatpickr;
        if (fp && intent.dates?.start) {
            const next = intent.dates.end
                ? [intent.dates.start, intent.dates.end]
                : [intent.dates.start];
            const cur = (fp.selectedDates || []).map(d => fp.formatDate(d, 'Y-m-d')).join('|');
            const want = next.join('|');
            if (cur !== want) fp.setDate(next, false);
        } else {
            datesInput.value = datesLabel;
        }
    }

    if (travelersInput) travelersInput.value = travelersLabel;

    if (tierSelect && document.activeElement !== tierSelect) {
        tierSelect.value = tierLabel;
    }
}

export function teardownTripSummaryStrip(container) {
    if (!container) return;
    const datesInput = container.querySelector('[data-summary-field="dates"]');
    if (datesInput?._flatpickr) {
        datesInput._flatpickr.destroy();
    }
    delete container.dataset.guzoEnhanced;
    delete container._guzoRooms;
}

function renderChips(tab) {
    const prompts = [];
    const hasUserMessage = guzoState.messages?.some(m => m.role === 'user');

    const packagesReady = tab === 'packages'
        && !guzoState.itineraryId
        && (guzoState.recommendations?.length > 0
            || (guzoState.pendingIntent
                && getMissingFieldsForAction(guzoState.pendingIntent, { tab: 'packages', action: 'compose' }).length === 0));

    if (packagesReady && shouldShowItineraryActionChip(guzoState.messages)) {
        prompts.push('Build my itinerary');
    }

    if (guzoState.pendingIntent && isIntentComplete(guzoState.pendingIntent, tab)) {
        if (tab !== 'packages' || !guzoState.recommendations?.length) {
            prompts.push('Search now');
        }
    }

    // Starter prompts only before the user engages; hide after a chip/message.
    if (!hasUserMessage) {
        prompts.push(...(GUZO_CONFIG.tabPrompts[tab] || GUZO_CONFIG.tabPrompts.packages));
    }

    const visible = shouldShowItineraryActionChip(guzoState.messages)
        ? prompts
        : prompts.filter((text) => !isItineraryActionChip(text));

    return visible.map(text =>
        `<button type="button" class="guzo-chip${text === 'Build my itinerary' ? ' guzo-chip-primary' : ''}">${escapeHtml(text)}</button>`
    ).join('');
}

export function renderMessagesContainer(container, messages, isTyping) {
    if (!container) return;

    let html = messages.map(renderMessage).join('');
    if (isTyping) html += renderTyping();
    container.innerHTML = html;
    const thread = container.closest('.guzo-thread') || container;
    thread.scrollTop = thread.scrollHeight;
}

export function renderChipsContainer(container, tab) {
    if (!container) return;
    const html = renderChips(tab);
    container.innerHTML = html;
    container.classList.toggle('hidden', !html);
}

export function renderTripSummaryStrip(container, intent) {
    if (!container) return { mounted: false };

    if (!hasTripSummaryData(intent)) {
        teardownTripSummaryStrip(container);
        container.classList.add('hidden');
        container.innerHTML = '';
        return { mounted: false };
    }

    container.classList.remove('hidden');

    if (!container.querySelector('.guzo-trip-summary-inner')) {
        container.innerHTML = buildTripSummaryHtml(intent);
        delete container.dataset.guzoEnhanced;
        delete container._guzoRooms;
        return { mounted: true };
    }

    syncTripSummaryDom(container, intent);
    return { mounted: false };
}

export function updateSubtitles(state) {
    const ctx = getMaharajaClubContext();
    const subtitle = getMaharajaClubSubtitle();
    const tabLabel = GUZO_CONFIG.tabLabels[state.activeTab];

    ['guzo-inline-subtitle', 'guzo-panel-subtitle'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (ctx.authenticated) {
            el.textContent = subtitle;
        } else if (state.inputMode === 'guzo') {
            el.textContent = `Planning ${tabLabel.toLowerCase()}`;
        } else {
            el.textContent = 'Your Air India travel guide';
        }
    });
}

export function updateMaharajaBanner() {
    const banner = document.getElementById('guzo-sheba-banner');
    if (!banner) return;

    const ctx = getMaharajaClubContext();
    if (ctx.authenticated) {
        banner.classList.add('guzo-sheba-authed');
        banner.innerHTML = `
            <div class="flex items-center gap-2 min-w-0">
                <i data-lucide="award" class="w-4 h-4 text-brand-primary flex-shrink-0"></i>
                <p class="text-xs text-brand-muted leading-snug">
                    <span class="font-semibold text-brand-text">${escapeHtml(ctx.firstName)}</span>
                    · ${escapeHtml(ctx.tier)}${ctx.milesBalance != null ? ` · ${ctx.milesBalance.toLocaleString()} points` : ''}
                </p>
            </div>
        `;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function formatHistoryWhen(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

export function renderHistoryMenu(container, state) {
    if (!container) return;
    const items = listSessionHistory();
    if (!items.length) {
        container.innerHTML = '<p class="guzo-history-empty">No previous chats yet</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        const active = item.sessionId === state.sessionId ? ' is-active' : '';
        const title = item.title || 'Chat';
        const meta = [formatHistoryWhen(item.updatedAt), item.tab].filter(Boolean).join(' · ');
        return `
            <button type="button" class="guzo-history-item${active}" role="menuitem"
                data-session-id="${escapeHtml(item.sessionId)}">
                <span class="guzo-history-item-title">${escapeHtml(title)}</span>
                <span class="guzo-history-item-meta">${escapeHtml(meta)}</span>
            </button>
        `;
    }).join('');
}

export function syncPanelVisibility(state) {
    const panel = document.getElementById('guzo-panel');
    const fab = document.getElementById('guzo-fab');
    const searchPanel = document.getElementById('search-panel');
    const inline = document.getElementById('guzo-inline');
    const forms = document.getElementById('search-inputs-container');
    const historyMenu = document.getElementById('guzo-history-menu');
    const historyBtn = document.getElementById('guzo-panel-history');

    if (panel) {
        panel.classList.toggle('guzo-panel-open', state.panelOpen);
        panel.setAttribute('aria-hidden', state.panelOpen ? 'false' : 'true');
    }

    if (fab) {
        fab.classList.toggle('guzo-fab-hidden', state.panelOpen);
        fab.setAttribute('aria-expanded', state.panelOpen ? 'true' : 'false');
    }

    document.body.style.overflow = state.panelOpen ? 'hidden' : '';

    if (searchPanel) {
        searchPanel.classList.toggle('guzo-mode-active', state.inputMode === 'guzo');
    }

    if (inline && forms) {
        const guzoMode = state.inputMode === 'guzo';
        // Only one Guzo surface is interactive: panel when open, inline otherwise.
        const showInline = guzoMode && !state.panelOpen;
        inline.classList.toggle('hidden', !showInline);
        inline.toggleAttribute('inert', !showInline);
        inline.setAttribute('aria-hidden', showInline ? 'false' : 'true');
        forms.classList.toggle('hidden', guzoMode);
    }

    if (historyMenu) {
        const open = Boolean(state.panelOpen && state.historyOpen);
        historyMenu.classList.toggle('hidden', !open);
        if (open) renderHistoryMenu(historyMenu, state);
    }
    if (historyBtn) {
        historyBtn.setAttribute('aria-expanded', state.historyOpen ? 'true' : 'false');
    }

    document.querySelectorAll('.guzo-mode-btn').forEach(btn => {
        const isActive = btn.dataset.mode === state.inputMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

export function refreshIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

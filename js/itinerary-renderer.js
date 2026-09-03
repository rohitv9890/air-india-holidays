/**
 * Dynamic Guzo itinerary page renderer.
 * Load order: ?id= + sessionStorage guzoItinerary → API → Northern Historic demo fixture.
 */
import {
    buildDemoItinerary,
    fetchCatalog,
    productToCard,
} from '../guzo/guzo-catalog-client.js';
import { GUZO_CONFIG } from '../guzo/guzo-config.js';
import {
    fetchEnhancements,
    fetchItinerary as fetchItineraryApi,
    quoteCompositeTrip,
} from '../guzo/guzo-client.js';
import {
    catalogEnhancements,
    compactQuoteSummary,
    toggleEnhancementId,
} from '../guzo/guzo-enhancements.js';
import { enrichItineraryDayVariety, shouldPreserveDayContent } from '../guzo/day-content.js';
import { displayProductTitle } from '../guzo/display-title.js';
import { withInternationalFlightsIncluded } from '../guzo/itinerary-inclusions.js';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// Broken/legacy source-image URLs get swapped for a working replacement here.
// (Left empty after the Air India rebrand — the old Ethiopia-catalog entries no longer apply.)
const HERO_IMAGE_REPLACEMENTS = new Map([]);

function resolveMediaUrl(url) {
    if (!url) return '';
    return HERO_IMAGE_REPLACEMENTS.get(url) || url;
}

function formatPrice(amount, currency = 'USD') {
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

function queryId() {
    return new URLSearchParams(window.location.search).get('id');
}

function readSessionItinerary(id) {
    try {
        const raw = sessionStorage.getItem('guzoItinerary');
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (id && data.id && data.id !== id) return null;
        return data;
    } catch {
        return null;
    }
}

async function loadFromCatalog(id) {
    try {
        const catalog = await fetchCatalog();
        const products = catalog.products || [];
        const product = products.find(p => p.id === id)
            || products.find(p => p.id === 'pkg-golden-triangle-6d')
            || products.find(p => p.type === 'package');
        if (!product) return null;
        return await buildDemoItinerary(productToCard(product));
    } catch {
        return null;
    }
}

async function loadItinerary() {
    const id = queryId();

    const fromSession = readSessionItinerary(id);
    if (fromSession) return fromSession;

    if (id && !GUZO_CONFIG.mockMode && GUZO_CONFIG.apiUrl) {
        const fromApi = await fetchItineraryApi(id);
        if (fromApi) return fromApi;
    }

    if (id) {
        const fromCatalog = await loadFromCatalog(id);
        if (fromCatalog) return fromCatalog;
    }

    return await buildDemoItinerary();
}

const AIRPORT_LABELS = {
    FRA: 'Frankfurt',
    LHR: 'London',
    CDG: 'Paris',
    AMS: 'Amsterdam',
    FCO: 'Rome',
    MAD: 'Madrid',
    ZRH: 'Zurich',
    VIE: 'Vienna',
    BRU: 'Brussels',
    CPH: 'Copenhagen',
    ARN: 'Stockholm',
    OSL: 'Oslo',
    DUB: 'Dublin',
    DEL: 'Delhi',
    BOM: 'Mumbai',
    JAI: 'Jaipur',
    AGR: 'Agra',
    UDR: 'Udaipur',
    HYD: 'Hyderabad',
    COK: 'Kochi',
    GOI: 'Goa',
    MLE: 'Maldives',
    JNB: 'Johannesburg',
    CPT: 'Cape Town',
    DUR: 'Durban',
    PLZ: 'Gqeberha',
};

// International gateways across our two verticals: Delhi/Mumbai (Taj Holidays) and Johannesburg (Cricket World Cup 2027).
const GATEWAY_CODES = new Set(['DEL', 'BOM', 'JNB']);

function destinationLabel(value) {
    return String(value || '')
        .split('-')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function airportLabel(code) {
    const key = String(code || '').toUpperCase();
    return AIRPORT_LABELS[key] || key;
}

function flightType(flight) {
    if (flight?.type) return flight.type;
    if (flight?.direction === 'domestic') return 'domestic';
    if (flight?.direction === 'outbound' || flight?.direction === 'return') return 'international';
    return 'international';
}

function buildDestinationImageMap(catalog) {
    const map = new Map();
    for (const product of catalog?.products || []) {
        if (product.type !== 'destination') continue;
        const url = product.images?.[0]?.url || '';
        if (!url) continue;
        const ids = [
            product.id?.replace(/^dest-/, ''),
            ...(product.destinations || []),
        ].filter(Boolean);
        for (const id of ids) {
            if (!map.has(id)) {
                map.set(id, {
                    image: url,
                    imageAlt: product.images?.[0]?.alt || product.name || destinationLabel(id),
                });
            }
        }
    }
    return map;
}

function dayImage(day, destImages, heroImage) {
    // Day-specific art (experience / curated idea) wins over a single destination photo.
    if (day?.image) return resolveMediaUrl(day.image);
    const fromDest = destImages.get(day?.destinationId);
    return resolveMediaUrl(fromDest?.image || heroImage || '');
}

async function decorateApiItinerary(itinerary) {
    if (!itinerary) return itinerary;

    const diversified = await enrichItineraryDayVariety(itinerary);

    let product = null;
    let destImages = new Map();
    try {
        const catalog = await fetchCatalog();
        product = (catalog.products || []).find(item => item.id === diversified.packageId) || null;
        destImages = buildDestinationImageMap(catalog);
    } catch {
        // The API itinerary remains usable without catalog decoration.
    }

    // Client fixtures that already have duration + per-day images still benefit from
    // destination image overrides and flight label normalisation below.

    const dayCount = diversified.days?.length || product?.duration?.days || diversified.duration?.days || 1;
    const nightCount = diversified.duration?.nights
        ?? product?.duration?.nights
        ?? Math.max(dayCount - 1, 0);
    const heroImage = resolveMediaUrl(diversified.heroImage || product?.images?.[0]?.url || '');
    const destinations = product?.route?.map(stop => stop.destinationId)
        || diversified.destinations
        || diversified.route
        || [];
    const quoteAmount = diversified.quote?.totalAmount
        ?? diversified.quote?.gbp
        ?? diversified.price?.amount
        ?? product?.basePrice?.amount
        ?? 0;

    return {
        ...diversified,
        subtitle: diversified.subtitle || diversified.summary || product?.summary || '',
        heroImage,
        duration: { days: dayCount, nights: nightCount },
        route: (Array.isArray(destinations) ? destinations : []).map(destinationLabel),
        price: diversified.price || {
            amount: quoteAmount,
            currency: diversified.quote?.currency || diversified.quote?.displayCurrency || 'USD',
            basis: 'total-party',
        },
        // `maharajaPointsEstimate` is the mock-mode field (guzo-catalog-client.js); the
        // `milesEstimate.*` fallbacks below match the (unmodified) backend API's payload shape.
        maharajaPointsEstimate: diversified.maharajaPointsEstimate
            ?? diversified.milesEstimate?.shebaMiles
            ?? diversified.milesEstimate?.miles
            ?? 0,
        placeId: diversified.placeId || diversified.easygds?.placeId || null,
        days: (diversified.days || []).map(day => {
            const media = destImages.get(day.destinationId);
            const label = day.destinationId ? destinationLabel(day.destinationId) : '';
            if (shouldPreserveDayContent(day)) {
                return {
                    ...day,
                    location: day.location || label,
                    description: day.description || day.summary || '',
                    image: day.image || dayImage(day, destImages, heroImage),
                    imageAlt: day.imageAlt || media?.imageAlt || day.title,
                    highlights: day.highlights || [],
                };
            }
            const lower = String(day.title || '').toLowerCase();
            const genericTitle = !day.title
                || lower === label.toLowerCase()
                || lower === String(day.destinationId || '').replace(/-/g, ' ')
                || lower.startsWith('continue ')
                || /^day \d+$/i.test(day.title);
            const title = genericTitle && day.destinationId
                ? `${lower.startsWith('arrive') ? 'Arrive ' : ''}${label}`
                : (lower.startsWith('arrive') && label && !lower.includes(label.toLowerCase())
                    ? `Arrive ${label}`
                    : day.title);
            return {
                ...day,
                title,
                location: day.location || label,
                description: day.description || day.summary || '',
                image: dayImage(day, destImages, heroImage),
                imageAlt: day.imageAlt || media?.imageAlt || title,
                highlights: day.highlights || [],
            };
        }),
        flights: (diversified.flights || []).map(flight => {
            const type = flightType(flight);
            const from = flight.from || flight.origin || '';
            const to = flight.to || flight.destination || '';
            const label = flight.label
                || `${airportLabel(from)} → ${airportLabel(to)}`;
            return {
                ...flight,
                from,
                to,
                type,
                airline: flight.airline || (flight.carrier === 'AI' ? 'Air India' : flight.carrier),
                label,
            };
        }),
        hotels: diversified.hotels || (diversified.stays || []).map(stay => ({
            name: stay.name,
            location: destinationLabel(stay.destinationId),
            nights: stay.nights,
            tier: stay.tier,
        })),
        ...withInternationalFlightsIncluded(
            diversified.inclusions || product?.inclusions || [],
            diversified.exclusions || product?.exclusions || [],
        ),
    };
}

function renderHero(itinerary) {
    const hero = document.getElementById('itinerary-hero');
    if (!hero) return;

    const img = hero.querySelector('[data-hero-img]');
    const title = hero.querySelector('[data-hero-title]');
    const subtitle = hero.querySelector('[data-hero-subtitle]');
    const route = hero.querySelector('[data-hero-route]');
    const duration = hero.querySelector('[data-hero-duration]');

    if (img && itinerary.heroImage) {
        img.src = resolveMediaUrl(itinerary.heroImage);
        img.alt = displayProductTitle(itinerary.title) || 'India itinerary';
    }
    if (title) title.innerHTML = escapeHtml(displayProductTitle(itinerary.title) || 'Your India itinerary');
    if (subtitle) subtitle.textContent = itinerary.subtitle || '';
    if (route) route.textContent = (itinerary.route || []).slice(0, 4).join(' → ');
    if (duration) {
        const d = itinerary.duration || {};
        duration.textContent = `${d.days || 6} days · ${d.nights || 5} nights`;
    }
}

function renderOverview(itinerary) {
    const el = document.getElementById('itinerary-overview-stats');
    if (!el) return;
    const places = (itinerary.route || []).length;
    const flights = itinerary.flights || [];
    const outbound = flights.find(f => f.direction === 'outbound' || (flightType(f) === 'international' && GATEWAY_CODES.has(f.to)))
        || flights.find(f => flightType(f) === 'international');
    const domesticCount = flights.filter(f => flightType(f) === 'domestic').length;
    const originCode = outbound?.from
        || itinerary.originIata
        || itinerary.origin?.code
        || itinerary.origin
        || '';
    const flightHeadline = outbound
        ? `${airportLabel(outbound.from)} → ${airportLabel(outbound.to)}`
        : originCode
            ? `${airportLabel(originCode)} → Delhi`
            : 'International';
    const flightSub = domesticCount > 0
        ? `+ ${domesticCount} more flight${domesticCount === 1 ? '' : 's'}`
        : 'Return included';

    el.innerHTML = `
        <div class="px-3 py-5 text-center border-r border-brand-line">
            <i data-lucide="calendar-days" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5">${escapeHtml(itinerary.duration?.days || 6)} Days</div>
            <div class="text-[11px] text-brand-muted">${escapeHtml(itinerary.duration?.nights || 5)} nights</div>
        </div>
        <div class="px-3 py-5 text-center border-r border-brand-line">
            <i data-lucide="map-pin" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5">${places} places</div>
            <div class="text-[11px] text-brand-muted">Multi-city route</div>
        </div>
        <div class="px-3 py-5 text-center border-r border-brand-line">
            <i data-lucide="users" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5">${escapeHtml(itinerary.travelers?.adults || 2)} adults</div>
            <div class="text-[11px] text-brand-muted">${itinerary.travelers?.children ? `${escapeHtml(itinerary.travelers.children)} children` : 'Travelling together'}</div>
        </div>
        <div class="px-3 py-5 text-center border-r border-brand-line border-t lg:border-t-0">
            <i data-lucide="sparkles" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5 capitalize">${escapeHtml(itinerary.tier || 'classic')}</div>
                <div class="text-[11px] text-brand-muted">Travel style</div>
        </div>
        <div class="px-3 py-5 text-center border-r border-brand-line border-t lg:border-t-0">
            <i data-lucide="plane" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5">${escapeHtml(flightHeadline)}</div>
            <div class="text-[11px] text-brand-muted">${escapeHtml(flightSub)}</div>
        </div>
        <div class="px-3 py-5 text-center border-t lg:border-t-0">
            <i data-lucide="award" class="w-5 h-5 text-brand-primary mx-auto"></i>
            <div class="font-bold text-[13px] mt-1.5">${itinerary.maharajaPointsEstimate != null ? escapeHtml(itinerary.maharajaPointsEstimate.toLocaleString()) : 'Unavailable'}</div>
                <div class="text-[11px] text-brand-muted">Maharaja Points you could earn</div>
        </div>
    `;
}

function renderDays(itinerary) {
    const section = document.getElementById('itinerary-days');
    if (!section) return;

    const days = itinerary.days || [];
    section.innerHTML = days.map((day, i) => {
        const flip = i % 2 === 1 ? ' is-flip' : '';
        const num = String(day.day).padStart(2, '0');
        const chips = (day.highlights || []).map(h =>
            `<span class="text-xs font-semibold text-brand-secondary bg-brand-surface border border-brand-line px-2.5 py-1 rounded-full">${escapeHtml(h)}</span>`
        ).join('');

        return `
            <article class="day-card${flip}">
                <div class="day-card-media">
                    <img src="${escapeHtml(day.image || itinerary.heroImage || '')}"
                        alt="${escapeHtml(day.imageAlt || day.title)}" loading="lazy">
                </div>
                <div class="day-card-body p-7 lg:p-8">
                    <div class="flex items-center gap-3 mb-3">
                        <span class="text-4xl lg:text-[44px] font-extrabold leading-none text-brand-primary/30">${num}</span>
                        <span class="text-[11px] font-bold tracking-[0.14em] uppercase text-brand-primary bg-brand-primary/10 px-3 py-1.5 rounded-full">Day ${escapeHtml(day.day)} · ${escapeHtml(day.location || '')}</span>
                    </div>
                    <h3 class="text-2xl font-extrabold tracking-tight mb-2.5">${escapeHtml(day.title)}</h3>
                    <p class="text-brand-muted leading-relaxed text-[15px] mb-4">${escapeHtml(day.description || '')}</p>
                    <div class="flex flex-wrap gap-2">${chips}</div>
                </div>
            </article>
        `;
    }).join('');
}

function renderFlights(itinerary) {
    const el = document.getElementById('itinerary-flights');
    if (!el) return;
    const flights = itinerary.flights || [];
    el.innerHTML = flights.map(f => `
        <div class="flex items-start gap-3 py-3 border-b border-brand-line last:border-0">
            <div class="w-9 h-9 rounded-full bg-brand-primary/10 text-brand-primary grid place-items-center shrink-0">
                <i data-lucide="plane" class="w-4 h-4"></i>
            </div>
            <div>
                <div class="font-bold text-sm">${escapeHtml(f.label || `${f.from} → ${f.to}`)}</div>
                <div class="text-xs text-brand-muted mt-0.5">${escapeHtml(f.airline || 'Air India')} · ${escapeHtml(f.type || 'flight')}</div>
            </div>
        </div>
    `).join('');
}

function renderHotels(itinerary) {
    const el = document.getElementById('itinerary-hotels');
    if (!el) return;
    const hotels = itinerary.hotels || [];
    el.innerHTML = hotels.map(h => `
        <div class="flex items-start gap-3 py-3 border-b border-brand-line last:border-0">
            <div class="w-9 h-9 rounded-full bg-[rgba(176,124,28,0.12)] text-brand-gold grid place-items-center shrink-0">
                <i data-lucide="bed-double" class="w-4 h-4"></i>
            </div>
            <div>
                <div class="font-bold text-sm">${escapeHtml(h.name)}</div>
                <div class="text-xs text-brand-muted mt-0.5">${escapeHtml(h.location)} · ${escapeHtml(h.nights)} night${h.nights === 1 ? '' : 's'} · ${escapeHtml(h.tier || itinerary.tier || 'classic')}</div>
            </div>
        </div>
    `).join('');
}

function renderInclusions(itinerary) {
    const inc = document.getElementById('itinerary-inclusions');
    const exc = document.getElementById('itinerary-exclusions');
    if (inc) {
        inc.innerHTML = (itinerary.inclusions || []).map(item =>
            `<li class="flex gap-2"><i data-lucide="check" class="w-4 h-4 text-brand-primary shrink-0 mt-0.5"></i>${escapeHtml(item)}</li>`
        ).join('');
    }
    if (exc) {
        exc.innerHTML = (itinerary.exclusions || []).map(item =>
            `<li class="flex gap-2"><i data-lucide="x" class="w-4 h-4 text-brand-red shrink-0 mt-0.5"></i>${escapeHtml(item)}</li>`
        ).join('');
    }
}

function renderPriceBar(itinerary) {
    const amount = itinerary.price?.amount;
    const currency = itinerary.price?.currency || 'USD';
    const priceText = amount == null ? 'Price unavailable' : formatPrice(amount, currency);

    document.querySelectorAll('[data-book-price]').forEach(el => {
        el.textContent = amount == null ? priceText : priceText.replace(/^[A-Z]{3}\s?/, '');
    });
    document.querySelectorAll('[data-book-currency]').forEach(el => {
        el.textContent = currency;
    });
    document.querySelectorAll('[data-book-name]').forEach(el => {
        el.textContent = itinerary.tier || 'classic';
    });
    document.querySelectorAll('[data-miles-estimate]').forEach(el => {
        el.textContent = itinerary.maharajaPointsEstimate != null
            ? itinerary.maharajaPointsEstimate.toLocaleString()
            : 'Unavailable';
    });
}

function canonicalPackageId(itinerary) {
    return itinerary.catalogProductId || itinerary.sourcePackageId || itinerary.packageId || '';
}

async function renderEnhancements(itinerary) {
    const container = document.getElementById('itinerary-enhancements');
    const quoteEl = document.getElementById('itinerary-enhancement-quote');
    const tailorLink = document.getElementById('tailor-with-guzo');
    if (!container) return;
    const packageId = canonicalPackageId(itinerary);
    if (tailorLink) {
        const url = new URL('index.html', window.location.href);
        url.searchParams.set('guzoPrompt', 'Show me relevant ways to tailor this trip');
        if (packageId) url.searchParams.set('packageId', packageId);
        if (itinerary.id) url.searchParams.set('itineraryId', itinerary.id);
        tailorLink.href = url.toString();
    }
    if (!packageId) {
        container.innerHTML = '<p class="text-sm text-brand-muted">No catalogued additions are available for this itinerary.</p>';
        return;
    }

    let items = [];
    try {
        if (!GUZO_CONFIG.mockMode && GUZO_CONFIG.apiUrl) {
            items = (await fetchEnhancements(packageId, itinerary.destinations || [])).items || [];
        } else {
            items = catalogEnhancements(await fetchCatalog(), packageId, {
                destinations: itinerary.destinations || [],
            });
        }
    } catch {
        items = [];
    }
    if (!items.length) {
        container.innerHTML = '<p class="text-sm text-brand-muted">No priced additions are available for this trip right now.</p>';
        return;
    }

    const storageKey = `guzoEnhancements:${packageId}`;
    let selected = [];
    try { selected = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); } catch { selected = []; }

    const draw = () => {
        container.innerHTML = items.slice(0, 4).map((item) => {
            const chosen = selected.includes(item.id);
            const price = item.price?.amount != null
                ? `From ${formatPrice(item.price.amount, item.price.currency)}`
                : 'Price unavailable';
            return `<button type="button" data-enhancement-id="${escapeHtml(item.id)}"
                aria-pressed="${chosen}" class="text-left bg-white border ${chosen ? 'border-brand-primary ring-1 ring-brand-primary' : 'border-brand-line'} rounded-xl p-5 transition-colors">
                <span class="block font-extrabold text-sm">${escapeHtml(item.title)}</span>
                <span class="block text-xs text-brand-muted leading-relaxed mt-1">${escapeHtml(item.reason)}</span>
                <span class="block text-xs font-bold text-brand-primary mt-3">${escapeHtml(price)} · ${chosen ? 'Remove' : 'Add'}</span>
            </button>`;
        }).join('');
    };

    const showQuote = (quote) => {
        const summary = compactQuoteSummary(quote);
        if (!summary || !quoteEl) return;
        quoteEl.classList.remove('hidden');
        quoteEl.innerHTML = `
            <div class="text-[11px] font-bold tracking-[0.12em] uppercase text-brand-primary mb-2">Updated trip price</div>
            ${summary.lines.map((line) => `<div class="flex justify-between gap-4 text-sm py-1.5">
                <span>${escapeHtml(line.name)}</span>
                <strong>${line.status === 'priced' && line.amount != null ? escapeHtml(formatPrice(line.amount, line.currency)) : escapeHtml(line.status === 'included' ? 'Included' : 'Unavailable')}</strong>
            </div>`).join('')}
            <div class="flex justify-between gap-4 text-base border-t border-brand-line mt-2 pt-3">
                <strong>Total</strong><strong class="text-brand-primary">${escapeHtml(formatPrice(summary.totalAmount, summary.currency))}</strong>
            </div>`;
    };

    draw();
    container.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-enhancement-id]');
        if (!button) return;
        selected = toggleEnhancementId(selected, button.dataset.enhancementId);
        try { sessionStorage.setItem(storageKey, JSON.stringify(selected)); } catch { /* ignore */ }
        draw();
        if (!GUZO_CONFIG.mockMode && GUZO_CONFIG.apiUrl && itinerary.dates?.start) {
            try {
                const result = await quoteCompositeTrip({
                    packageId,
                    addOnProductIds: selected,
                    startDate: itinerary.dates.start,
                    adults: itinerary.travelers?.adults || 2,
                    children: itinerary.travelers?.children || 0,
                    cabin: itinerary.cabin || 'Economy',
                    tier: itinerary.tier || 'classic',
                    currency: itinerary.price?.currency,
                    originIata: itinerary.originIata || itinerary.origin?.code,
                });
                showQuote(result.quote);
            } catch (err) {
                quoteEl.classList.remove('hidden');
                quoteEl.textContent = `This combination could not be priced: ${err.message}`;
            }
        } else if (quoteEl) {
            quoteEl.classList.remove('hidden');
            quoteEl.textContent = selected.length
                ? 'Selection saved. A combined price is available when live pricing is connected.'
                : 'No optional additions selected.';
        }
    });
}

function bindBookButton(itinerary) {
    const btn = document.getElementById('book-itinerary-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (!window.EHSearch?.bookTour) {
            console.warn('EHSearch.bookTour not available');
            return;
        }
        window.EHSearch.bookTour({
            placeId: itinerary.placeId || '244102',
            packageId: itinerary.packageId || 'ddd85aba-76ad-47f0-abd4-a36d7767b624',
            startDate: itinerary.dates?.start,
            endDate: itinerary.dates?.end,
            travelers: itinerary.travelers,
            currency: itinerary.price?.currency || 'USD',
        });
    });
}

function bindChrome() {
    if (window.lucide) lucide.createIcons();

    const backBtn = document.getElementById('itinerary-back');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            // Prefer returning to Guzo chat when the user navigated here from the site.
            if (window.history.length > 1 && document.referrer) {
                try {
                    const ref = new URL(document.referrer);
                    if (ref.origin === window.location.origin) {
                        e.preventDefault();
                        window.history.back();
                    }
                } catch {
                    // fall through to href
                }
            }
        });
    }

    const header = document.getElementById('main-header');
    const hero = document.getElementById('itinerary-hero');
    const parallax = document.querySelector('[data-parallax]');

    const onScroll = () => {
        const y = window.scrollY;
        if (header && hero) {
            const scrolled = y > hero.offsetHeight - 80;
            header.classList.toggle('is-scrolled', scrolled);
            document.body.classList.toggle('has-fixed-header', scrolled);
        }
        if (parallax) parallax.style.transform = `translateY(${y * 0.35}px)`;

        const links = [...document.querySelectorAll('[data-link]')];
        let active = links[0]?.dataset.link;
        links.forEach(l => {
            const sec = document.querySelector(`[data-sec="${l.dataset.link}"]`);
            if (sec && sec.offsetTop - 120 <= y) active = l.dataset.link;
        });
        links.forEach(l => l.classList.toggle('is-active', l.dataset.link === active));
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    document.querySelectorAll('[data-link]').forEach(l => {
        l.addEventListener('click', (e) => {
            e.preventDefault();
            const sec = document.querySelector(`[data-sec="${l.dataset.link}"]`);
            if (sec) {
                const top = sec.getBoundingClientRect().top + window.scrollY - 70;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });
}

async function init() {
    const root = document.getElementById('itinerary-root');
    if (root) root.setAttribute('aria-busy', 'true');

    const itinerary = await decorateApiItinerary(await loadItinerary());

    document.title = `${displayProductTitle(itinerary.title) || 'Itinerary'} | Air India Holidays`;
    renderHero(itinerary);
    renderOverview(itinerary);
    renderDays(itinerary);
    renderFlights(itinerary);
    renderHotels(itinerary);
    renderInclusions(itinerary);
    renderPriceBar(itinerary);
    await renderEnhancements(itinerary);
    bindBookButton(itinerary);
    bindChrome();

    if (root) root.setAttribute('aria-busy', 'false');
    if (window.lucide) lucide.createIcons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

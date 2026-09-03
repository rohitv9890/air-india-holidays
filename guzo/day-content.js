/**
 * Curated multi-day narratives per destination.
 * Source of truth: /data/catalog/v1/day-ideas.json (synced to Lambda).
 * Keep the lookup contract in lockstep with infrastructure/lambda/guzo-chat-handler/lib/day-content.js.
 */

let cachedIdeas = null;

async function loadDayIdeas() {
    if (cachedIdeas) return cachedIdeas;
    try {
        const url = new URL('data/catalog/v1/day-ideas.json', window.location.href);
        url.searchParams.set('v', '5');
        const res = await fetch(url.href, { cache: 'no-store' });
        if (res.ok) {
            cachedIdeas = await res.json();
            return cachedIdeas;
        }
    } catch {
        /* fall through */
    }
    cachedIdeas = {};
    return cachedIdeas;
}

function titleCaseDest(id) {
    return String(id || '')
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function fallbackIdea(destinationId, stayIndex) {
    const label = titleCaseDest(destinationId);
    const variants = [
        {
            title: `Explore ${label}`,
            summary: `A full day discovering ${label} with your guide — landmarks, local flavours, and time to settle in.`,
            highlights: [label, 'Guided touring', 'Local flavours'],
        },
        {
            title: `Deeper into ${label}`,
            summary: `A second day in ${label} for quieter corners, a market stroll, and the experiences you skipped yesterday.`,
            highlights: ['Market stroll', 'Quiet corners', 'Flexible pacing'],
        },
        {
            title: `${label} at your pace`,
            summary: `Optional excursions, craft shopping, or simply lingering over coffee — a freer day in ${label}.`,
            highlights: ['Optional excursion', 'Craft shopping', 'At leisure'],
        },
        {
            title: `${label} morning & afternoon split`,
            summary: `A guided morning around ${label}, then free time for photos, rest, or an optional local workshop.`,
            highlights: ['Guided morning', 'Free afternoon', 'Optional workshop'],
        },
        {
            title: `Scenic ${label} circuit`,
            summary: `A scenic circuit around ${label} with viewpoint stops, a picnic lunch, and golden-hour light for photography.`,
            highlights: ['Scenic circuit', 'Picnic lunch', 'Photography'],
        },
    ];
    return variants[stayIndex % variants.length];
}

function leisureIdea(destinationId) {
    const label = titleCaseDest(destinationId);
    return {
        title: `${label} at leisure`,
        summary: `A free day in ${label} after the authored programme — rest, optional wandering, or time by the hotel.`,
        highlights: ['At leisure', 'Optional wandering', label],
        experienceIds: [],
        moduleId: `${destinationId}-leisure`,
        leisure: true,
    };
}

function transferIdea(destinationId) {
    const label = titleCaseDest(destinationId);
    return {
        title: `Travel to ${label}`,
        summary: `Today is a transfer day into ${label}, with time to settle in rather than a full touring programme.`,
        highlights: ['Transfer day', 'Settle in', label],
        experienceIds: [],
        moduleId: `${destinationId}-transfer`,
    };
}

function destinationEntry(ideas, destinationId) {
    if (!ideas || !destinationId) return null;
    if (ideas[destinationId] != null) return ideas[destinationId];
    return ideas.destinations?.[destinationId] ?? null;
}

function asModuleList(entry) {
    const mods = entry?.modules;
    if (!mods) return [];
    if (Array.isArray(mods)) return mods.filter((m) => m && m.id);
    return Object.values(mods).filter((m) => m && m.id);
}

function getModule(entry, moduleId) {
    if (!entry || !moduleId) return null;
    const mods = entry.modules;
    if (!mods) return null;
    if (Array.isArray(mods)) return mods.find((m) => m.id === moduleId) || null;
    return mods[moduleId] || null;
}

function planIds(entry, stayLength) {
    const plans = entry?.plans;
    if (!plans || typeof plans !== 'object') return null;
    const key = String(stayLength);
    const ids = plans[key] || plans[stayLength];
    return Array.isArray(ids) ? ids : null;
}

function normalizeIdea(raw, destinationId, extra = {}) {
    if (!raw) return null;
    const experienceIds = Array.isArray(raw.experienceIds)
        ? raw.experienceIds.filter(Boolean)
        : [];
    return {
        title: raw.title || `Explore ${titleCaseDest(destinationId)}`,
        summary: raw.summary || '',
        highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
        image: raw.image || '',
        imageAlt: raw.imageAlt || raw.title || '',
        experienceIds,
        moduleId: raw.id || raw.moduleId || extra.moduleId || null,
        intensity: raw.intensity || null,
        activityHours: raw.activityHours ?? raw.expectedActivityHours ?? null,
        leisure: Boolean(raw.leisure || extra.leisure),
    };
}

function normalizeJourneyLoad(value) {
    const raw = String(value || '').toLowerCase().replace(/_/g, '-');
    if (raw === 'full-day' || raw === 'fullday' || raw === 'full') return 'full-day';
    if (raw === 'half-day' || raw === 'halfday' || raw === 'half') return 'half-day';
    if (raw === 'short' || raw === 'light') return 'short';
    return null;
}

function applyArrivalLoad(idea, entry, destinationId, stayIndex, journeyLoad) {
    if (stayIndex !== 0) return idea;
    const load = normalizeJourneyLoad(journeyLoad);
    if (!load || load === 'short') return idea;
    const arrival = normalizeIdea(getModule(entry, entry?.arrivalModuleId), destinationId);
    if (load === 'full-day') {
        const base = arrival || transferIdea(destinationId);
        return { ...base, experienceIds: [] };
    }
    return arrival || idea;
}

function moduleSequence(entry, destinationId, stayLength) {
    const modules = asModuleList(entry);
    const byId = new Map(modules.map((m) => [m.id, m]));
    const capped = Math.min(Math.max(stayLength, 1), 5);
    const authored = planIds(entry, capped) || [];
    const sequence = authored
        .map((id) => byId.get(id) || getModule(entry, id))
        .filter(Boolean);

    if (stayLength <= 5) return sequence;

    const used = new Set(authored);
    const unused = modules.filter((m) => !used.has(m.id));
    const overflow = [...unused];
    const extra = stayLength - 5;
    const extras = [];
    for (let i = 0; i < extra; i += 1) {
        extras.push(overflow[i] || leisureIdea(destinationId));
    }
    return [...sequence, ...extras];
}

/**
 * Pure lookup against a loaded day-ideas document (legacy array or modules/plans).
 * Keep in lockstep with the Lambda day-content reader.
 */
export function selectDayIdea(
    ideas,
    destinationId,
    stayIndex = 0,
    stayLength = null,
    journeyLoad = null,
    options = {},
) {
    const index = Math.max(Number(stayIndex) || 0, 0);
    const entry = destinationEntry(ideas, destinationId);
    const requestedModule = options.moduleId
        ? normalizeIdea(getModule(entry, options.moduleId), destinationId)
        : null;
    if (requestedModule) {
        return applyArrivalLoad(requestedModule, entry, destinationId, index, journeyLoad);
    }

    if (Array.isArray(entry)) {
        if (index < entry.length) {
            return applyArrivalLoad(
                normalizeIdea(entry[index], destinationId),
                entry,
                destinationId,
                index,
                journeyLoad,
            );
        }
        return fallbackIdea(destinationId, index);
    }

    if (entry && entry.modules && entry.plans) {
        const length = Number.isFinite(Number(stayLength)) && Number(stayLength) > 0
            ? Math.floor(Number(stayLength))
            : (planIds(entry, 5)?.length || 5);
        const sequence = moduleSequence(entry, destinationId, length);
        const picked = sequence[index]
            ? normalizeIdea(sequence[index], destinationId)
            : leisureIdea(destinationId);
        return applyArrivalLoad(picked, entry, destinationId, index, journeyLoad);
    }

    return fallbackIdea(destinationId, index);
}

export async function ideaForStayDay(
    destinationId,
    stayIndex = 0,
    stayLength = null,
    journeyLoad = null,
    options = {},
) {
    const ideas = await loadDayIdeas();
    return selectDayIdea(ideas, destinationId, stayIndex, stayLength, journeyLoad, options);
}

/** True when the day already has module-resolved (or equivalently authored) content. */
export function shouldPreserveDayContent(day) {
    if (!day) return false;
    if (day.moduleId) return true;
    const title = String(day.title || '').trim();
    const summary = String(day.summary || day.description || '').trim();
    if (!title || !summary) return false;
    if (/^day\s+\d+/i.test(title)) return false;
    if (/\bday\s+\d+\s+in\b/i.test(summary)) return false;
    const destLabel = String(day.destinationId || '').replace(/-/g, ' ');
    const location = String(day.location || '');
    const genericTitle = title.toLowerCase() === destLabel.toLowerCase()
        || (location && title.toLowerCase() === location.toLowerCase());
    if (genericTitle) return false;
    return Boolean(day.image || (Array.isArray(day.highlights) && day.highlights.length));
}

/**
 * Diversify repeated destination days on already-built itineraries (e.g. sessionStorage).
 * Does not overwrite module-resolved API titles, descriptions, or images.
 */
export async function enrichItineraryDayVariety(itinerary) {
    if (!itinerary?.days?.length) return itinerary;
    const ideas = await loadDayIdeas();
    const stayIndexByDest = new Map();
    const stayLengthByDest = new Map();
    for (const day of itinerary.days) {
        const dest = day.destinationId || '_';
        stayLengthByDest.set(dest, (stayLengthByDest.get(dest) || 0) + 1);
    }

    const days = itinerary.days.map((day) => {
        const dest = day.destinationId;
        if (!dest) return day;

        const stayIndex = stayIndexByDest.get(dest) || 0;
        stayIndexByDest.set(dest, stayIndex + 1);
        if (shouldPreserveDayContent(day)) {
            const live = getModule(destinationEntry(ideas, dest), day.moduleId);
            if (!live?.image) return day;
            return {
                ...day,
                image: live.image,
                imageAlt: live.imageAlt || day.imageAlt,
            };
        }

        const idea = selectDayIdea(
            ideas,
            dest,
            stayIndex,
            stayLengthByDest.get(dest),
            day.journey?.load || null,
        );
        const lower = String(day.title || '').toLowerCase();
        const keepArrive = lower.startsWith('arrive');

        return {
            ...day,
            title: keepArrive ? day.title : idea.title,
            summary: idea.summary,
            description: idea.summary,
            highlights: idea.highlights || [],
            image: idea.image || day.image || '',
            imageAlt: idea.imageAlt || idea.title,
            moduleId: idea.moduleId || day.moduleId || null,
            experienceIds: idea.experienceIds?.length ? idea.experienceIds : (day.experienceIds || []),
        };
    });

    return { ...itinerary, days };
}

export { loadDayIdeas };

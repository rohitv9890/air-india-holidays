export const PLACE_ALIASES = {
    frankfurt: { name: 'Frankfurt', code: 'FRA', type: 'airport_code' },
    london: { name: 'London', code: 'LHR', type: 'airport_code' },
    'london heathrow': { name: 'London Heathrow', code: 'LHR', type: 'airport_code' },
    heathrow: { name: 'London Heathrow', code: 'LHR', type: 'airport_code' },

    // Taj Holidays cluster (gateways Delhi / Mumbai)
    delhi: { name: 'Delhi', code: 'DEL', type: 'airport_code' },
    'new delhi': { name: 'Delhi', code: 'DEL', type: 'airport_code' },
    del: { name: 'Delhi', code: 'DEL', type: 'airport_code' },
    mumbai: { name: 'Mumbai', code: 'BOM', type: 'airport_code' },
    agra: { name: 'Agra', code: 'AGR', type: 'airport_code' },
    'taj mahal': { name: 'Agra', code: 'AGR', type: 'airport_code' },
    udaipur: { name: 'Udaipur', code: 'UDR', type: 'airport_code' },
    jaipur: { name: 'Jaipur', code: 'JAI', type: 'airport_code' },
    hyderabad: { name: 'Hyderabad', code: 'HYD', type: 'airport_code' },
    kochi: { name: 'Kochi', code: 'COK', type: 'airport_code' },
    goa: { name: 'Goa', code: 'GOI', type: 'airport_code' },
    maldives: { name: 'Maldives', code: 'MLE', type: 'airport_code' },
    male: { name: 'Maldives', code: 'MLE', type: 'airport_code' },
    'golden triangle': { name: 'Golden Triangle', code: 'DEL', type: 'place_id', id: '244102' },
    'taj holidays': { name: 'Golden Triangle', code: 'DEL', type: 'place_id', id: '244102' },
    india: { name: 'India', code: 'DEL', type: 'place_id', id: '244102' },
    'delhi airport': { name: 'Indira Gandhi International Airport', code: 'DEL', type: 'airport_code' },
    'indira gandhi international airport': { name: 'Indira Gandhi International Airport', code: 'DEL', type: 'airport_code' },
    'taj lake palace': { name: 'Taj Lake Palace, Udaipur', code: '31842', id: '31842', type: 'hotel' },
    'taj exotica': { name: 'Taj Exotica Resort, Maldives', code: '31843', id: '31843', type: 'hotel' },

    // Cricket World Cup 2027 cluster (gateway Johannesburg)
    johannesburg: { name: 'Johannesburg', code: 'JNB', type: 'airport_code' },
    'cape town': { name: 'Cape Town', code: 'CPT', type: 'airport_code' },
    durban: { name: 'Durban', code: 'DUR', type: 'airport_code' },
    centurion: { name: 'Centurion', code: 'JNB', type: 'airport_code' },
    gqeberha: { name: 'Gqeberha', code: 'PLZ', type: 'airport_code' },
    'port elizabeth': { name: 'Gqeberha', code: 'PLZ', type: 'airport_code' },
    'cricket world cup': { name: 'Cricket World Cup 2027', code: 'JNB', type: 'place_id', id: '244103' },
    'world cup': { name: 'Cricket World Cup 2027', code: 'JNB', type: 'place_id', id: '244103' },
    wanderers: { name: 'The Wanderers Stadium, Johannesburg', code: 'JNB', type: 'airport_code' },
    newlands: { name: 'Newlands, Cape Town', code: 'CPT', type: 'airport_code' },
    kingsmead: { name: 'Kingsmead, Durban', code: 'DUR', type: 'airport_code' },
    'supersport park': { name: 'SuperSport Park, Centurion', code: 'JNB', type: 'airport_code' },
    "st george's park": { name: "St George's Park, Gqeberha", code: 'PLZ', type: 'airport_code' },

    dubai: { name: 'Dubai', code: 'DXB', type: 'airport_code' },
    nairobi: { name: 'Nairobi', code: 'NBO', type: 'airport_code' },
    singapore: { name: 'Singapore', code: 'SIN', type: 'airport_code' },
    'kuala lumpur': { name: 'Kuala Lumpur', code: 'KUL', type: 'airport_code' },
    kul: { name: 'Kuala Lumpur', code: 'KUL', type: 'airport_code' },
};

export function createEmptyIntent(tab) {
    return {
        productTab: tab,
        origin: null,
        destination: null,
        pickup: null,
        dropoff: null,
        dates: { start: null, end: null },
        pickupDate: null,
        pickupTime: null,
        travelers: { adults: null, children: 0, childAges: [], infants: 0, rooms: null },
        cabin: null,
        tier: null,
        roundTrip: true,
        interests: [],
        durationDays: null,
        stayPlan: null,
        preferences: null,
    };
}

function resolvePlace(text) {
    if (!text) return null;
    const cleaned = text.replace(/\s+\bfrom\b[\s\S]*$/i, '').trim();
    const lower = cleaned.toLowerCase().trim();
    const paren = lower.match(/\(([a-z]{3})\)/i);
    if (paren) {
        const code = paren[1].toUpperCase();
        const name = cleaned.replace(/\s*\([A-Z]{3}\)/i, '').trim();
        return { name: name || code, code, type: 'airport_code' };
    }
    if (PLACE_ALIASES[lower]) return { ...PLACE_ALIASES[lower] };
    // Prefer longest alias match so "london heathrow" wins over "london"
    let best = null;
    let bestLen = 0;
    for (const [key, place] of Object.entries(PLACE_ALIASES)) {
        const hit = key.length <= 3
            ? new RegExp(`(?:^|\\s)${key}(?:\\s|$)`).test(lower)
            : lower.includes(key);
        if (hit && key.length > bestLen) {
            best = place;
            bestLen = key.length;
        }
    }
    if (best) return { ...best };
    return { name: cleaned.trim(), code: null, type: 'place_id' };
}

const MONTH_INDEX = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

/** Next occurrence of month/day within the 12-month booking window. */
function resolveTravelYear(month, day, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let candidate = new Date(today.getFullYear(), month - 1, day);
    if (candidate < today) {
        candidate = new Date(today.getFullYear() + 1, month - 1, day);
    }
    return candidate.getFullYear();
}

function ymd(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDates(text) {
    const lower = text.toLowerCase();
    const range = lower.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/);
    if (range) return { start: range[1], end: range[2] };

    const dayMonth = lower.match(
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/i
    );
    if (dayMonth) {
        const day = parseInt(dayMonth[1], 10);
        const month = MONTH_INDEX[dayMonth[2].toLowerCase()];
        const year = dayMonth[3] ? parseInt(dayMonth[3], 10) : resolveTravelYear(month, day);
        return { start: ymd(year, month, day), end: null };
    }

    const monthDay = lower.match(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:to|-)\s*(\d{1,2})(?:st|nd|rd|th)?)?(?:\s+(\d{4}))?\b/i
    );
    if (monthDay) {
        const month = MONTH_INDEX[monthDay[1].toLowerCase()];
        const startDay = parseInt(monthDay[2], 10);
        const endDay = monthDay[3] ? parseInt(monthDay[3], 10) : null;
        const year = monthDay[4] ? parseInt(monthDay[4], 10) : resolveTravelYear(month, startDay);
        return {
            start: ymd(year, month, startDay),
            end: endDay ? ymd(year, month, endDay) : null,
        };
    }

    if (/\b(weekend|next week|this month)\b/i.test(lower)) {
        return null;
    }

    return null;
}

function parseTravelers(text) {
    const lower = text.toLowerCase();
    const result = { adults: null, children: null, childAges: [], infants: null, rooms: 1 };

    const adults = lower.match(/(\d+)\s*adults?/);
    if (adults) result.adults = parseInt(adults[1], 10);

    const children = lower.match(/(\d+)\s*(?:children|child|kids?)/);
    if (children) result.children = parseInt(children[1], 10);

    const infants = lower.match(/(\d+)\s*infants?/);
    if (infants) result.infants = parseInt(infants[1], 10);

    const family = lower.match(/\bfamily\b/);
    if (family && result.adults == null) {
        result.adults = 2;
        result.children = 2;
    }

    const ageMatches = [...lower.matchAll(/(?:child|kid)\s*(\d+)\s*(?:years?|yrs?|yo)?/g)];
    ageMatches.forEach(m => result.childAges.push(parseInt(m[1], 10)));

    const agesList = lower.match(/ages?\s+([\d,\sand&]+)/i);
    if (agesList) {
        const nums = [...agesList[1].matchAll(/\b(1[0-7]|[2-9])\b/g)].map(m => parseInt(m[1], 10));
        if (nums.length) result.childAges = nums;
    } else if (/\d\s*(?:,|and|&)\s*\d/.test(lower)) {
        const nums = [...lower.matchAll(/\b(1[0-7]|[2-9])\b/g)].map(m => parseInt(m[1], 10));
        if (nums.length >= 2) result.childAges = nums;
    } else {
        const bareAges = [...text.matchAll(/\b(1[0-7]|[2-9])\b/g)].map(m => parseInt(m[1], 10));
        if (bareAges.length > 0 && (result.children > 0 || /age|child|kid|year/i.test(lower))) {
            result.childAges = bareAges;
        }
    }

    const roomMatch = lower.match(/(\d+)\s*rooms?/);
    if (roomMatch) result.rooms = parseInt(roomMatch[1], 10);

    return result;
}

function parseCabin(text) {
    const lower = text.toLowerCase();
    if (lower.includes('business')) return 'Business';
    if (lower.includes('first class') || lower.includes('first-class')) return 'First';
    if (lower.includes('premium economy')) return 'Premium Economy';
    return null;
}

function parseRoute(text) {
    const fromTo = text.match(/(?:from|leaving)\s+([^,]+?)\s+(?:to|into)\s+([^,.]+)/i);
    if (fromTo) {
        return { origin: resolvePlace(fromTo[1]), destination: resolvePlace(fromTo[2]) };
    }

    const result = {};
    const fromOnly = text.match(/\bfrom\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s*$|[,.]|\s+in\s|\s+on\s|\s+\d)/i);
    if (fromOnly) {
        result.origin = resolvePlace(fromOnly[1]);
    }

    const toOnly = text.match(/(?:trip|package|flight|hotel|tour|transfer|stay|visit|weekend|city\s*break|break)\s+(?:to|in)\s+(.+?)(?:\s+from\s+|,|\.|$)/i);
    if (toOnly) {
        result.destination = resolvePlace(toOnly[1]);
    }

    const lower = text.toLowerCase();
    if (!result.destination) {
        if (/\b(golden\s+triangle|taj\s+holidays|historic\s+route)\b/.test(lower)) {
            result.destination = resolvePlace('Golden Triangle');
        } else if (/\b(cricket\s+world\s+cup|world\s+cup|icc\s+world\s+cup|cwc)\b/.test(lower)) {
            result.destination = resolvePlace('Cricket World Cup');
        } else if (/\b(taj\s*mahal|agra)\b/.test(lower)) {
            result.destination = resolvePlace('Agra');
        } else if (/\bfamily\b/.test(lower) && /\bindia\b/.test(lower)) {
            result.destination = resolvePlace('Golden Triangle');
        } else if (/\bindia\b/.test(lower) && (/\bpackage\b/.test(lower) || /\btrip\b/.test(lower))) {
            result.destination = resolvePlace('India');
        }
    }

    return result;
}

function parseTransfer(text) {
    const lower = text.toLowerCase();
    const pickupDrop = text.match(/(?:pickup|pick up|from)\s+(.+?)\s+(?:to|dropoff|drop off)\s+(.+)/i);
    if (pickupDrop) {
        return { pickup: resolvePlace(pickupDrop[1]), dropoff: resolvePlace(pickupDrop[2]) };
    }
    if (lower.includes('airport') && lower.includes('taj lake palace')) {
        return {
            pickup: resolvePlace('Delhi Airport'),
            dropoff: resolvePlace('Taj Lake Palace'),
        };
    }
    return {};
}

export function parseSlotsFromMessage(text, tab) {
    const slots = {};
    const route = parseRoute(text);
    Object.assign(slots, route);

    if (tab === 'transfers') {
        Object.assign(slots, parseTransfer(text));
    }

    const dates = parseDates(text);
    if (dates) slots.dates = dates;

    const travelers = parseTravelers(text);
    if (travelers.adults != null || travelers.children != null || travelers.infants != null || travelers.childAges.length) {
        slots.travelers = travelers;
    }

    const cabin = parseCabin(text);
    if (cabin) slots.cabin = cabin;

    if (/\bone.?way\b/i.test(text)) slots.roundTrip = false;
    if (/\breturn\b/i.test(text)) slots.roundTrip = true;

    const timeMatch = text.match(/\b(\d{1,2}:\d{2})\b/);
    if (timeMatch) slots.pickupTime = timeMatch[1];

    const singleDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (singleDate && tab === 'transfers') slots.pickupDate = singleDate[1];

    return slots;
}

/** Parse short replies when user answers a follow-up question */
export function parseAnswerForMissing(text, intent, tab) {
    const missing = getMissingFields(intent, tab);
    if (!missing.length || text.length > 80) return {};

    const slots = {};
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    for (const field of missing) {
        if (field.key === 'origin') {
            slots.origin = resolvePlace(trimmed);
            break;
        }
        if (field.key === 'destination') {
            slots.destination = resolvePlace(trimmed);
            break;
        }
        if (field.key === 'pickup') {
            slots.pickup = resolvePlace(trimmed);
            break;
        }
        if (field.key === 'dropoff') {
            slots.dropoff = resolvePlace(trimmed);
            break;
        }
        if (field.key === 'dateStart' || field.key === 'dateEnd') {
            const dates = parseDates(trimmed);
            if (dates) {
                slots.dates = dates;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                slots.dates = field.key === 'dateEnd'
                    ? { start: intent.dates?.start, end: trimmed }
                    : { start: trimmed, end: intent.dates?.end };
            }
            break;
        }
        if (field.key === 'pickupDate' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            slots.pickupDate = trimmed;
            break;
        }
        if (field.key === 'pickupTime') {
            slots.pickupTime = trimmed.match(/\d{1,2}:\d{2}/)?.[0] || trimmed;
            break;
        }
        if (field.key === 'cabin') {
            slots.cabin = parseCabin(trimmed) || trimmed;
            break;
        }
        if (field.key.startsWith('childAge')) {
            const ages = [...trimmed.matchAll(/\b(1[0-7]|[2-9])\b/g)].map(m => parseInt(m[1], 10));
            if (ages.length) slots.travelers = { childAges: ages };
            break;
        }
    }

    if (!Object.keys(slots).length && missing.length === 1) {
        const field = missing[0];
        if (field.key === 'origin') slots.origin = resolvePlace(trimmed);
        if (field.key === 'destination') slots.destination = resolvePlace(trimmed);
    }

    return slots;
}

export function mergeIntent(existing, slots, tab) {
    const intent = existing ? structuredClone(existing) : createEmptyIntent(tab);
    intent.productTab = tab;

    if (slots.origin) intent.origin = { ...intent.origin, ...slots.origin };
    if (slots.destination) intent.destination = { ...intent.destination, ...slots.destination };
    if (slots.pickup) intent.pickup = { ...intent.pickup, ...slots.pickup };
    if (slots.dropoff) intent.dropoff = { ...intent.dropoff, ...slots.dropoff };
    if (slots.dates) {
        intent.dates = {
            start: slots.dates.start || intent.dates?.start,
            end: slots.dates.end || intent.dates?.end,
        };
    }
    if (slots.pickupDate) intent.pickupDate = slots.pickupDate;
    if (slots.pickupTime) intent.pickupTime = slots.pickupTime;
    if (slots.cabin) intent.cabin = slots.cabin;
    if (slots.tier) intent.tier = slots.tier;
    if (slots.roundTrip != null) intent.roundTrip = slots.roundTrip;
    if (slots.interests) intent.interests = slots.interests;
    if (slots.durationDays !== undefined) intent.durationDays = slots.durationDays;
    if (slots.stayPlan !== undefined) intent.stayPlan = slots.stayPlan;
    if (slots.preferences !== undefined) intent.preferences = slots.preferences;

    if (slots.travelers) {
        const t = intent.travelers;
        const s = slots.travelers;
        if (s.adults != null) t.adults = s.adults;
        if (s.children != null) {
            t.children = s.children;
            if (!s.childAges?.length) t.childAges = [];
        }
        if (s.infants != null) t.infants = s.infants;
        if (s.rooms != null) t.rooms = s.rooms;
        if (s.childAges?.length) t.childAges = s.childAges;
    }

    return intent;
}

const FIELD_LABELS = {
    origin: 'Flying from',
    destination: 'Destination',
    dateStart: 'Departure / check-in',
    dateEnd: 'Return / check-out',
    pickup: 'Pickup location',
    dropoff: 'Dropoff location',
    pickupDate: 'Pickup date',
    pickupTime: 'Pickup time',
    adults: 'Adults',
    children: 'Children',
    infants: 'Infants',
    cabin: 'Cabin class',
    childAges: 'Children ages',
};

function hasPlace(place) {
    return Boolean(place?.name || place?.code);
}

function field(key, extra = {}) {
    return { key, label: FIELD_LABELS[key], type: extra.type || 'text', required: true, ...extra };
}

export function getMissingFieldsForAction(intent, { tab, action } = {}) {
    const activeTab = tab || intent?.productTab || 'packages';
    const missing = [];
    const t = intent?.travelers || { adults: null, children: 0, childAges: [], infants: 0 };

    if (activeTab === 'packages' || activeTab === 'flights') {
        if (!hasPlace(intent?.origin)) missing.push(field('origin'));
        if (activeTab === 'flights' && !hasPlace(intent?.destination)) missing.push(field('destination'));
        if (!intent?.dates?.start) missing.push(field('dateStart', { type: 'date' }));
        if (t.adults == null || t.adults < 1) {
            missing.push(field('adults', { type: 'number', min: 1, max: 9 }));
        }
        if (activeTab === 'packages') {
            const hasDestination = hasPlace(intent?.destination);
            const hasInterests = Array.isArray(intent?.interests) && intent.interests.length > 0;
            const hasDuration = intent?.durationDays != null && intent.durationDays > 0;
            const hasStayPlan = Array.isArray(intent?.stayPlan) && intent.stayPlan.length > 0;
            if (!hasDestination && !(hasInterests || hasDuration || hasStayPlan) && action !== 'search') {
                missing.push(field('destination'));
            }
        }
    }

    if (activeTab === 'hotels' || activeTab === 'tours') {
        if (!hasPlace(intent?.destination)) missing.push(field('destination'));
        if (!intent?.dates?.start) missing.push(field('dateStart', { type: 'date' }));
        if (!intent?.dates?.end) missing.push(field('dateEnd', { type: 'date' }));
        if (t.adults == null || t.adults < 1) {
            missing.push(field('adults', { type: 'number', min: 1, max: 9 }));
        }
    }

    if (activeTab === 'transfers') {
        if (!hasPlace(intent?.pickup)) missing.push(field('pickup'));
        if (!hasPlace(intent?.dropoff)) missing.push(field('dropoff'));
        if (!intent?.pickupDate) missing.push(field('pickupDate', { type: 'date' }));
    }

    return missing;
}

export function getMissingFields(intent, tab) {
    return getMissingFieldsForAction(intent, { tab, action: 'compose' });
}

export function isIntentComplete(intent, tab, action = 'search') {
    return getMissingFieldsForAction(intent, { tab, action }).length === 0;
}

export function summarizeIntent(intent, tab) {
    const lines = [];
    if (intent.origin?.name) lines.push(`From: ${intent.origin.name}${intent.origin.code ? ` (${intent.origin.code})` : ''}`);
    if (intent.destination?.name) lines.push(`To: ${intent.destination.name}${intent.destination.code ? ` (${intent.destination.code})` : ''}`);
    if (intent.pickup?.name) lines.push(`Pickup: ${intent.pickup.name}`);
    if (intent.dropoff?.name) lines.push(`Dropoff: ${intent.dropoff.name}`);
    if (intent.dates?.start) {
        lines.push(`Dates: ${intent.dates.start}${intent.dates.end ? ` → ${intent.dates.end}` : ''}`);
    }
    if (intent.pickupDate) lines.push(`Date: ${intent.pickupDate}`);
    if (intent.pickupTime) lines.push(`Time: ${intent.pickupTime}`);
    const t = intent.travelers || {};
    if (t.adults != null) {
        const parts = [`${t.adults} adult${t.adults > 1 ? 's' : ''}`];
        if (t.children) parts.push(`${t.children} child${t.children > 1 ? 'ren' : ''}`);
        if (t.childAges?.length) parts.push(`ages ${t.childAges.join(', ')}`);
        if (t.infants) parts.push(`${t.infants} infant${t.infants > 1 ? 's' : ''}`);
        lines.push(`Travellers: ${parts.join(', ')}`);
    }
    if (intent.cabin && (tab === 'packages' || tab === 'flights')) lines.push(`Cabin: ${intent.cabin}`);
    return lines.join('\n');
}

export function getConversationalPrompt(missing, intent, tab) {
    const known = summarizeIntent(intent, tab);
    const knownPart = known.trim()
        ? `So far I have:\n${known}\n\n`
        : '';

    const childAgeFields = missing.filter(f => f.key.startsWith('childAge'));
    const other = missing.filter(f => !f.key.startsWith('childAge'));

    if (childAgeFields.length > 0 && other.length === 0) {
        const n = childAgeFields.length;
        return `${knownPart}${n === 1 ? 'How old is the child travelling with you?' : 'What are the ages of the children travelling with you?'}`;
    }

    if (other.length === 1 && childAgeFields.length === 0) {
        return `${knownPart}${questionForField(other[0])}`;
    }

    const parts = [...other.map(questionForField)];
    if (childAgeFields.length > 0) {
        parts.push(childAgeFields.length === 1
            ? 'the age of the child'
            : 'the ages of the children');
    }

    if (parts.length === 1) {
        return `${knownPart}${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}?`;
    }

    const list = parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    return `${knownPart}I still need ${list}. Could you share those?`;
}

function questionForField(field) {
    const questions = {
        origin: 'Where will you be flying from?',
        destination: 'Where would you like to go?',
        dateStart: 'When would you like to depart (or check in)?',
        dateEnd: 'When will you return (or check out)?',
        pickup: 'Where should I pick you up?',
        dropoff: 'Where is your dropoff?',
        pickupDate: 'What date do you need the pickup?',
        pickupTime: 'What time works for pickup?',
        adults: 'How many adults are travelling?',
        children: 'How many children are travelling?',
        infants: 'How many infants are travelling?',
        cabin: 'Which cabin class would you prefer - Economy, Premium Economy, Business, or First?',
    };
    if (field.key.startsWith('childAge')) {
        return 'How old is the child?';
    }
    return questions[field.key] || `What is your ${field.label.toLowerCase()}?`;
}

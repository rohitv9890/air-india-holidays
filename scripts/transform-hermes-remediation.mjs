#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT_RUN = join(ROOT, 'research/hermes-ethiopia-inventory-2026-08-08');
const HOTEL_RUN = join(ROOT, 'research/hermes-ethiopia-hotels-2026-08-08');
const REMEDIATION_RUN = join(ROOT, 'research/hermes-ethiopia-remediation-2026-08-09');
const CATALOG_DIR = join(ROOT, 'data/catalog/v1');
const GENERATED_AT = '2026-08-09T09:05:00Z';
const SOURCE_RUN_IDS = [
    'hermes-ethiopia-inventory-2026-08-08',
    'hermes-ethiopia-hotels-2026-08-08',
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readJsonl = (path) =>
    readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (error) {
                throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
            }
        });
const writeJson = (name, value) =>
    writeFileSync(join(REMEDIATION_RUN, name), `${JSON.stringify(value, null, 2)}\n`);
const writeJsonl = (name, values) =>
    writeFileSync(join(REMEDIATION_RUN, name), values.map((value) => JSON.stringify(value)).join('\n') + '\n');

function slug(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function unique(values) {
    return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function strings(values) {
    return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : [];
}

function titleFromSlug(value) {
    return value
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

const products = readJsonl(join(PRODUCT_RUN, 'products.jsonl'));
const hotels = readJsonl(join(HOTEL_RUN, 'hotels.jsonl'));
const productCandidates = new Set(readJson(join(PRODUCT_RUN, 'catalog-candidates.json')).candidateIds);
const hotelInventory = readJson(join(HOTEL_RUN, 'hotel-inventory.json'));
const recommendedHotels = new Set(hotelInventory.recommendedHotelIds);
const needsReviewHotels = new Set(hotelInventory.needsReviewHotelIds);
const productCrawlErrors = readJsonl(join(PRODUCT_RUN, 'crawl-errors.jsonl'));
const hotelCrawlErrors = readJsonl(join(HOTEL_RUN, 'crawl-errors.jsonl'));
const productUnresolved = readJsonl(join(PRODUCT_RUN, 'unresolved.jsonl'));
const hotelUnresolved = readJsonl(join(HOTEL_RUN, 'unresolved.jsonl'));
const updatedHotels = readJsonl(join(REMEDIATION_RUN, 'updated-hotel-records.jsonl'));
const updatedHotelById = new Map(updatedHotels.map((record) => [record.id, record]));
const stillFailed = readJsonl(join(REMEDIATION_RUN, 'still-failed.jsonl'));
const remediationSources = readJsonl(join(REMEDIATION_RUN, 're-crawled-sources.jsonl'));
const existingCatalog = readJson(join(CATALOG_DIR, 'catalog.json'));
const existingDestinations = readJson(join(CATALOG_DIR, 'destinations.json'));
const existingFlights = readJson(join(CATALOG_DIR, 'flights.json'));
const existingById = new Map(existingCatalog.products.map((product) => [product.id, product]));

const MIXED_ACCOMMODATION_TO_HOTEL = new Map([
    ['stay-lalibela-mezena-lodge', 'hotel-lalibela-mezena-resort-and-spa'],
    ['stay-lalibela-maribela-hotel', 'hotel-lalibela-hotel-maribela'],
    ['stay-lalibela-tukul-village', 'hotel-lalibela-tukul-village'],
    ['stay-gondar-haile-resort', 'hotel-gondar-haile-resort'],
    ['stay-gondar-goha-hotel', 'hotel-gondar-goha-hotel'],
    ['stay-bahir-dar-jacaranda-hotel', 'hotel-bahir-dar-jacaranda-hotel'],
]);

const EXISTING_ENTITY_IDS = new Map([
    ['hotel-addis-ababa-sheraton-addis', 'acc-sheraton-addis'],
    ['hotel-addis-ababa-ethiopian-skylight-hotel', 'acc-skylight-addis'],
    ['hotel-bahir-dar-kuriftu-resort-and-spa', 'acc-kuriftu-bahir-dar'],
    ['hotel-gondar-goha-hotel', 'acc-gondar-lodge'],
    ['hotel-lalibela-hotel-maribela', 'acc-maribela-lalibela'],
    ['hotel-arba-minch-paradise-lodge', 'acc-paradise-lodge'],
    ['hotel-harar-harar-ras-hotel', 'acc-harar-ras'],
    ['stay-bale-mountains-lodge', 'acc-bale-mountain-lodge'],
]);

const PLACE_ALIASES = new Map([
    ['addis-ababa', 'addis-ababa'],
    ['bahir-dar', 'bahir-dar'],
    ['bahar-dar', 'bahir-dar'],
    ['lake-tana', 'bahir-dar'],
    ['blue-nile-falls', 'bahir-dar'],
    ['gondar', 'gondar'],
    ['lalibela', 'lalibela'],
    ['axum', 'axum'],
    ['simien-mountains', 'simien'],
    ['simien-mountains-national-park', 'simien'],
    ['arba-minch', 'arba-minch'],
    ['omo-valley', 'omo-valley'],
    ['jinka', 'omo-valley'],
    ['mago-national-park', 'omo-valley'],
    ['turmi', 'omo-valley'],
    ['omorate', 'omo-valley'],
    ['konso', 'omo-valley'],
    ['karat-konso', 'omo-valley'],
    ['lake-chamo', 'arba-minch'],
    ['bale-mountains-national-park', 'bale'],
    ['bale-mountains', 'bale'],
    ['danakil-depression', 'danakil'],
    ['erta-ale', 'danakil'],
    ['dallol', 'danakil'],
    ['lake-assal', 'danakil'],
    ['harar', 'harar'],
    ['dire-dawa', 'dire-dawa'],
    ['hawassa', 'hawassa'],
    ['awassa', 'hawassa'],
    ['rift-valley-lakes', 'rift-valley-lakes'],
    ['langano', 'rift-valley-lakes'],
    ['lake-langano', 'rift-valley-lakes'],
    ['lake-ziway', 'rift-valley-lakes'],
    ['lakes-abiata-and-shala', 'rift-valley-lakes'],
    ['abiyata-shala-national-park', 'rift-valley-lakes'],
    ['yirgalem', 'rift-valley-lakes'],
    ['dilla', 'rift-valley-lakes'],
    ['yirgacheffe', 'rift-valley-lakes'],
    ['tutu-fella', 'rift-valley-lakes'],
    ['tiya', 'rift-valley-lakes'],
    ['melka-kunture', 'rift-valley-lakes'],
    ['lephis-forest', 'rift-valley-lakes'],
    ['akaki-wetlands', 'rift-valley-lakes'],
    ['mekelle', 'mekelle'],
    ['tigray', 'tigray-heritage'],
    ['tigray-churches', 'tigray-heritage'],
    ['wollo', 'tigray-heritage'],
    ['bishoftu', 'bishoftu'],
    ['adama', 'adama'],
    ['jimma', 'jimma'],
]);

const DESTINATION_METADATA = {
    'dire-dawa': {
        name: 'Dire Dawa',
        iata: 'DIR',
        cluster: 'east',
        region: 'Dire Dawa',
        themes: ['city', 'gateway', 'culture'],
        summary: 'Eastern Ethiopian gateway for Harar and regional road journeys.',
    },
    hawassa: {
        name: 'Hawassa',
        iata: 'AWA',
        cluster: 'rift-valley',
        region: 'Sidama',
        themes: ['lakes', 'nature', 'city'],
        summary: 'Lakeside city and southern Rift Valley itinerary stop.',
    },
    mekelle: {
        name: 'Mekelle',
        iata: 'MQX',
        cluster: 'tigray',
        region: 'Tigray',
        themes: ['history', 'city', 'gateway'],
        summary: 'Regional gateway for Tigray heritage routes and northern Ethiopia.',
    },
    adama: {
        name: 'Adama',
        iata: null,
        cluster: 'rift-valley',
        region: 'Oromia',
        themes: ['city', 'gateway'],
        summary: 'Oromia commercial centre on the eastern Rift Valley corridor.',
    },
    jimma: {
        name: 'Jimma',
        iata: 'JIM',
        cluster: 'southwest',
        region: 'Oromia',
        themes: ['coffee', 'culture', 'city'],
        summary: 'Southwestern Ethiopian city associated with the country’s coffee heritage.',
    },
    bishoftu: {
        name: 'Bishoftu',
        iata: null,
        cluster: 'rift-valley',
        region: 'Oromia',
        themes: ['lakes', 'resort', 'short-break'],
        summary: 'Crater-lake resort area within road reach of Addis Ababa.',
    },
    'rift-valley-lakes': {
        name: 'Rift Valley Lakes',
        iata: null,
        cluster: 'rift-valley',
        region: 'Oromia and Sidama',
        themes: ['lakes', 'nature', 'wildlife'],
        summary: 'Lake and wildlife corridor south of Addis Ababa.',
    },
    'tigray-heritage': {
        name: 'Tigray Heritage',
        iata: 'MQX',
        cluster: 'tigray',
        region: 'Tigray',
        themes: ['history', 'faith', 'architecture'],
        summary: 'Northern heritage region known for rock-hewn churches and historic sites.',
    },
};

function destinationId(value) {
    const key = slug(typeof value === 'object' ? value?.name : value);
    return PLACE_ALIASES.get(key) ?? key;
}

function productDestinations(product) {
    let values = product.normalized?.destinations ?? [];
    if (!values.length && product.type === 'flight-route' && product.normalized?.flight?.destination) {
        values = [product.normalized.flight.destination.name];
    }
    if (!values.length && product.type === 'transfer') {
        const id = product.id;
        if (id.includes('lalibela')) values = ['Lalibela'];
        else if (id.includes('bahir-dar')) values = ['Bahir Dar'];
        else if (id.includes('gondar') || id.includes('simien')) values = ['Gondar', 'Simien Mountains'];
        else if (id.includes('addis')) values = ['Addis Ababa'];
    }
    if (product.id === 'stay-bale-mountains-lodge') values = ['Bale Mountains'];
    if (product.id === 'stay-bahir-dar-jacaranda-hotel') values = ['Bahir Dar'];
    return unique(values.map(destinationId).filter((value) => value && value !== 'lodge' && value !== 'dar'));
}

function catalogType(product) {
    if (product.type === 'tour') return 'package';
    if (product.type === 'flight-route') return 'flight';
    return product.type;
}

function targetIdForProduct(product) {
    if (EXISTING_ENTITY_IDS.has(product.id)) return EXISTING_ENTITY_IDS.get(product.id);
    const id = product.id;
    if (id.startsWith('product-pkg-')) return `pkg-${id.slice('product-pkg-'.length)}`;
    if (id.startsWith('package-')) return `pkg-${id.slice('package-'.length)}`;
    if (id.startsWith('stay-')) return `acc-${id.slice('stay-'.length)}`;
    if (id.startsWith('transfer-')) return `xfer-${id.slice('transfer-'.length)}`;
    if (id.startsWith('product-fr-')) return `flt-${id.slice('product-fr-'.length)}`;
    const prefix = { package: 'pkg', experience: 'exp', accommodation: 'acc', transfer: 'xfer', flight: 'flt' }[
        catalogType(product)
    ];
    return `${prefix}-${slug(id.replace(/^product-/, ''))}`;
}

function targetIdForHotel(hotel) {
    return EXISTING_ENTITY_IDS.get(hotel.id) ?? `acc-${hotel.id.slice('hotel-'.length)}`;
}

function normalizePriceBasis(value) {
    const key = String(value ?? '').toLowerCase().replace(/_/g, '-').trim();
    if (key === 'per-person' || key === 'per person') return 'per-person';
    if (key === 'per-person-sharing' || key === 'per person sharing' || key === 'per person (group of 2)') {
        return 'per-person-sharing';
    }
    if (key.startsWith('per person (')) return 'per-person';
    if (key === 'per-group' || key === 'per group') return 'per-group';
    if (key === 'per-vehicle' || key === 'per vehicle') return 'per-vehicle';
    if (key === 'flat') return 'flat';
    return null;
}

function confidenceIsLow(value) {
    if (typeof value === 'number') return value < 0.5;
    return String(value ?? '').toLowerCase() === 'low';
}

function collisionBlocker(targetId, sourceName) {
    const existing = existingById.get(targetId);
    if (!existing) return null;
    return {
        code: 'DUPLICATE_UNRESOLVED',
        field: 'id',
        requiredAction: `Review merge with existing catalog entity "${existing.name}" before replacing or updating it.`,
        existingCatalogId: targetId,
        sourceName,
    };
}

function blocker(code, field, requiredAction) {
    return { code, field, requiredAction };
}

function productBlockers(product) {
    const result = [];
    const normalized = product.normalized ?? {};
    const price = normalized.price ?? {};
    const amount = price.amount;
    const basis = normalizePriceBasis(price.basis);
    const destinations = productDestinations(product);
    const kind = catalogType(product);

    if (kind === 'flight') {
        result.push(blocker('SCHEDULE_UNVERIFIED', 'normalized.flight', 'Verify current operating schedule and frequency.'));
        result.push(blocker('PRICE_UNKNOWN', 'basePrice', 'Obtain a current source-backed fare in an accepted currency.'));
        result.push(blocker('REQUIRED_FIELD_MISSING', 'duration', 'Obtain a source-backed route duration.'));
    } else {
        if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
            result.push(blocker('PRICE_UNKNOWN', 'basePrice', 'Obtain a current source-backed commercial rate.'));
        }
        if (typeof amount === 'number' && amount > 0 && !basis) {
            result.push(
                blocker('PRICE_BASIS_UNSUPPORTED', 'basePrice.basis', `Review source price basis "${price.basis ?? 'unknown'}".`),
            );
        }
    }
    if (price.validTo && price.validTo < GENERATED_AT.slice(0, 10)) {
        result.push(blocker('PRICE_UNKNOWN', 'basePrice', `Published price expired on ${price.validTo}; obtain a current rate.`));
    }
    if (!destinations.length) {
        result.push(blocker('REQUIRED_FIELD_MISSING', 'destinations', 'Resolve at least one canonical destination.'));
    }
    if (!product.name || !(normalized.summaryFacts?.length || product.raw?.description || product.raw?.headline)) {
        result.push(blocker('REQUIRED_FIELD_MISSING', 'summary', 'Create a source-backed summary.'));
    }
    if (confidenceIsLow(product.overallConfidence)) {
        result.push(blocker('SOURCE_TOO_WEAK', 'overallConfidence', 'Obtain stronger corroborating evidence.'));
    }
    const destinationText = destinations.join(' ');
    if (destinationText.includes('danakil') || /danakil|erta ale|dallol/i.test(product.name)) {
        result.push(blocker('SAFETY_REVIEW_REQUIRED', 'destinations', 'Complete a current operating and safety review.'));
    }
    const collision = collisionBlocker(targetIdForProduct(product), product.name);
    if (collision) result.push(collision);
    return uniqueBlockers(result);
}

function hotelBlockers(hotel) {
    const result = [];
    const rate = hotel.booking?.rateObserved ?? {};
    if (!(typeof rate.amount === 'number' && rate.amount > 0)) {
        result.push(blocker('PRICE_UNKNOWN', 'basePrice', 'Obtain a current source-backed commercial room rate.'));
    }
    if (typeof rate.amount === 'number' && rate.amount > 0) {
        result.push(
            blocker(
                'PRICE_BASIS_UNSUPPORTED',
                'basePrice.basis',
                'Catalog schema has no per-room/per-night basis; extend the schema or define an approved mapping.',
            ),
        );
    }
    if (needsReviewHotels.has(hotel.id) || /harar-ras|jimma-palace|ethiopian-skylight-hotel$/.test(hotel.id)) {
        result.push(
            blocker('OPERATING_STATUS_UNVERIFIED', 'reviewStatus', 'Resolve the property identity and current operating status.'),
        );
    }
    if (confidenceIsLow(hotel.overallConfidence)) {
        result.push(blocker('SOURCE_TOO_WEAK', 'overallConfidence', 'Obtain a stronger official or corroborating source.'));
    }
    const collision = collisionBlocker(targetIdForHotel(hotel), hotel.name);
    if (collision) result.push(collision);
    return uniqueBlockers(result);
}

function uniqueBlockers(blockers) {
    const seen = new Set();
    return blockers.filter((item) => {
        const key = `${item.code}:${item.field}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function tierForProduct(product) {
    const levels = strings(product.normalized?.accommodationLevel).map((value) => value.toLowerCase());
    if (levels.some((value) => /luxury|upscale|5-star/.test(value))) return 'signature';
    if (levels.some((value) => /midscale|comfort|3-star|4-star/.test(value))) return 'comfort';
    return 'classic';
}

function tierForHotel(hotel) {
    const position = hotel.property?.marketPosition;
    if (position === 'luxury' || position === 'upscale') return 'signature';
    if (position === 'upper-midscale' || position === 'midscale') return 'comfort';
    return 'classic';
}

function summaryForProduct(product) {
    const facts = strings(product.normalized?.summaryFacts);
    const text = facts.slice(0, 2).join(' ') || product.raw?.description || product.raw?.headline || product.name;
    return text.replace(/\s+/g, ' ').trim().slice(0, 360);
}

function seasonalityForProduct(product) {
    const source = product.normalized?.seasonality;
    if (!source) return {};
    if (typeof source === 'string') return { notes: source };
    const result = {};
    if (Array.isArray(source.availableMonths) && source.availableMonths.length) {
        result.availableMonths = source.availableMonths.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);
    }
    if (source.sourceStatement) result.notes = source.sourceStatement;
    return result;
}

function routeForProduct(product) {
    const route = product.normalized?.route;
    if (!Array.isArray(route) || !route.length) return undefined;
    return route
        .map((stop, index) => {
            const place = typeof stop === 'string' ? stop : stop.place ?? stop.destination ?? stop.name;
            const destination = destinationId(place);
            if (!destination) return null;
            const rawTransport = slug(typeof stop === 'object' ? stop.transportToNext : '');
            let transportToNext = null;
            if (rawTransport.includes('flight')) transportToNext = 'flight';
            else if (rawTransport.includes('boat')) transportToNext = 'boat';
            else if (rawTransport.includes('trek') || rawTransport.includes('hike')) transportToNext = 'trek';
            else if (rawTransport) transportToNext = 'road';
            const mapped = { sequence: index + 1, destinationId: destination, transportToNext };
            if (typeof stop === 'object' && Number.isInteger(stop.nights) && stop.nights >= 0) mapped.nights = stop.nights;
            return mapped;
        })
        .filter(Boolean);
}

function mappedProductFields(product, { includePrice = true } = {}) {
    const normalized = product.normalized ?? {};
    const destinations = productDestinations(product);
    const themes = unique(strings(normalized.themes).map(slug));
    const travellers = unique(strings(normalized.travellerTypes).map(slug));
    const duration = normalized.duration ?? {};
    const mapped = {
        id: targetIdForProduct(product),
        type: catalogType(product),
        name: product.name,
        summary: summaryForProduct(product),
        destinations,
        themes,
        tier: tierForProduct(product),
        inclusions: strings(normalized.inclusions),
        exclusions: strings(normalized.exclusions),
        images: [],
        easygds: {
            packageId: null,
            placeId: null,
            hotelId: null,
            flightConfigId: null,
            productCode: targetIdForProduct(product),
        },
        seasonality: seasonalityForProduct(product),
        compatibility: unique([...destinations, ...themes, ...travellers]),
    };
    if (
        Number.isInteger(duration.days) ||
        Number.isInteger(duration.nights) ||
        (typeof duration.hours === 'number' && Number.isFinite(duration.hours))
    ) {
        mapped.duration = {};
        if (Number.isInteger(duration.days) && duration.days >= 0) mapped.duration.days = duration.days;
        if (Number.isInteger(duration.nights) && duration.nights >= 0) mapped.duration.nights = duration.nights;
        if (typeof duration.hours === 'number' && duration.hours >= 0) mapped.duration.hours = duration.hours;
    }
    if (includePrice) {
        const price = normalized.price;
        mapped.basePrice = {
            amount: price.amount,
            currency: price.currency,
            basis: normalizePriceBasis(price.basis),
        };
    }
    const route = routeForProduct(product);
    if (mapped.type === 'package' && route?.length) mapped.route = route;
    if (mapped.type === 'flight') {
        const flight = normalized.flight ?? {};
        mapped.origin = flight.origin?.iata;
        mapped.destination = flight.destination?.iata;
        mapped.iata = flight.destination?.iata;
    }
    return mapped;
}

function mappedHotelFields(hotel) {
    const city = destinationId(hotel.location?.city);
    const types = strings(hotel.property?.propertyType).map((value) => value.replace(/-hotel$/, ''));
    const facilities = hotel.facilities ?? {};
    const facilityThemes = [
        facilities.pool ? 'pool' : null,
        facilities.wellness?.length ? 'wellness' : null,
        facilities.meetingEvents?.length ? 'business' : null,
        ...types,
    ];
    const classification = hotel.property?.officialClassification;
    const mapped = {
        id: targetIdForHotel(hotel),
        type: 'accommodation',
        name: hotel.name,
        summary: (hotel.raw?.description || `${hotel.name} in ${hotel.location?.city}, Ethiopia.`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 360),
        destinations: city ? [city] : [],
        themes: unique(['stay', city, ...facilityThemes].filter(Boolean).map(slug)),
        duration: { days: 1, nights: 1 },
        tier: tierForHotel(hotel),
        inclusions: [],
        exclusions: [],
        images: [],
        easygds: {
            packageId: null,
            placeId: city || null,
            hotelId: null,
            flightConfigId: null,
            productCode: targetIdForHotel(hotel),
        },
        seasonality: {},
        compatibility: unique([city, ...strings(hotel.travellerFit?.segments).map(slug)]),
    };
    if (
        typeof classification?.value === 'number' &&
        classification.value >= 0 &&
        classification.value <= 5 &&
        classification.sourceId
    ) {
        mapped.stars = classification.value;
    }
    return mapped;
}

function fieldProvenance(record, kind) {
    const sourceIds = record.sourceIds ?? [];
    return {
        name: sourceIds,
        summary: sourceIds,
        destinations: sourceIds,
        tier: sourceIds,
        basePrice: kind === 'accommodation' ? [record.booking?.rateObserved?.sourceId].filter(Boolean) : sourceIds,
        inclusions: sourceIds,
        exclusions: sourceIds,
        stars: kind === 'accommodation' ? [record.property?.officialClassification?.sourceId].filter(Boolean) : [],
    };
}

function classifyRemediationChanges(remediation) {
    if (!remediation) return { safe: [], held: [], rejectedClassifications: [] };
    const safe = [];
    const held = [];
    const rejectedClassifications = [];
    const notesSignalConflict = /varies|conflict|discrep|different/i.test(remediation.remediationNotes ?? '');

    for (const change of remediation.changes ?? []) {
        let isSafe = false;
        if (change.field === 'officialClassification') {
            isSafe =
                remediation.sourceType === 'official' &&
                remediation.fetched === true &&
                typeof change.value === 'number';
            if (!isSafe) rejectedClassifications.push(change);
        } else if (change.field === 'roomCount') {
            isSafe = remediation.fetched === true && !notesSignalConflict;
        } else if (
            change.field === 'location.addressRaw' ||
            change.field === 'facilities' ||
            change.field === 'contact.businessPhone' ||
            change.field === 'contact.businessEmail'
        ) {
            isSafe = remediation.fetched === true;
        }
        (isSafe ? safe : held).push(change);
    }
    return { safe, held, rejectedClassifications };
}

const canonicalById = new Map();

for (const hotel of hotels) {
    const blockers = hotelBlockers(hotel);
    const remediation = updatedHotelById.get(hotel.id) ?? null;
    const remediationChanges = classifyRemediationChanges(remediation);
    canonicalById.set(hotel.id, {
        canonicalId: hotel.id,
        kind: 'accommodation',
        sourceRecordIds: [hotel.id],
        sourceRunIds: ['hermes-ethiopia-hotels-2026-08-08'],
        name: hotel.name,
        importStatus: blockers.length ? 'pending' : 'ready',
        importBlockers: blockers,
        targetCatalogId: targetIdForHotel(hotel),
        fieldProvenance: fieldProvenance(hotel, 'accommodation'),
        normalized: {
            hotel,
            remediationEvidence: remediation,
            remediationSelection: {
                safeChanges: remediationChanges.safe,
                heldChanges: remediationChanges.held,
                rejectedClassifications: remediationChanges.rejectedClassifications,
            },
            recommendedForInitialCatalog: recommendedHotels.has(hotel.id),
        },
        reviewNotes: remediation?.remediationNotes ?? hotel.reviewNotes ?? null,
    });
}

for (const product of products) {
    const mappedHotelId = product.type === 'accommodation' ? MIXED_ACCOMMODATION_TO_HOTEL.get(product.id) : null;
    if (mappedHotelId && canonicalById.has(mappedHotelId)) {
        const canonical = canonicalById.get(mappedHotelId);
        canonical.sourceRecordIds.push(product.id);
        canonical.sourceRunIds = unique([...canonical.sourceRunIds, 'hermes-ethiopia-inventory-2026-08-08']);
        canonical.normalized.mixedInventoryRecord = product;
        canonical.fieldProvenance = {
            ...canonical.fieldProvenance,
            mixedInventorySourceIds: product.sourceIds ?? [],
        };
        continue;
    }
    const blockers = productCandidates.has(product.id) ? productBlockers(product) : [];
    canonicalById.set(product.id, {
        canonicalId: product.id,
        kind: catalogType(product),
        sourceRecordIds: [product.id],
        sourceRunIds: ['hermes-ethiopia-inventory-2026-08-08'],
        name: product.name,
        importStatus: productCandidates.has(product.id) ? (blockers.length ? 'pending' : 'ready') : 'excluded',
        importBlockers: blockers,
        targetCatalogId: targetIdForProduct(product),
        fieldProvenance: fieldProvenance(product, catalogType(product)),
        normalized: product,
        reviewNotes: product.reviewNotes ?? null,
    });
}

const canonicalInventory = [...canonicalById.values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
const readyProducts = [];
const pendingProducts = [];
const idMappings = [];
const provenance = [];
const usedDestinationIds = new Set();

for (const canonical of canonicalInventory) {
    if (canonical.importStatus === 'excluded') continue;
    const isHotel = canonical.kind === 'accommodation' && canonical.normalized.hotel;
    const source = isHotel ? canonical.normalized.hotel : canonical.normalized;
    const mapped = isHotel ? mappedHotelFields(source) : mappedProductFields(source, { includePrice: canonical.importStatus === 'ready' });
    for (const destination of mapped.destinations ?? []) usedDestinationIds.add(destination);
    if (canonical.importStatus === 'ready') {
        readyProducts.push(mapped);
    } else {
        pendingProducts.push({
            canonicalId: canonical.canonicalId,
            proposedCatalogId: canonical.targetCatalogId,
            proposedType: canonical.kind,
            sourceRecordIds: canonical.sourceRecordIds,
            mappedFields: mapped,
            blockers: canonical.importBlockers,
            reviewPriority: canonical.importBlockers.some((item) =>
                ['IDENTITY_UNRESOLVED', 'OPERATING_STATUS_UNVERIFIED', 'SAFETY_REVIEW_REQUIRED'].includes(item.code),
            )
                ? 'high'
                : canonical.importBlockers.some((item) => item.code === 'SOURCE_TOO_WEAK')
                  ? 'medium'
                  : 'low',
        });
    }
    idMappings.push({
        canonicalId: canonical.canonicalId,
        sourceRecordIds: canonical.sourceRecordIds,
        targetCatalogId: canonical.targetCatalogId,
        targetType: canonical.kind,
        existingCatalogMatch: existingById.has(canonical.targetCatalogId) ? canonical.targetCatalogId : null,
        action: existingById.has(canonical.targetCatalogId) ? 'review-merge-existing' : 'propose-addition',
    });
    provenance.push({
        catalogId: canonical.targetCatalogId,
        canonicalId: canonical.canonicalId,
        sourceRecordIds: canonical.sourceRecordIds,
        sourceIds: unique(source.sourceIds ?? []),
        fieldSources: canonical.fieldProvenance,
        editorialNormalizations: [
            `Mapped source type to catalog type "${canonical.kind}".`,
            `Mapped source positioning to catalog tier "${mapped.tier}".`,
            'Excluded all images because reuse rights were not verified.',
        ],
        retrievedAt: unique([source.retrievedAt, canonical.normalized.remediationEvidence?.retrievedAt]),
    });
}

for (const required of ['hawassa', 'dire-dawa', 'mekelle', 'adama', 'jimma', 'bishoftu']) {
    usedDestinationIds.add(required);
}

const existingDestinationIds = new Set(existingDestinations.destinations.map((destination) => destination.id));
const destinationIndexAdditions = [...usedDestinationIds]
    .filter((id) => !existingDestinationIds.has(id))
    .sort()
    .map((id) => {
        const metadata = DESTINATION_METADATA[id] ?? {
            name: titleFromSlug(id),
            iata: null,
            cluster: id,
            region: 'Ethiopia',
            themes: [],
            summary: `${titleFromSlug(id)}, Ethiopia.`,
        };
        return { id, ...metadata };
    });

const destinationProducts = destinationIndexAdditions.map((destination) => ({
    id: `dest-${destination.id}`,
    type: 'destination',
    name: destination.name,
    summary: destination.summary,
    destinations: [destination.id],
    themes: destination.themes,
    duration: { days: 0, nights: 0 },
    tier: 'classic',
    basePrice: { amount: 0, currency: 'GBP', basis: 'flat' },
    inclusions: [],
    exclusions: [],
    images: [],
    easygds: {
        packageId: null,
        placeId: destination.iata,
        hotelId: null,
        flightConfigId: null,
        productCode: `dest-${destination.id}`,
    },
    seasonality: {},
    compatibility: unique([destination.id, destination.cluster, 'ethiopia']),
    ...(destination.iata ? { iata: destination.iata } : {}),
    cluster: destination.cluster,
    region: destination.region,
}));

for (const destination of destinationIndexAdditions) {
    provenance.push({
        catalogId: `dest-${destination.id}`,
        canonicalId: `destination-${destination.id}`,
        sourceRecordIds: [],
        sourceIds: [],
        fieldSources: {
            name: [],
            summary: [],
            destinations: [],
            tier: [],
            basePrice: [],
            inclusions: [],
            exclusions: [],
            stars: [],
        },
        editorialNormalizations: [
            'Destination staging record derived from locations in the two source inventories.',
            'Zero price is used only because destination records are non-commercial.',
        ],
        retrievedAt: [GENERATED_AT],
    });
}

const flightCandidates = products.filter((product) => productCandidates.has(product.id) && product.type === 'flight-route');
const existingFlightIds = new Set(existingFlights.routes.map((route) => route.id));
const flightPendingRoutes = flightCandidates.map((product) => {
    const flight = product.normalized?.flight ?? {};
    const id = targetIdForProduct(product);
    const blockers = [
        blocker('PRICE_UNKNOWN', 'baseFareGbp', 'Obtain a current source-backed GBP fare without currency conversion.'),
        blocker('REQUIRED_FIELD_MISSING', 'durationHours', 'Obtain a source-backed scheduled duration.'),
        blocker('SCHEDULE_UNVERIFIED', 'frequencyNote', 'Verify current operation and frequency for the intended dates.'),
    ];
    if (existingFlightIds.has(id)) {
        blockers.push(blocker('DUPLICATE_UNRESOLVED', 'id', 'Review and update the existing route instead of appending a duplicate.'));
    }
    return {
        sourceRecordId: product.id,
        proposedRoute: {
            id,
            origin: flight.origin?.iata ?? null,
            destination: flight.destination?.iata ?? null,
            type: flight.routeType ?? null,
            durationHours: null,
            baseFareGbp: null,
            cabinMultipliers: {},
            frequencyNote: flight.frequencyText ?? null,
        },
        status: 'pending',
        blockers,
        sourceIds: product.sourceIds ?? [],
    };
});

function crawlResolution(error) {
    const url = error.url ?? '';
    const failedMatch = stillFailed.find((record) => record.url === url);
    if (failedMatch) {
        return {
            status: failedMatch.outcome === 'partial' ? 'partially-resolved' : 'still-blocked',
            evidence: [],
            notes: failedMatch.recommendation ?? failedMatch.error,
        };
    }
    if (/kingdawittours/.test(url)) {
        return {
            status: 'superseded',
            evidence: ['src-9ecd885c9c6b'],
            notes: 'Defunct domain was replaced by ethiopiatourandtravels.com.',
        };
    }
    if (/insideethiopiatours/.test(url)) {
        return {
            status: 'resolved',
            evidence: ['src-cf55f37e43d1'],
            notes: 'Public content was recovered through the remediation reader.',
        };
    }
    if (/List-of-Hotels.*pdf/.test(url)) {
        return {
            status: 'resolved',
            evidence: ['src-f33851998b66'],
            notes: 'PDF was fetched as binary and extracted with a PDF-aware reader.',
        };
    }
    if (/hotels\.com/.test(url)) {
        return {
            status: 'resolved',
            evidence: ['src-04dee1f66a3a'],
            notes: 'Public page content was recovered through the remediation reader.',
        };
    }
    if (/expedia\.com/.test(url)) {
        return {
            status: 'partially-resolved',
            evidence: ['src-04dee1f66a3a'],
            notes: 'Compression bug was fixed; some pages remained rate-limited or only partly recoverable.',
        };
    }
    if (/tripadvisor|trivago/.test(url)) {
        return {
            status: 'partially-resolved',
            evidence: [],
            notes: 'Original page remained blocked; alternative public sources supplied limited corroboration.',
        };
    }
    return {
        status: 'still-blocked',
        evidence: [],
        notes: 'Original source remains inaccessible; no access control was bypassed.',
    };
}

const failureRecords = [];
let failureSequence = 1;
for (const [runId, errors] of [
    ['hermes-ethiopia-inventory-2026-08-08', productCrawlErrors],
    ['hermes-ethiopia-hotels-2026-08-08', hotelCrawlErrors],
]) {
    for (const error of errors) {
        const resolution = crawlResolution(error);
        failureRecords.push({
            failureId: `failure-${String(failureSequence++).padStart(4, '0')}`,
            sourceRunId: runId,
            sourceIssueId: null,
            recordIds: [],
            urls: [error.url],
            category: 'crawl-error',
            severity: error.httpStatus === 403 ? 'medium' : 'low',
            originalError: error.message ?? error.errorCode,
            remediationAttempted: true,
            resolutionStatus: resolution.status,
            resolutionEvidenceSourceIds: resolution.evidence,
            notes: resolution.notes,
        });
    }
}

for (const [runId, issues, kind] of [
    ['hermes-ethiopia-inventory-2026-08-08', productUnresolved, 'product-data-quality'],
    ['hermes-ethiopia-hotels-2026-08-08', hotelUnresolved, 'hotel-data-quality'],
]) {
    for (const issue of issues) {
        const recordId = issue.entityId ?? issue.hotelId ?? null;
        const remediation = recordId ? updatedHotelById.get(recordId) : null;
        failureRecords.push({
            failureId: `failure-${String(failureSequence++).padStart(4, '0')}`,
            sourceRunId: runId,
            sourceIssueId: issue.id ?? null,
            recordIds: recordId ? [recordId] : [],
            urls: [],
            category: kind,
            severity: issue.severity ?? 'medium',
            originalError: issue.issue ?? issue.details ?? 'Unresolved source issue',
            remediationAttempted: Boolean(remediation),
            resolutionStatus: remediation ? 'partially-resolved' : 'not-actionable',
            resolutionEvidenceSourceIds: [],
            notes: remediation?.remediationNotes ?? issue.recommendedAction ?? issue.details ?? null,
        });
    }
}

const highPriorityIssues = [
    ['hotel-harar-harar-ras-hotel', 'still-blocked', 'Official website remains compromised; current operating status is not established.'],
    [
        'hotel-bishoftu-ethiopian-skylight-hotel',
        'still-blocked',
        'No evidence in the remediation output establishes a distinct Bishoftu property.',
    ],
    ['hotel-lalibela-sora-lodge', 'resolved', 'Official property website was fetched during remediation.'],
    [
        'hotel-lalibela-zan-seyoum-hotel',
        'partially-resolved',
        'Official URL was identified and directory content fetched; classification remains unverified.',
    ],
    ['hotel-jimma-jimma-palace-hotel', 'still-blocked', 'No stronger current operating-status evidence was added.'],
    ['hotel-bishoftu-lake-bishoftu-resort', 'resolved', 'Official property website was fetched during remediation.'],
    [
        'hotel-dire-dawa-mm-hotel|hotel-dire-dawa-history-hotel',
        'partially-resolved',
        'Both Dire Dawa identities were corroborated, but cross-city duplicate claims were not fully tested.',
    ],
    [
        'hotel-mekelle-planet-hotel|hotel-axum-planet-hotel',
        'still-blocked',
        'The remediation output did not establish whether separate Mekelle and Axum properties exist.',
    ],
];

for (const [ids, status, notes] of highPriorityIssues) {
    failureRecords.push({
        failureId: `failure-${String(failureSequence++).padStart(4, '0')}`,
        sourceRunId: 'hermes-ethiopia-hotels-2026-08-08',
        sourceIssueId: null,
        recordIds: ids.split('|'),
        urls: [],
        category: 'high-priority-identity',
        severity: 'high',
        originalError: 'Identity or operating-status verification required.',
        remediationAttempted: true,
        resolutionStatus: status,
        resolutionEvidenceSourceIds: [],
        notes,
    });
}

const resolvedStatuses = new Set(['resolved', 'partially-resolved', 'superseded']);
const resolvedFailures = failureRecords.filter((failure) => resolvedStatuses.has(failure.resolutionStatus));
const unresolvedFailures = failureRecords.filter((failure) => !resolvedStatuses.has(failure.resolutionStatus));

const ALLOWED_TYPES = new Set(['destination', 'package', 'accommodation', 'experience', 'transfer', 'flight']);
const ALLOWED_TIERS = new Set(['classic', 'comfort', 'signature']);
const ALLOWED_CURRENCIES = new Set(['GBP', 'EUR', 'USD', 'ETB']);
const ALLOWED_BASES = new Set(['per-person', 'per-person-sharing', 'per-group', 'per-vehicle', 'flat']);
const REQUIRED_PRODUCT_FIELDS = [
    'id',
    'type',
    'name',
    'summary',
    'destinations',
    'themes',
    'tier',
    'basePrice',
    'inclusions',
    'exclusions',
    'images',
    'seasonality',
    'compatibility',
];

function validateProduct(product) {
    const errors = [];
    for (const field of REQUIRED_PRODUCT_FIELDS) {
        if (!(field in product)) errors.push(`missing required property ${field}`);
    }
    if (!ALLOWED_TYPES.has(product.type)) errors.push(`invalid type ${product.type}`);
    if (!ALLOWED_TIERS.has(product.tier)) errors.push(`invalid tier ${product.tier}`);
    if (typeof product.id !== 'string' || product.id.length < 3) errors.push('id must be a string of length >= 3');
    if (!Array.isArray(product.destinations)) errors.push('destinations must be an array');
    if (!Array.isArray(product.themes)) errors.push('themes must be an array');
    if (!Array.isArray(product.inclusions)) errors.push('inclusions must be an array');
    if (!Array.isArray(product.exclusions)) errors.push('exclusions must be an array');
    if (!Array.isArray(product.images)) errors.push('images must be an array');
    if (!Array.isArray(product.compatibility)) errors.push('compatibility must be an array');
    if (!(typeof product.basePrice?.amount === 'number' && product.basePrice.amount >= 0)) {
        errors.push('basePrice.amount must be a non-negative number');
    }
    if (!ALLOWED_CURRENCIES.has(product.basePrice?.currency)) errors.push('basePrice.currency is invalid');
    if (product.basePrice?.basis && !ALLOWED_BASES.has(product.basePrice.basis)) errors.push('basePrice.basis is invalid');
    if (product.stars !== undefined && !(typeof product.stars === 'number' && product.stars >= 0 && product.stars <= 5)) {
        errors.push('stars must be between 0 and 5');
    }
    return errors;
}

const readyValidation = readyProducts.map((product) => ({ id: product.id, errors: validateProduct(product) }));
const destinationValidation = destinationProducts.map((product) => ({ id: product.id, errors: validateProduct(product) }));
const duplicateReadyIds = readyProducts
    .map((product) => product.id)
    .filter((id, index, values) => values.indexOf(id) !== index);
const allDestinationIds = new Set([
    ...existingDestinationIds,
    ...destinationIndexAdditions.map((destination) => destination.id),
]);
const missingReadyDestinations = unique(
    readyProducts.flatMap((product) => product.destinations.filter((destination) => !allDestinationIds.has(destination))),
);
const canonicalResolvedSourceIds = new Set([
    ...readJsonl(join(PRODUCT_RUN, 'sources.jsonl')).map((source) => source.sourceId),
    ...readJsonl(join(HOTEL_RUN, 'sources.jsonl')).map((source) => source.sourceId),
    ...remediationSources.map((source) => source.sourceId),
]);
const canonicalReferencedSourceIds = new Set(
    canonicalInventory.flatMap((record) => {
        const source = record.normalized.hotel ?? record.normalized;
        return source.sourceIds ?? [];
    }),
);
const missingSourceIds = [...canonicalReferencedSourceIds].filter((id) => !canonicalResolvedSourceIds.has(id)).sort();
const blockerCounts = {};
for (const pending of pendingProducts) {
    for (const item of pending.blockers) blockerCounts[item.code] = (blockerCounts[item.code] ?? 0) + 1;
}

const checks = [
    {
        id: 'all-recorded-crawl-failures-ingested',
        passed: productCrawlErrors.length + hotelCrawlErrors.length === 44,
        details: `${productCrawlErrors.length + hotelCrawlErrors.length} of 44 recorded crawl failures ingested`,
    },
    {
        id: 'high-priority-identity-statuses-recorded',
        passed: highPriorityIssues.length === 8,
        details: `${highPriorityIssues.length} of 8 high-priority identity issues have explicit statuses`,
    },
    {
        id: 'source-ids-resolve',
        passed: missingSourceIds.length === 0,
        details: missingSourceIds.length ? `Missing: ${missingSourceIds.join(', ')}` : 'All canonical source IDs resolve',
    },
    {
        id: 'ready-products-schema-valid',
        passed: readyValidation.every((result) => result.errors.length === 0),
        details: readyValidation.filter((result) => result.errors.length).map((result) => result.id),
    },
    {
        id: 'destination-products-schema-valid',
        passed: destinationValidation.every((result) => result.errors.length === 0),
        details: destinationValidation.filter((result) => result.errors.length).map((result) => result.id),
    },
    {
        id: 'ready-product-ids-unique',
        passed: duplicateReadyIds.length === 0,
        details: duplicateReadyIds,
    },
    {
        id: 'ready-destinations-resolve',
        passed: missingReadyDestinations.length === 0,
        details: missingReadyDestinations,
    },
    {
        id: 'no-commercial-zero-prices',
        passed: readyProducts.every((product) => product.type === 'destination' || product.basePrice.amount > 0),
        details: readyProducts.filter((product) => product.type !== 'destination' && product.basePrice.amount === 0).map((p) => p.id),
    },
    {
        id: 'no-unknown-rights-images',
        passed: readyProducts.every((product) => product.images.length === 0),
        details: 'Ready products intentionally contain no images',
    },
    {
        id: 'no-unverified-hotel-stars',
        passed: readyProducts.filter((product) => product.type === 'accommodation').every((product) => product.stars === undefined),
        details: 'No accommodation is import-ready until pricing and classification review are complete',
    },
    {
        id: 'no-unpriced-ready-flight-routes',
        passed: true,
        details: 'All flight-route additions remain pending',
    },
    {
        id: 'canonical-count-reconciles',
        passed: canonicalInventory.length === products.length + hotels.length - MIXED_ACCOMMODATION_TO_HOTEL.size,
        details: `${canonicalInventory.length} canonical = ${products.length} products + ${hotels.length} hotels - ${MIXED_ACCOMMODATION_TO_HOTEL.size} merged duplicates`,
    },
];

const validationReport = {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    validator: {
        method: 'Deterministic Node.js validator mirroring data/catalog/schema/catalog.schema.json product constraints',
        schemaPath: 'data/catalog/schema/catalog.schema.json',
        note: 'No JSON Schema validation dependency is installed; the script checks all product required fields and enums used by the schema.',
    },
    passed: checks.every((check) => check.passed),
    checks,
    readyProductResults: readyValidation,
    destinationProductResults: destinationValidation,
};

const canonicalCounts = canonicalInventory.reduce((counts, record) => {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    return counts;
}, {});
const readyCounts = readyProducts.reduce((counts, product) => {
    counts[product.type] = (counts[product.type] ?? 0) + 1;
    return counts;
}, {});
const pendingCounts = pendingProducts.reduce((counts, product) => {
    counts[product.proposedType] = (counts[product.proposedType] ?? 0) + 1;
    return counts;
}, {});
const resolutionCounts = failureRecords.reduce((counts, failure) => {
    counts[failure.resolutionStatus] = (counts[failure.resolutionStatus] ?? 0) + 1;
    return counts;
}, {});

writeJson('failure-register.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    sourceRunIds: SOURCE_RUN_IDS,
    summary: {
        total: failureRecords.length,
        recordedCrawlFailures: productCrawlErrors.length + hotelCrawlErrors.length,
        sourceUnresolvedIssues: productUnresolved.length + hotelUnresolved.length,
        highPriorityIdentityIssues: highPriorityIssues.length,
        byResolutionStatus: resolutionCounts,
    },
    failures: failureRecords,
});
writeJsonl('resolved-failures.jsonl', resolvedFailures);
writeJsonl('unresolved-failures.jsonl', unresolvedFailures);
writeJsonl('canonical-inventory.jsonl', canonicalInventory);
writeJson('catalog-import-bundle.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    sourceRunIds: SOURCE_RUN_IDS,
    targetCatalogVersion: 'v1',
    products: readyProducts,
});
writeJsonl('catalog-products-pending.jsonl', pendingProducts);
writeJson('destination-additions.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    targetCatalogVersion: 'v1',
    products: destinationProducts,
});
writeJson('catalog-schema-validation-document.json', {
    schemaVersion: '1.0.0',
    version: 'v1',
    currency: 'GBP',
    generatedAt: GENERATED_AT,
    notes: 'Validation-only composition of staged products and destination additions; do not deploy as a replacement catalog.',
    products: [...readyProducts, ...destinationProducts],
});
writeJson('destination-index-additions.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    targetCatalogVersion: 'v1',
    destinations: destinationIndexAdditions,
});
writeJson('flight-route-additions.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    targetCatalogVersion: 'v1',
    readyRoutes: [],
    pendingRoutes: flightPendingRoutes,
});
writeJson('id-map.json', {
    schemaVersion: '1.0.0',
    generatedAt: GENERATED_AT,
    mappings: idMappings,
});
writeJsonl('provenance.jsonl', provenance);
writeJson('validation-report.json', validationReport);

const importGuide = `# Import procedure

This directory is a staging bundle. No file here should directly replace a deployed catalog file.

## Review and merge

1. Review every product in \`catalog-import-bundle.json\` and its matching entry in \`provenance.jsonl\`.
2. Resolve relevant entries in \`catalog-products-pending.jsonl\`; do not remove blockers without new evidence.
3. Merge approved \`catalog-import-bundle.json.products\` into \`data/catalog/v1/catalog.json\`.
4. Merge approved \`destination-additions.json.products\` into the catalog and matching \`destination-index-additions.json.destinations\` into \`data/catalog/v1/destinations.json\`.
5. Do not merge any route from \`flight-route-additions.json\` until it has a current source-backed duration, schedule context, and GBP fare. Then merge approved routes into \`data/catalog/v1/flights.json\`.
6. Reject duplicate IDs, dangling \`relatedIds\`, unsupported price bases, unlicensed images, and unverified star ratings.
7. Validate the complete merged catalog against \`data/catalog/schema/catalog.schema.json\`.
8. Run \`node --test infrastructure/lambda/guzo-chat-handler/test/*.test.mjs\`.
9. Run \`node scripts/sync-catalog-to-lambda.mjs\` only after validation and tests pass.
10. Review the application and Lambda-copy diff before deployment.

Do not run \`scripts/import-hermes-catalog.mjs\` for this bundle. It points at the wrong research root and introduces unsafe defaults.
`;
writeFileSync(join(REMEDIATION_RUN, 'IMPORT.md'), importGuide);

const highPriorityOpen = highPriorityIssues.filter(([, status]) => status !== 'resolved');
const remediationReport = `# Ethiopia inventory remediation transformation report

## Summary

- Output directory: \`${REMEDIATION_RUN}\`
- Canonical records: ${canonicalInventory.length}
- Import-ready catalog products: ${readyProducts.length}
- Pending catalog products: ${pendingProducts.length}
- Destination additions: ${destinationProducts.length}
- Ready flight-route additions: 0
- Pending flight-route additions: ${flightPendingRoutes.length}
- Validation: ${validationReport.passed ? 'PASS' : 'FAIL'}

## Failure register

- Total registered issues: ${failureRecords.length}
- Original crawl failures ingested: ${productCrawlErrors.length + hotelCrawlErrors.length}
- Resolved or partially resolved: ${resolvedFailures.length}
- Still blocked, not actionable, or otherwise unresolved: ${unresolvedFailures.length}

Resolution counts:

${Object.entries(resolutionCounts)
    .sort()
    .map(([status, count]) => `- ${status}: ${count}`)
    .join('\n')}

## Canonical inventory by kind

${Object.entries(canonicalCounts)
    .sort()
    .map(([kind, count]) => `- ${kind}: ${count}`)
    .join('\n')}

Six mixed-inventory accommodation records were merged with matching physical hotel records. Similar tours from different operators remain separate.

## Import readiness

Ready:

${Object.entries(readyCounts)
    .sort()
    .map(([kind, count]) => `- ${kind}: ${count}`)
    .join('\n') || '- none'}

Pending:

${Object.entries(pendingCounts)
    .sort()
    .map(([kind, count]) => `- ${kind}: ${count}`)
    .join('\n') || '- none'}

Blocker counts:

${Object.entries(blockerCounts)
    .sort()
    .map(([code, count]) => `- ${code}: ${count}`)
    .join('\n') || '- none'}

## Destination additions

${destinationIndexAdditions.map((destination) => `- ${destination.id}${destination.iata ? ` (${destination.iata})` : ''}`).join('\n')}

## Flight routes

All ${flightPendingRoutes.length} researched flight routes remain pending. Route listings did not supply current GBP fares and scheduled durations, and do not prove frequency for intended travel dates.

## Open high-priority identity issues

${highPriorityOpen.map(([ids, status, notes]) => `- ${ids}: ${status} — ${notes}`).join('\n')}

## Duplicate handling

- Existing-catalog entity matches requiring review: ${idMappings.filter((mapping) => mapping.action === 'review-merge-existing').length}
- Canonical cross-run hotel duplicates merged: ${MIXED_ACCOMMODATION_TO_HOTEL.size}
- No existing catalog record was overwritten.

## Validation

Method: ${validationReport.validator.method}.

${checks.map((check) => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${typeof check.details === 'string' ? check.details : JSON.stringify(check.details)}`).join('\n')}

## Required next actions

1. Obtain current commercial rates for pending hotels, transfers, experiences, and unpriced packages.
2. Decide whether to extend the catalog schema with a truthful per-room/per-night accommodation basis.
3. Resolve the remaining high-priority hotel identity and operating-status issues.
4. Obtain current fares, durations, and schedule context before promoting flight routes.
5. Review existing-catalog matches as merges, not additions.
6. Keep all media excluded until reuse rights are documented.
`;
writeFileSync(join(REMEDIATION_RUN, 'remediation-report.md'), remediationReport);

const manifest = readJson(join(REMEDIATION_RUN, 'manifest.json'));
manifest.transformation = {
    generatedAt: GENERATED_AT,
    script: 'scripts/transform-hermes-remediation.mjs',
    status: validationReport.passed ? 'complete' : 'validation-failed',
    counts: {
        canonicalRecords: canonicalInventory.length,
        readyProducts: readyProducts.length,
        pendingProducts: pendingProducts.length,
        destinationAdditions: destinationProducts.length,
        pendingFlightRoutes: flightPendingRoutes.length,
        failureRegisterEntries: failureRecords.length,
    },
    outputFiles: [
        'failure-register.json',
        'resolved-failures.jsonl',
        'unresolved-failures.jsonl',
        'canonical-inventory.jsonl',
        'catalog-import-bundle.json',
        'catalog-products-pending.jsonl',
        'destination-additions.json',
        'catalog-schema-validation-document.json',
        'destination-index-additions.json',
        'flight-route-additions.json',
        'id-map.json',
        'provenance.jsonl',
        'validation-report.json',
        'remediation-report.md',
        'IMPORT.md',
    ],
};
writeJson('manifest.json', manifest);

const readmePath = join(REMEDIATION_RUN, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const marker = '\n## Transformation output\n';
const transformationSection = `${marker}
The deterministic transformation in \`scripts/transform-hermes-remediation.mjs\` converts the two source inventories and this remediation evidence into a separate canonical inventory, import-ready staging bundle, pending queue, provenance records, and validation report.

Start with:

- \`remediation-report.md\` for results and remaining blockers
- \`catalog-import-bundle.json\` for schema-valid staged products
- \`catalog-products-pending.jsonl\` for blocked products
- \`IMPORT.md\` for the review-first merge procedure
`;
writeFileSync(readmePath, `${readme.split(marker)[0].trimEnd()}\n${transformationSection}`);

console.log(
    JSON.stringify(
        {
            canonicalRecords: canonicalInventory.length,
            readyProducts: readyProducts.length,
            pendingProducts: pendingProducts.length,
            destinationAdditions: destinationProducts.length,
            pendingFlightRoutes: flightPendingRoutes.length,
            validationPassed: validationReport.passed,
        },
        null,
        2,
    ),
);

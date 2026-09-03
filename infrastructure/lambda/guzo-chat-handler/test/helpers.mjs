import assert from 'node:assert/strict';
import { createEmptyIntent, mergeIntent } from '../lib/intent.js';

export async function loadNamed(rel, name) {
    const mod = await import(new URL(rel, import.meta.url));
    assert.notEqual(mod[name], undefined, `${rel} does not export ${name}`);
    return mod[name];
}

export function completePackageIntent(overrides = {}) {
    return mergeIntent(createEmptyIntent('packages'), {
        origin: { name: 'London', code: 'LHR' },
        destination: { name: 'Lalibela', catalogId: 'lalibela' },
        dates: { start: '2026-10-10', end: '2026-10-16' },
        travelers: { adults: 2, children: 0 },
        cabin: 'Economy',
        durationDays: 7,
        pace: 'relaxed',
        tier: 'comfort',
        interests: ['history'],
        preferences: 'no early starts',
        packageId: 'pkg-northern-historic-7d',
        itineraryId: 'itin-existing',
        stayPlan: [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'gondar', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ],
        ...overrides,
    }, 'packages');
}

export const NORTHERN_ITINERARY = {
    id: 'itin-existing',
    packageId: 'pkg-northern-historic-7d',
    duration: { days: 8 },
    days: [
        { destinationId: 'addis-ababa' },
        { destinationId: 'addis-ababa' },
        { destinationId: 'bahir-dar' },
        { destinationId: 'bahir-dar' },
        { destinationId: 'gondar' },
        { destinationId: 'gondar' },
        { destinationId: 'lalibela' },
        { destinationId: 'lalibela' },
    ],
};

export function quoteArgsForOrigin(originIata) {
    return {
        packageId: 'pkg-northern-historic-7d',
        startDate: '2026-10-10',
        adults: 2,
        children: 0,
        originIata,
    };
}

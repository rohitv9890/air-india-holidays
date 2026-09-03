import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { completePackageIntent, loadNamed, NORTHERN_ITINERARY } from './helpers.mjs';

describe('model tool-result guard', () => {
    it('strips internal fields instead of failing the chat turn', async () => {
        const { prepareToolResultForModel } = await import('../lib/chat.js');
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            const projected = prepareToolResultForModel({
                ok: true,
                product: {
                    id: 'pkg-example',
                    name: 'Example package',
                    basePrice: { amount: 1000, currency: 'GBP' },
                    easygds: { code: 'internal-code' },
                },
            });
            assert.deepEqual(projected, {
                ok: true,
                product: {
                    id: 'pkg-example',
                    name: 'Example package',
                },
            });
        } finally {
            console.warn = originalWarn;
        }
    });

    it('always returns a JSON-serializable object for a leaky payload', async () => {
        const { prepareToolResultForModel } = await import('../lib/chat.js');
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            let projected;
            assert.doesNotThrow(() => {
                projected = prepareToolResultForModel({
                    ok: true,
                    nested: {
                        basePrice: { amount: 1000, currency: 'GBP' },
                        easygds: { code: 'internal-code' },
                        visible: 'safe',
                    },
                });
            });
            assert.equal(typeof projected, 'object');
            assert.doesNotThrow(() => JSON.stringify(projected));
            assert.deepEqual(projected, {
                ok: true,
                nested: { visible: 'safe' },
            });
        } finally {
            console.warn = originalWarn;
        }
    });
});

describe('recommendation timing', () => {
    it('withholds package cards until required trip details are complete', async () => {
        const { shouldEmitRecommendations } = await import('../lib/chat.js');
        const recommendations = [{ id: 'pkg-example' }];

        assert.equal(shouldEmitRecommendations({
            activeTab: 'packages',
            intent: { durationDays: 10, travelers: { adults: 2 } },
            recommendations,
        }), false);
        assert.equal(shouldEmitRecommendations({
            activeTab: 'packages',
            intent: completePackageIntent(),
            recommendations,
        }), true);
    });
});

describe('price questions are not alterations', () => {
    it('does not expose a regex fast path that can mutate intent from chat text', async () => {
        const chat = await import('../lib/chat.js');
        assert.equal(typeof chat.deriveAlterationUpdate, 'undefined');
        assert.equal(typeof chat.orchestrateExistingItineraryAlteration, 'undefined');
    });

    it('does not treat an empty operation list as a successful change', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const result = applyItineraryChanges(completePackageIntent(), NORTHERN_ITINERARY, []);
        assert.equal(result.ok, false);
        assert.equal(result.changed, false);
    });
});

describe('atomic itinerary operations', () => {
    it('applies both Simien and Addis stop changes or applies none', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const intent = completePackageIntent({
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'bahir-dar', days: 2 },
                { destinationId: 'gondar', days: 2 },
                { destinationId: 'lalibela', days: 2 },
            ],
            durationDays: 8,
        });
        const result = applyItineraryChanges(intent, NORTHERN_ITINERARY, [
            { type: 'add_stop', destinationId: 'simien', days: 2 },
            { type: 'set_stop_days', destinationId: 'addis-ababa', days: 1 },
        ]);
        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        const addis = result.intent.stayPlan.find((stop) => stop.destinationId === 'addis-ababa');
        const simien = result.intent.stayPlan.find((stop) => stop.destinationId === 'simien');
        assert.equal(addis.days, 1);
        assert.equal(simien.days, 2);
        assert.equal(result.intent.preferences, intent.preferences);
    });

    it('commits no changes when any operation fails', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const intent = completePackageIntent();
        const result = applyItineraryChanges(intent, NORTHERN_ITINERARY, [
            { type: 'add_stop', destinationId: 'simien', days: 2 },
            { type: 'remove_stop', destinationId: 'atlantis' },
        ]);
        assert.equal(result.ok, false);
        assert.equal(result.changed, false);
        assert.equal(result.intent, undefined);
        assert.deepEqual(intent.stayPlan, completePackageIntent().stayPlan);
    });

    it('rejects an empty operation list', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const result = applyItineraryChanges(completePackageIntent(), NORTHERN_ITINERARY, []);
        assert.equal(result.ok, false);
        assert.equal(result.changed, false);
    });
});

describe('canonical stayPlan mutations', () => {
    it('changes stayPlan when swapping Gondar for Axum', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const intent = completePackageIntent();
        const result = applyItineraryChanges(intent, NORTHERN_ITINERARY, [
            { type: 'replace_stop', from: 'gondar', to: 'axum' },
        ]);
        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(result.intent.stayPlan.some((stop) => stop.destinationId === 'gondar'), false);
        const axum = result.intent.stayPlan.find((stop) => stop.destinationId === 'axum');
        assert.equal(axum.days, 2);
        assert.equal(result.intent.preferences, 'no early starts');
        assert.equal(result.intent.cabin, 'Economy');
        assert.equal(result.intent.durationDays, 7);
    });

    it('preserves every field not named by a successful operation', async () => {
        const applyItineraryChanges = await loadNamed('../lib/itinerary-changes.js', 'applyItineraryChanges');
        const intent = completePackageIntent();
        const result = applyItineraryChanges(intent, NORTHERN_ITINERARY, [
            { type: 'set_cabin', cabin: 'Business' },
        ]);
        assert.equal(result.ok, true);
        assert.equal(result.intent.cabin, 'Business');
        assert.equal(result.intent.pace, 'relaxed');
        assert.equal(result.intent.tier, 'comfort');
        assert.equal(result.intent.preferences, 'no early starts');
        assert.deepEqual(result.intent.stayPlan, intent.stayPlan);
        assert.deepEqual(result.intent.dates, intent.dates);
        assert.equal(result.intent.origin.code, 'LHR');
    });
});

describe('failed compose rollback', () => {
    it('leaves the previous itinerary id and intent unchanged when compose fails', async () => {
        const original = completePackageIntent();
        const { applyChangesThenCompose } = await import('../lib/itinerary-changes.js');
        const result = await applyChangesThenCompose({
            intent: original,
            itinerary: { id: 'itin-existing', packageId: 'pkg-northern-historic-7d' },
            operations: [{ type: 'set_duration', durationDays: 6 }],
            executeTool: async () => ({ ok: false, error: 'availability failed' }),
        });

        assert.equal(result.ok, false);
        assert.equal(result.intent.itineraryId, 'itin-existing');
        assert.equal(result.intent.durationDays, original.durationDays);
        assert.deepEqual(result.intent.dates, original.dates);
    });
});

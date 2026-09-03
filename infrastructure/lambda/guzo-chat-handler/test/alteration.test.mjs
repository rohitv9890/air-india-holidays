import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyItineraryChanges } from '../lib/itinerary-changes.js';
import { completePackageIntent, NORTHERN_ITINERARY } from './helpers.mjs';

describe('applyItineraryChanges destination day deltas', () => {
    it('extends duration when adding days in a destination', () => {
        const result = applyItineraryChanges(
            completePackageIntent({ durationDays: 8, dates: { start: '2026-10-01' }, stayPlan: null }),
            NORTHERN_ITINERARY,
            [{ type: 'set_stop_days', destinationId: 'lalibela', days: 5 }],
        );

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        const lalibela = result.intent.stayPlan.find((stop) => stop.destinationId === 'lalibela');
        assert.equal(lalibela.days, 5);
        assert.equal(result.intent.durationDays, 11);
        assert.equal(result.intent.dates.end, '2026-10-11');
    });

    it('appends a new destination when it is not already on the plan', () => {
        const northernOnly = {
            duration: { days: 6 },
            days: [
                { destinationId: 'addis-ababa' },
                { destinationId: 'addis-ababa' },
                { destinationId: 'bahir-dar' },
                { destinationId: 'bahir-dar' },
                { destinationId: 'gondar' },
                { destinationId: 'gondar' },
            ],
        };

        const result = applyItineraryChanges(
            completePackageIntent({ durationDays: 6, stayPlan: null }),
            northernOnly,
            [{ type: 'add_stop', destinationId: 'lalibela', days: 3 }],
        );

        assert.equal(result.intent.durationDays, 9);
        assert.deepEqual(result.intent.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'bahir-dar', days: 2 },
            { destinationId: 'gondar', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);
    });

    it('shortens a destination stay when removing days', () => {
        const result = applyItineraryChanges(
            completePackageIntent({ durationDays: 8, stayPlan: null }),
            NORTHERN_ITINERARY,
            [{ type: 'set_stop_days', destinationId: 'gondar', days: 1 }],
        );

        assert.equal(result.intent.durationDays, 7);
        const gondar = result.intent.stayPlan.find((stop) => stop.destinationId === 'gondar');
        assert.equal(gondar.days, 1);
    });

});

describe('applyItineraryChanges validation', () => {
    it('normalizes changed dates before storing them', () => {
        const result = applyItineraryChanges(
            completePackageIntent(),
            NORTHERN_ITINERARY,
            [{ type: 'set_dates', start: '15 October 2026', end: '21 October 2026' }],
        );

        assert.equal(result.ok, true);
        assert.deepEqual(result.intent.dates, {
            start: '2026-10-15',
            end: '2026-10-21',
        });
    });

    it('rejects malformed and impossible dates', () => {
        for (const start of ['not-a-date', '2026-02-31', '31 February 2027']) {
            const result = applyItineraryChanges(
                completePackageIntent(),
                NORTHERN_ITINERARY,
                [{ type: 'set_dates', start }],
            );

            assert.equal(result.ok, false);
            assert.match(result.error, /valid travel dates/);
        }
    });

    it('rejects a date range whose end precedes its start', () => {
        const result = applyItineraryChanges(
            completePackageIntent(),
            NORTHERN_ITINERARY,
            [{ type: 'set_dates', start: '2026-10-20', end: '2026-10-19' }],
        );

        assert.equal(result.ok, false);
        assert.match(result.error, /end to be on or after start/);
    });

    it('rejects replacing a stop with one already on the plan', () => {
        const result = applyItineraryChanges(
            completePackageIntent(),
            NORTHERN_ITINERARY,
            [{ type: 'replace_stop', from: 'gondar', to: 'lalibela' }],
        );

        assert.equal(result.ok, false);
        assert.match(result.error, /Stop already on the plan: lalibela/);
    });

    it('rejects removing the final stop', () => {
        const result = applyItineraryChanges(
            completePackageIntent({
                durationDays: 3,
                stayPlan: [{ destinationId: 'lalibela', days: 3 }],
            }),
            NORTHERN_ITINERARY,
            [{ type: 'remove_stop', destinationId: 'lalibela' }],
        );

        assert.equal(result.ok, false);
        assert.match(result.error, /Cannot remove the final stop/);
    });

    it('rejects removing a preference that is not present', () => {
        const result = applyItineraryChanges(
            completePackageIntent({ preferences: 'no early starts; vegetarian meals' }),
            NORTHERN_ITINERARY,
            [{ type: 'remove_preference', note: 'window seats' }],
        );

        assert.equal(result.ok, false);
        assert.match(result.error, /Preference not found: window seats/);
    });

    it('removes an exact semicolon-delimited preference', () => {
        const result = applyItineraryChanges(
            completePackageIntent({ preferences: 'no early starts; vegetarian meals' }),
            NORTHERN_ITINERARY,
            [{ type: 'remove_preference', note: 'vegetarian meals' }],
        );

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(result.intent.preferences, 'no early starts');
    });
});

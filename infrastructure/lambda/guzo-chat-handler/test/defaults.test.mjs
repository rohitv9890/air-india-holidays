import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyIntent } from '../lib/intent.js';
import { buildItinerary } from '../lib/itinerary-builder.js';
import { loadNamed } from './helpers.mjs';

describe('unknown consequential values stay unknown', () => {
    it('does not claim that two adults were supplied on a new package intent', () => {
        const intent = createEmptyIntent('packages');
        assert.equal(intent.travelers.adults, null);
        assert.equal(intent.dates.start, null);
        assert.equal(intent.dates.end, null);
    });

    it('does not invent travel dates on a new intent', () => {
        const intent = createEmptyIntent('packages');
        assert.equal(intent.dates.start, null);
        assert.equal(intent.dates.end, null);
        assert.equal(intent.durationDays, null);
    });

    it('compose rejects missing required facts instead of filling LHR or a start date', () => {
        assert.throws(
            () => buildItinerary({ destination: 'lalibela', adults: 2 }),
            /required|missing|origin|startDate/i,
        );
        assert.throws(
            () => buildItinerary({ originIata: 'LHR', adults: 2 }),
            /required|missing|startDate/i,
        );
    });
});

describe('readiness by action and tab', () => {
    it('asks for traveller count before treating a new package search as ready', async () => {
        const getMissingFieldsForAction = await loadNamed('../lib/intent.js', 'getMissingFieldsForAction');
        const intent = createEmptyIntent('packages');
        const missing = getMissingFieldsForAction(intent, { tab: 'packages', action: 'search' });
        assert.ok(missing.includes('travelers.adults'));
        assert.ok(missing.includes('origin') || missing.includes('origin.code'));
    });

    it('requires origin, dates, and adults before package compose', async () => {
        const getMissingFieldsForAction = await loadNamed('../lib/intent.js', 'getMissingFieldsForAction');
        const intent = createEmptyIntent('packages');
        const missing = getMissingFieldsForAction(intent, { tab: 'packages', action: 'compose' });
        assert.ok(missing.includes('origin') || missing.includes('origin.code'));
        assert.ok(missing.includes('dates.start'));
        assert.ok(missing.includes('travelers.adults'));
    });

    it('returns optional operational defaults as assumptions, not user facts', async () => {
        const getOperationalAssumptions = await loadNamed('../lib/intent.js', 'getOperationalAssumptions');
        const intent = createEmptyIntent('packages');
        const assumptions = getOperationalAssumptions(intent, { tab: 'packages' });
        assert.ok(Array.isArray(assumptions));
        const cabin = assumptions.find((item) => item.field === 'cabin');
        assert.equal(cabin.value, 'Economy');
        assert.equal(intent.cabin, null);
    });
});

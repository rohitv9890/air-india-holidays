import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    INTERNATIONAL_FLIGHTS_INCLUDED,
    isInternationalFlightsExclusion,
    withInternationalFlightsIncluded,
} from '../guzo/itinerary-inclusions.js';
import { buildGoldenTriangleItinerary } from '../guzo/guzo-catalog-client.js';

const TRIP = {
    origin: { name: 'London', code: 'LHR' },
    dates: { start: '2026-10-10' },
    travelers: { adults: 2 },
};

describe('itinerary international-flight inclusions', () => {
    it('moves standalone and combined flight exclusions onto the included list', () => {
        const moved = withInternationalFlightsIncluded(
            ['Domestic flights'],
            ['International flights', 'Travel insurance'],
        );
        assert.deepEqual(moved.inclusions, [INTERNATIONAL_FLIGHTS_INCLUDED, 'Domestic flights']);
        assert.deepEqual(moved.exclusions, ['Travel insurance']);

        const split = withInternationalFlightsIncluded(
            ['Lodges'],
            ['International flights and visa fees', 'Tips'],
        );
        assert.deepEqual(split.inclusions, [INTERNATIONAL_FLIGHTS_INCLUDED, 'Lodges']);
        assert.deepEqual(split.exclusions, ['Visa fees', 'Tips']);

        const priced = withInternationalFlightsIncluded(
            [],
            ['International flights (~£1000)', 'Tourist visa (£48)'],
        );
        assert.deepEqual(priced.inclusions, [INTERNATIONAL_FLIGHTS_INCLUDED]);
        assert.deepEqual(priced.exclusions, ['Tourist visa (£48)']);
        assert.equal(isInternationalFlightsExclusion('International flights (the examples shown are for planning)'), true);
    });

    it('does not duplicate an existing international-flight inclusion', () => {
        const result = withInternationalFlightsIncluded(
            ['International flights on Air India', 'Park fees'],
            ['International flights'],
        );
        assert.deepEqual(result.inclusions, ['International flights on Air India', 'Park fees']);
        assert.deepEqual(result.exclusions, []);
    });

    it('treats the Golden Triangle fixture as including international flights', () => {
        const itinerary = buildGoldenTriangleItinerary(TRIP);
        assert.ok(itinerary.inclusions.includes(INTERNATIONAL_FLIGHTS_INCLUDED));
        assert.equal(itinerary.exclusions.some(isInternationalFlightsExclusion), false);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getById, suggestEnhancements } from '../lib/catalog.js';
import { quoteItinerary } from '../lib/pricing.js';
import { buildItinerary } from '../lib/itinerary-builder.js';
import {
    assertNoInternalFields,
    projectCatalogResultsForModel,
    projectEnhancementsForModel,
    projectItineraryForModel,
    projectQuoteForModel,
} from '../lib/projections.js';

describe('model-safe projections', () => {
    it('converts raw GBP catalog prices into the display currency without leaking internals', () => {
        const projected = projectCatalogResultsForModel(
            [getById('pkg-northern-historic-7d')],
            { currency: 'EUR' },
        );
        assert.equal(projected[0].id, 'pkg-northern-historic-7d');
        assertNoInternalFields(projected);
        assert.equal(projected[0].easygds, undefined);
        assert.equal(projected[0].basePrice, undefined);
        assert.ok(Number.isFinite(projected[0].priceFrom));
        assert.equal(projected[0].currency, 'EUR');
        assert.equal(typeof projected[0].formattedPrice, 'string');
        assert.match(projected[0].formattedPrice, /€/);
        assert.equal(projected[0].priceBasis, 'per-person');
    });

    it('keeps explicitly computed display prices with their basis', () => {
        const projected = projectCatalogResultsForModel([{
            id: 'stay-example',
            name: 'Example stay',
            type: 'accommodation',
            priceFrom: 234,
            currency: 'EUR',
            formattedPrice: '€234',
            basePrice: {
                amount: 200,
                currency: 'GBP',
                basis: 'per-night',
            },
        }], { currency: 'ZAR' });
        assert.deepEqual(projected[0], {
            id: 'stay-example',
            name: 'Example stay',
            type: 'accommodation',
            durationDays: null,
            tier: null,
            destinations: [],
            summary: null,
            priceFrom: 234,
            currency: 'EUR',
            formattedPrice: '€234',
            priceBasis: 'per-night',
        });
        assertNoInternalFields(projected);
    });

    it('does not reinterpret a non-GBP source price as the display currency', () => {
        const item = {
            id: 'eur-only',
            name: 'EUR-priced product',
            type: 'experience',
            basePrice: {
                amount: 125,
                currency: 'EUR',
                basis: 'per-person',
            },
            easygds: { productCode: 'internal' },
        };
        const [projected] = projectCatalogResultsForModel([item], { currency: 'ZAR' });

        assert.equal(projected.priceFrom, null);
        assert.equal(projected.currency, null);
        assert.equal(projected.formattedPrice, null);
        assert.equal(projected.priceBasis, null);
        assertNoInternalFields(projected);
    });

    it('passes through a source price already in the display currency', () => {
        const [projected] = projectCatalogResultsForModel([{
            id: 'eur-only',
            name: 'EUR-priced product',
            type: 'experience',
            basePrice: {
                amount: 125,
                currency: 'EUR',
                basis: 'per-person',
            },
        }], { currency: 'EUR' });

        assert.equal(projected.priceFrom, 125);
        assert.equal(projected.currency, 'EUR');
        assert.match(projected.formattedPrice, /€125/);
        assert.equal(projected.priceBasis, 'per-person');
        assertNoInternalFields(projected);
    });

    it('omits FX tables from quotes', () => {
        const quote = quoteItinerary({
            packageId: 'pkg-northern-historic-7d',
            startDate: '2026-10-10',
            adults: 2,
            currency: 'EUR',
        });
        const projected = projectQuoteForModel(quote);
        assert.equal(projected.currency, 'EUR');
        assert.equal(typeof projected.formattedTotal, 'string');
        assertNoInternalFields(projected);
        assert.equal(projected.breakdown, undefined);
        assert.equal(projected.fx, undefined);
        assert.equal(projected.totals, undefined);
    });

    it('does not format an unknown quote total as zero', () => {
        const projected = projectQuoteForModel({
            currency: 'GBP',
            totalAmount: null,
        });
        assert.equal(projected.totalAmount, null);
        assert.equal(projected.formattedTotal, null);
    });

    it('keeps only traveller-facing itinerary fields', () => {
        const itinerary = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-10-10',
            adults: 2,
        });
        const projected = projectItineraryForModel(itinerary, [{ code: 'min-days', message: 'Simien needs 2 days' }]);
        assert.equal(projected.id, itinerary.id);
        assert.equal(projected.title, itinerary.title);
        assert.ok(projected.stops.length);
        assert.equal(projected.warnings[0].code, 'min-days');
        assertNoInternalFields(projected);
        assert.equal(projected.easygds, undefined);
        assert.equal(projected.quote?.totals, undefined);
        assert.equal(projected.availability?.seed, undefined);
    });

    it('projects enhancement cards without supplier payloads', () => {
        const items = suggestEnhancements({
            packageId: 'pkg-northern-historic-7d',
            destinations: ['lalibela'],
            currency: 'GBP',
        });
        const projected = projectEnhancementsForModel(items);
        assert.ok(projected.length > 0);
        assertNoInternalFields(projected);
        assert.equal(projected[0].score, undefined);
    });
});

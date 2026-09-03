import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDemoItinerary,
    buildGoldenTriangleItinerary,
    productToCard,
    TripDurationValidationError,
    TripFactsValidationError,
} from '../guzo/guzo-catalog-client.js';

describe('Guzo catalog client pricing and itinerary contracts', () => {
    it('converts USD prices once and preserves prices already in display currency', () => {
        const usdProduct = {
            id: 'pkg-usd',
            type: 'package',
            name: 'USD package',
            basePrice: { amount: 100, currency: 'USD' },
        };
        const eurProduct = {
            id: 'pkg-eur',
            type: 'package',
            name: 'EUR package',
            basePrice: { amount: 100, currency: 'EUR' },
        };

        assert.equal(productToCard(usdProduct, 'GBP').priceFrom, 79);
        assert.equal(productToCard(eurProduct, 'EUR').priceFrom, 100);
        assert.equal(productToCard(eurProduct, 'USD').priceFrom, null);
        assert.equal(productToCard(eurProduct, 'USD').formattedPrice, null);
    });

    it('strips SKU codes from catalog card titles', () => {
        const card = productToCard({
            id: 'pkg-classic-india-highlights-10d-set',
            type: 'package',
            name: "Short Classic Tour to India's Highlights (GR03)",
            basePrice: { amount: 100, currency: 'USD' },
        });
        assert.equal(card.title, "Short Classic Tour to India's Highlights");
        assert.doesNotMatch(card.title, /GR03/i);
    });

    it('does not convert a display-priced card again when building an itinerary', () => {
        // LHR maps to GBP in display-currency.js's origin table, so a product already
        // priced in GBP should pass straight through without a second conversion.
        const itinerary = buildGoldenTriangleItinerary({
            origin: { name: 'London', code: 'LHR' },
            dates: { start: '2026-10-12' },
            travelers: { adults: 2 },
        }, {
            id: 'pkg-gbp',
            title: 'GBP package',
            priceFrom: 117,
            currency: 'GBP',
        });

        assert.deepEqual(itinerary.price, {
            amount: 117,
            currency: 'GBP',
            basis: 'per-person',
        });
        assert.equal(itinerary.maharajaPointsEstimate, null);
    });

    it('keeps chat itinerary facts strict while providing an explicit demo fixture', async () => {
        assert.throws(
            () => buildGoldenTriangleItinerary(),
            error => error instanceof TripFactsValidationError && error.fact === 'origin',
        );

        const demo = await buildDemoItinerary();
        assert.deepEqual(demo.origin, { name: 'London', code: 'LHR' });
        assert.equal(demo.dates.start, '2026-10-12');
        assert.equal(demo.travelers.adults, 2);
    });

    it('refuses a three-day KUL itinerary in the offline planner too', () => {
        assert.throws(
            () => buildGoldenTriangleItinerary({
                origin: { name: 'Kuala Lumpur', code: 'KUL' },
                dates: { start: '2027-02-01', end: '2027-02-03' },
                travelers: { adults: 2 },
                durationDays: 3,
            }),
            error => error instanceof TripDurationValidationError
                && error.code === 'minimum-duration'
                && error.minimumDurationDays === 4,
        );
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getById, suggestEnhancements, toRecommendation } from '../lib/catalog.js';
import { runTool } from '../lib/tools.js';
import { createEmptyIntent, mergeIntent } from '../lib/intent.js';
import { loadNamed, quoteArgsForOrigin } from './helpers.mjs';

const ORIGIN_CASES = [
    { origin: 'LHR', currency: 'GBP' },
    { origin: 'FRA', currency: 'EUR' },
    { origin: 'JNB', currency: 'ZAR' },
    { origin: 'KUL', currency: 'MYR' },
    { origin: 'SIN', currency: 'GBP', fallback: true },
];

describe('display currency resolver', () => {
    it('maps demo origins and uses an explicit site fallback', async () => {
        const displayCurrencyForOrigin = await loadNamed('../lib/pricing.js', 'displayCurrencyForOrigin');
        const DEFAULT_DISPLAY_CURRENCY = await loadNamed('../lib/pricing.js', 'DEFAULT_DISPLAY_CURRENCY');
        assert.equal(displayCurrencyForOrigin('LHR'), 'GBP');
        assert.equal(displayCurrencyForOrigin('FRA'), 'EUR');
        assert.equal(displayCurrencyForOrigin('JNB'), 'ZAR');
        assert.equal(displayCurrencyForOrigin('KUL'), 'MYR');
        assert.equal(displayCurrencyForOrigin('SIN'), DEFAULT_DISPLAY_CURRENCY);
        assert.equal(DEFAULT_DISPLAY_CURRENCY, 'GBP');
    });

    it('keeps the browser resolver aligned with the server map', async () => {
        const server = await import('../lib/display-currency.js');
        const client = await import('../../../../guzo/display-currency.js');
        assert.deepEqual({ ...server.ORIGIN_DISPLAY_CURRENCY }, { ...client.ORIGIN_DISPLAY_CURRENCY });
        assert.equal(client.DEFAULT_DISPLAY_CURRENCY, 'GBP');
        assert.equal(client.displayCurrencyForOrigin('FRA'), 'EUR');
        assert.equal(client.EUR_PER_GBP, server.EUR_PER_GBP);
        assert.equal(client.ZAR_PER_GBP, server.ZAR_PER_GBP);

        for (const value of [undefined, 'not-a-number', 100]) {
            assert.equal(client.gbpToEur(value), server.gbpToEur(value));
            assert.equal(client.gbpToZar(value), server.gbpToZar(value));
            assert.deepEqual(client.displayQuoteFromGbp(value, 'EUR'), server.displayQuoteFromGbp(value, 'EUR'));
        }
    });

    it('keeps converter guards but marks unknown quotes and formatted prices as unknown', async () => {
        const {
            gbpToEur,
            gbpToZar,
            displayQuoteFromGbp,
            formatDisplayPrice,
        } = await import('../lib/display-currency.js');

        for (const value of [null, undefined, 'not-a-number', NaN, Infinity]) {
            assert.equal(gbpToEur(value), 0);
            assert.equal(gbpToZar(value), 0);
            assert.deepEqual(displayQuoteFromGbp(value, 'EUR'), {
                currency: 'EUR',
                totalAmount: null,
                formattedTotal: null,
                totals: {
                    GBP: null,
                    EUR: null,
                    ZAR: null,
                    MYR: null,
                },
            });
            assert.equal(formatDisplayPrice(value, 'EUR'), null);
        }
    });

    it('does not treat a non-GBP catalog price as GBP', () => {
        const product = {
            id: 'non-gbp-product',
            type: 'experience',
            name: 'Non-GBP product',
            basePrice: { amount: 100, currency: 'EUR' },
        };
        const convertedCard = toRecommendation(product, { currency: 'ZAR' });
        const passthroughCard = toRecommendation(product, { currency: 'EUR' });

        assert.equal(convertedCard.priceFrom, null);
        assert.equal(convertedCard.formattedPrice, null);
        assert.equal(passthroughCard.priceFrom, 100);
        assert.equal(passthroughCard.formattedPrice, '€100');
    });
});

describe('customer-facing currency consistency', () => {
    for (const { origin, currency } of ORIGIN_CASES) {
        it(`uses ${currency} for ${origin} across quote, compose, cards, and fallbacks`, async () => {
            const displayCurrencyForOrigin = await loadNamed('../lib/pricing.js', 'displayCurrencyForOrigin');
            const formatDisplayPrice = await loadNamed('../lib/pricing.js', 'formatDisplayPrice');
            assert.equal(displayCurrencyForOrigin(origin), currency);

            const intent = mergeIntent(createEmptyIntent('packages'), {
                origin: { name: origin, code: origin },
                dates: { start: '2026-10-10', end: '2026-10-16' },
                travelers: { adults: 2 },
                destination: { name: 'Lalibela', catalogId: 'lalibela' },
            }, 'packages');

            const quoteResult = await runTool('quote_trip', {
                ...quoteArgsForOrigin(origin),
            }, { intent, tab: 'packages' });
            assert.equal(quoteResult.ok, true);
            assert.equal(quoteResult.quote.currency, currency);
            assert.equal(typeof quoteResult.quote.formattedTotal, 'string');
            assert.match(quoteResult.quote.formattedTotal, /[£€R]/);
            assert.equal(quoteResult.quote.totalAmount > 0, true);
            assert.equal(quoteResult.quote.totals, undefined);

            const composeResult = await runTool('compose_itinerary', {
                packageId: 'pkg-northern-historic-7d',
                startDate: '2026-10-10',
                originIata: origin,
                adults: 2,
            }, { intent, tab: 'packages' });
            assert.equal(composeResult.ok, true);
            assert.equal(composeResult.itinerary.displayPrice.currency, currency);
            assert.equal(typeof composeResult.itinerary.displayPrice.formattedTotal, 'string');

            const product = getById('pkg-northern-historic-7d');
            const card = toRecommendation(product, { currency });
            assert.equal(card.currency, currency);
            assert.equal(typeof card.formattedPrice, 'string');

            const enhancements = suggestEnhancements({
                packageId: 'pkg-northern-historic-7d',
                destinations: ['lalibela'],
                currency,
            });
            const priced = enhancements.filter((item) => item.price);
            assert.ok(priced.length > 0);
            assert.ok(priced.every((item) => item.price.currency === currency));

            const fallback = `from ${formatDisplayPrice(product.basePrice.amount, currency)}`;
            assert.match(fallback, /from /);
            assert.equal(fallback.includes('£') || fallback.includes('€') || fallback.includes('R'), true);
        });
    }
});

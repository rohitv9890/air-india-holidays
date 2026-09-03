import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getById, suggestEnhancements } from '../lib/catalog.js';
import { quoteItinerary } from '../lib/pricing.js';

const quoteArgs = {
    packageId: 'pkg-northern-historic-7d',
    startDate: '2026-10-10',
    adults: 2,
    children: 0,
    currency: 'GBP',
};

describe('catalog-grounded enhancements', () => {
    it('ranks typed, destination-relevant active relationships', () => {
        const items = suggestEnhancements({
            packageId: quoteArgs.packageId,
            destinations: ['lalibela'],
            limit: 4,
        });
        assert.ok(items.length > 0 && items.length <= 4);
        assert.ok(items.every((item) => item.status === 'optional'));
        assert.ok(items.every((item) => getById(item.id)?.status === 'active'));
        assert.ok(items.some((item) => item.destinations.includes('lalibela')));
        assert.ok(items.every((item) => item.reason));
    });

    it('filters draft targets and ignores unsupported relationship types', () => {
        const pkg = getById(quoteArgs.packageId);
        const original = pkg.relationships;
        pkg.relationships = [
            ...original,
            { type: 'optional-addon', productId: 'pkg-historical-highlights-11d-set' },
            { type: 'invented-type', productId: 'exp-addis-city-tour' },
        ];
        try {
            const ids = suggestEnhancements({ packageId: pkg.id, limit: 6 }).map((item) => item.id);
            assert.ok(!ids.includes('pkg-historical-highlights-11d-set'));
            assert.ok(!ids.includes('exp-addis-city-tour'));
        } finally {
            pkg.relationships = original;
        }
    });

    it('requires destination overlap and enforces the four-item bound', () => {
        const pkg = getById(quoteArgs.packageId);
        const original = pkg.relationships;
        pkg.relationships = [
            ...original,
            { type: 'optional-addon', productId: 'exp-omo-village-visit' },
        ];
        try {
            const items = suggestEnhancements({ packageId: pkg.id, limit: 99 });
            assert.ok(items.length <= 4);
            assert.ok(!items.some((item) => item.id === 'exp-omo-village-visit'));
        } finally {
            pkg.relationships = original;
        }
    });
});

describe('composite quotes', () => {
    it('returns transparent package and add-on line items', () => {
        const quote = quoteItinerary({
            ...quoteArgs,
            addOnProductIds: ['exp-lalibela-churches'],
        });
        assert.equal(quote.lineItems.length, 2);
        assert.deepEqual(quote.addOnProductIds, ['exp-lalibela-churches']);
        assert.equal(quote.lineItems[0].relationshipType, 'package');
        assert.equal(quote.lineItems[1].relationshipType, 'optional-addon');
        assert.equal(quote.totalAmount, quote.lineItems.reduce((sum, line) => sum + line.amount, 0));
    });

    it('does not charge included products or duplicate ids', () => {
        const pkg = getById(quoteArgs.packageId);
        const original = pkg.relationships;
        pkg.relationships = [
            ...original.filter((rel) => rel.productId !== 'exp-lalibela-churches'),
            { type: 'included', productId: 'exp-lalibela-churches' },
        ];
        try {
            const base = quoteItinerary(quoteArgs);
            const composite = quoteItinerary({
                ...quoteArgs,
                addOnProductIds: ['exp-lalibela-churches', 'exp-lalibela-churches'],
            });
            assert.equal(composite.totalAmount, base.totalAmount);
            assert.equal(composite.lineItems.filter((line) => line.productId === 'exp-lalibela-churches').length, 1);
            assert.equal(composite.lineItems[1].status, 'included');
        } finally {
            pkg.relationships = original;
        }
    });

    it('rejects missing, draft, unrelated, and alternative product ids', () => {
        for (const [id, pattern] of [
            ['missing-product', /unknown product/i],
            ['pkg-historical-highlights-11d-set', /not sellable/i],
            ['exp-addis-city-tour', /not compatible/i],
            ['pkg-northern-historic-8d', /alternative/i],
        ]) {
            assert.throws(
                () => quoteItinerary({ ...quoteArgs, addOnProductIds: [id] }),
                pattern,
            );
        }
    });

    it('marks an unverified upgrade delta unavailable instead of guessing', () => {
        const pkg = getById(quoteArgs.packageId);
        const target = getById('pkg-northern-historic-8d');
        const originalRelationships = pkg.relationships;
        pkg.relationships = [
            ...originalRelationships.filter((rel) => rel.productId !== target.id),
            { type: 'tier-upgrade', productId: target.id },
        ];
        try {
            const quote = quoteItinerary({ ...quoteArgs, addOnProductIds: [target.id] });
            const upgrade = quote.lineItems.find((line) => line.productId === target.id);
            assert.equal(upgrade.status, 'unavailable');
            assert.equal(upgrade.amount, null);
            assert.equal(upgrade.priceDelta, null);
        } finally {
            pkg.relationships = originalRelationships;
        }
    });
});

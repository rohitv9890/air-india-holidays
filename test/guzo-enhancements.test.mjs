import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    catalogEnhancements,
    compactQuoteSummary,
    hasItineraryCta,
    isItineraryActionChip,
    itineraryCtaMessage,
    shouldShowItineraryActionChip,
    LEGACY_READY_MADE_INTRO,
    LEGACY_READY_MADE_ALSO_INTRO,
    READY_MADE_PATH_INTRO,
    READY_MADE_CROSS_SELL_INTRO,
    TAILOR_MADE_PATH_INTRO,
    TAILOR_MADE_PATH_READY,
    resolveReadyMadeIntro,
    toggleEnhancementId,
} from '../guzo/guzo-enhancements.js';
import {
    guzoState,
    ensureItineraryCta,
    setSelectedProductId,
    setSingletonMessage,
} from '../guzo/guzo-state.js';

describe('Guzo enhancement UI helpers', () => {
    it('grounds cards in active typed relationships and filters drafts', () => {
        const catalog = {
            products: [
                {
                    id: 'pkg-1', type: 'package', status: 'active', destinations: ['agra'],
                    relationships: [
                        { type: 'optional-addon', productId: 'exp-1' },
                        { type: 'optional-addon', productId: 'draft-1' },
                        { type: 'optional-addon', productId: 'rejected-1' },
                        { type: 'optional-addon', productId: 'legacy-1' },
                        { type: 'optional-addon', productId: 'unrelated-1' },
                        { type: 'unknown', productId: 'exp-2' },
                    ],
                },
                { id: 'exp-1', type: 'experience', status: 'active', name: 'Taj Mahal sunrise visit', summary: 'Guided', destinations: ['agra'], basePrice: { amount: 20, currency: 'USD' } },
                { id: 'draft-1', type: 'experience', status: 'draft', name: 'Draft', destinations: ['agra'] },
                { id: 'rejected-1', type: 'experience', status: 'rejected', name: 'Rejected', destinations: ['agra'] },
                { id: 'legacy-1', type: 'experience', name: 'No lifecycle', destinations: ['agra'] },
                { id: 'unrelated-1', type: 'experience', status: 'active', name: 'Unrelated', destinations: ['goa'] },
                { id: 'exp-2', type: 'experience', status: 'active', name: 'Unsupported', destinations: ['agra'] },
            ],
        };
        assert.deepEqual(catalogEnhancements(catalog, 'pkg-1').map((item) => item.id), ['exp-1']);
    });

    it('deduplicates itinerary CTA state and restores CTA content', () => {
        const cta = itineraryCtaMessage('itin-1', { title: 'North', days: [{}, {}] });
        assert.equal(cta.summary.days, 2);
        assert.equal(cta.content, 'View itinerary');
        assert.equal(cta.pathIntro, TAILOR_MADE_PATH_READY);
        assert.equal(hasItineraryCta([cta], 'itin-1'), true);
        assert.equal(hasItineraryCta([cta], 'itin-2'), false);
    });

    it('uses the quote per-person amount instead of the party total', () => {
        const cta = itineraryCtaMessage('itin-1', {
            title: 'GR03',
            duration: { days: 10 },
            quote: {
                totalAmount: 4554,
                perPersonAmount: 2277,
                currency: 'EUR',
            },
        });

        assert.deepEqual(cta.summary.price, {
            amount: 2277,
            currency: 'EUR',
            basis: 'per-person',
        });
    });

    it('treats ready-made and tailor-made as two separate paths', () => {
        assert.equal(resolveReadyMadeIntro(), READY_MADE_PATH_INTRO);
        assert.equal(resolveReadyMadeIntro(LEGACY_READY_MADE_INTRO), READY_MADE_PATH_INTRO);
        assert.equal(resolveReadyMadeIntro(LEGACY_READY_MADE_ALSO_INTRO), READY_MADE_PATH_INTRO);
        assert.equal(resolveReadyMadeIntro(READY_MADE_CROSS_SELL_INTRO), READY_MADE_CROSS_SELL_INTRO);
        assert.match(READY_MADE_PATH_INTRO, /^We have some ready-made packages/);
        assert.match(READY_MADE_CROSS_SELL_INTRO, /^We also have ready-made packages/);
        assert.notEqual(READY_MADE_PATH_INTRO, TAILOR_MADE_PATH_INTRO);

        const buildCta = itineraryCtaMessage(null);
        assert.equal(buildCta.content, 'Build my itinerary');
        assert.equal(buildCta.pathIntro, TAILOR_MADE_PATH_INTRO);
        assert.match(buildCta.pathIntro, /create a tailor-made package/);
        assert.equal(buildCta.itineraryId, '');
    });

    it('adds and removes selected enhancement ids immutably', () => {
        const selected = ['exp-1'];
        assert.deepEqual(toggleEnhancementId(selected, 'exp-2'), ['exp-1', 'exp-2']);
        assert.deepEqual(toggleEnhancementId(selected, 'exp-1'), []);
        assert.deepEqual(selected, ['exp-1']);
    });

    it('normalizes transparent quote lines for display', () => {
        const summary = compactQuoteSummary({
            currency: 'GBP',
            totalAmount: 210,
            lineItems: [
                { productId: 'pkg-1', name: 'Package', status: 'priced', amount: 200, currency: 'GBP' },
                { productId: 'exp-1', name: 'Experience', status: 'priced', amount: 10, currency: 'GBP' },
            ],
        });
        assert.equal(summary.totalAmount, 210);
        assert.deepEqual(summary.lines.map((line) => line.name), ['Package', 'Experience']);
    });

    it('replaces transient output and clears add-ons when the package changes', () => {
        guzoState.messages = [];
        guzoState.selectedProductId = 'pkg-1';
        guzoState.selectedEnhancementIds = ['exp-1'];
        guzoState.compositeQuote = { totalAmount: 210 };
        setSingletonMessage('quote_summary', { role: 'assistant', quote: { totalAmount: 210 } });
        setSingletonMessage('quote_summary', { role: 'assistant', quote: { totalAmount: 220 } });
        assert.equal(guzoState.messages.filter((message) => message.type === 'quote_summary').length, 1);

        setSelectedProductId('pkg-2');
        assert.deepEqual(guzoState.selectedEnhancementIds, []);
        assert.equal(guzoState.compositeQuote, null);
        assert.equal(guzoState.messages.some((message) => message.type === 'quote_summary'), false);
    });

    it('does not pin an existing itinerary CTA after later follow-on messages', () => {
        guzoState.messages = [
            { id: 'msg_user', role: 'user', type: 'text', content: 'Build my itinerary' },
            { id: 'msg_ready', role: 'assistant', type: 'text', content: 'Your itinerary is ready.' },
        ];
        ensureItineraryCta('itin-1', { title: 'Custom 6-day India itinerary', days: [{}, {}] });
        guzoState.messages.push({
            id: 'msg_cards',
            role: 'assistant',
            type: 'product_cards',
            items: [{ id: 'pkg-1', title: 'Golden Triangle Circuit' }],
        });
        ensureItineraryCta('itin-1');

        assert.equal(guzoState.messages.filter((message) => message.type === 'itinerary_cta').length, 1);
        assert.equal(guzoState.messages.at(-1).type, 'product_cards');
        const cta = guzoState.messages.find((message) => message.type === 'itinerary_cta');
        assert.equal(cta.itineraryId, 'itin-1');
        assert.equal(cta.content, 'View itinerary');
        assert.equal(cta.pathIntro, TAILOR_MADE_PATH_READY);
        assert.equal(cta.summary.title, 'Custom 6-day India itinerary');
    });

    it('hides Build my itinerary and View itinerary chips when the thread CTA is present', () => {
        assert.equal(shouldShowItineraryActionChip([]), true);
        assert.equal(shouldShowItineraryActionChip([itineraryCtaMessage(null)]), false);
        assert.equal(shouldShowItineraryActionChip([itineraryCtaMessage('itin-1')]), false);
        assert.equal(isItineraryActionChip('Build my itinerary'), true);
        assert.equal(isItineraryActionChip('View itinerary'), true);
        assert.equal(isItineraryActionChip('Search now'), false);
    });

    it('keeps a build CTA last when the ready-made strip is shown first', () => {
        guzoState.messages = [
            { id: 'msg_cards', role: 'assistant', type: 'product_cards', intro: READY_MADE_PATH_INTRO, items: [] },
        ];
        ensureItineraryCta(null);
        assert.equal(guzoState.messages.at(-1).type, 'itinerary_cta');
        assert.equal(guzoState.messages.at(-1).content, 'Build my itinerary');
        assert.equal(guzoState.messages.at(-1).pathIntro, TAILOR_MADE_PATH_INTRO);
        assert.equal(guzoState.messages[0].type, 'product_cards');
    });
});

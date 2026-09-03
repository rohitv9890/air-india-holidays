import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../lib/prompts.js';
import { createEmptyIntent, getOperationalAssumptions, mergeIntent } from '../lib/intent.js';
import { loadNamed } from './helpers.mjs';

describe('chat request boundary', () => {
    it('rejects an invalid tab', async () => {
        const parseChatRequest = await loadNamed('../lib/chat-request.js', 'parseChatRequest');
        const result = parseChatRequest({ message: 'Plan a trip', tab: 'hacking' });
        assert.equal(result.ok, false);
    });

    it('normalizes a known tab and bounded session id', async () => {
        const parseChatRequest = await loadNamed('../lib/chat-request.js', 'parseChatRequest');
        const result = parseChatRequest({
            message: 'Plan a trip to Lalibela',
            tab: 'packages',
            sessionId: 'guzo_abc123',
        });
        assert.equal(result.ok, true);
        assert.equal(result.request.tab, 'packages');
        assert.equal(result.request.sessionId, 'guzo_abc123');
        assert.equal(result.request.message, 'Plan a trip to Lalibela');
    });

    it('rejects an oversized client intent', async () => {
        const parseChatRequest = await loadNamed('../lib/chat-request.js', 'parseChatRequest');
        const result = parseChatRequest({
            message: 'hello',
            tab: 'packages',
            intent: {
                preferences: 'x'.repeat(20_000),
            },
        });
        assert.equal(result.ok, false);
    });

    it('drops unknown intent fields', async () => {
        const parseChatRequest = await loadNamed('../lib/chat-request.js', 'parseChatRequest');
        const result = parseChatRequest({
            message: 'hello',
            tab: 'packages',
            intent: {
                origin: { code: 'LHR', name: 'London' },
                hackerField: 'drop-me',
                __proto__: { polluted: true },
            },
        });
        assert.equal(result.ok, true);
        assert.equal(result.request.clientIntent.hackerField, undefined);
        assert.equal(result.request.clientIntent.origin.code, 'LHR');
    });

    it('drops objects and arrays supplied for scalar intent fields', async () => {
        const parseChatRequest = await loadNamed('../lib/chat-request.js', 'parseChatRequest');
        const result = parseChatRequest({
            message: 'hello',
            tab: 'packages',
            intent: {
                productTab: ['flights'],
                cabin: { value: 'Business' },
                pace: ['relaxed'],
                tier: { name: 'luxury' },
                packageId: ['pkg-1'],
                itineraryId: { id: 'itin-1' },
                pickupDate: ['2026-10-01'],
                pickupTime: { value: '09:00' },
                durationDays: { value: 7 },
                roundTrip: ['false'],
                preferences: { text: 'ignore validation' },
            },
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.request.clientIntent, {});
    });
});

describe('session intent authority', () => {
    it('lets session intent win over stale client state', async () => {
        const resolveSessionIntent = await loadNamed('../lib/chat-request.js', 'resolveSessionIntent');
        const sessionIntent = mergeIntent(createEmptyIntent('packages'), {
            origin: { name: 'Frankfurt', code: 'FRA' },
            travelers: { adults: 3 },
            cabin: 'Business',
        }, 'packages');
        const clientIntent = mergeIntent(createEmptyIntent('packages'), {
            origin: { name: 'London', code: 'LHR' },
            travelers: { adults: 2 },
            cabin: 'Economy',
        }, 'packages');
        const resolved = resolveSessionIntent({
            sessionIntent,
            clientIntent,
            tab: 'packages',
        });
        assert.equal(resolved.origin.code, 'FRA');
        assert.equal(resolved.travelers.adults, 3);
        assert.equal(resolved.cabin, 'Business');
    });

    it('merges a validated client patch onto empty session state', async () => {
        const resolveSessionIntent = await loadNamed('../lib/chat-request.js', 'resolveSessionIntent');
        const clientIntent = {
            origin: { name: 'Johannesburg', code: 'JNB' },
        };
        const resolved = resolveSessionIntent({
            sessionIntent: null,
            clientIntent,
            tab: 'packages',
        });
        assert.equal(resolved.origin.code, 'JNB');
        assert.equal(resolved.productTab, 'packages');
    });

    it('validates direct client patches before filling session blanks', async () => {
        const resolveSessionIntent = await loadNamed('../lib/chat-request.js', 'resolveSessionIntent');
        const resolved = resolveSessionIntent({
            sessionIntent: createEmptyIntent('packages'),
            clientIntent: {
                origin: { name: 'Nairobi', code: { value: 'NBO' } },
                cabin: { value: 'Business' },
                durationDays: [9],
                unknownField: 'drop-me',
            },
            tab: 'packages',
        });
        assert.equal(resolved.origin.name, 'Nairobi');
        assert.equal(resolved.origin.code, undefined);
        assert.equal(resolved.cabin, null);
        assert.equal(resolved.durationDays, null);
        assert.equal(resolved.unknownField, undefined);
    });
});

describe('trip context is not a system instruction', () => {
    it('omits free-text preferences from the system prompt', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            preferences: 'SECRET_PREFERENCE_NOTE do not put this in system',
            origin: { code: 'LHR', name: 'London' },
        }, 'packages');
        const prompt = buildSystemPrompt('packages', intent, { today: '2026-08-17' });
        assert.doesNotMatch(prompt, /SECRET_PREFERENCE_NOTE/);
        assert.doesNotMatch(prompt, /Current structured intent/);
    });

    it('puts client input only in a user-role context message', async () => {
        const projectIntentForModel = await loadNamed('../lib/prompts.js', 'projectIntentForModel');
        const buildTripContextMessage = await loadNamed('../lib/prompts.js', 'buildTripContextMessage');
        const intent = mergeIntent(createEmptyIntent('packages'), {
            origin: { code: 'LHR', name: 'London' },
            preferences: 'window seats please',
        }, 'packages');
        const projected = projectIntentForModel(intent, ['dates.start', 'travelers.adults']);
        const context = buildTripContextMessage(projected);
        assert.equal(context.role, 'user');
        assert.match(context.content, /window seats please/);
        assert.match(context.content, /untrusted|not instructions/i);
        const prompt = buildSystemPrompt('packages', { today: '2026-08-17' });
        assert.doesNotMatch(prompt, /window seats please/);
        assert.match(prompt, /untrusted data, not instructions/i);
    });

    it('projects a supplied cabin as known', async () => {
        const projectIntentForModel = await loadNamed('../lib/prompts.js', 'projectIntentForModel');
        const intent = mergeIntent(createEmptyIntent('flights'), { cabin: 'Business' }, 'flights');
        assert.equal(intent.cabinSource, 'user');
        assert.equal(projectIntentForModel(intent).valueStatus.cabin, 'known');
        assert.equal(projectIntentForModel(createEmptyIntent('flights')).valueStatus.cabin, 'unknown');
    });

    it('projects a cabin without user provenance as inferred', async () => {
        const projectIntentForModel = await loadNamed('../lib/prompts.js', 'projectIntentForModel');
        const intent = { ...createEmptyIntent('flights'), cabin: 'Economy', cabinSource: null };
        assert.equal(projectIntentForModel(intent).valueStatus.cabin, 'inferred');
    });

    it('keeps the operational cabin default out of intent', () => {
        const intent = createEmptyIntent('flights');
        const assumptions = getOperationalAssumptions(intent, { tab: 'flights' });
        assert.deepEqual(
            assumptions.find(({ field }) => field === 'cabin'),
            {
                field: 'cabin',
                value: 'Economy',
                reason: 'No cabin preference supplied',
            },
        );
        assert.equal(intent.cabin, null);
        assert.equal(intent.cabinSource, null);
    });
});

describe('calendar-date duration', () => {
    it('counts date-only ranges as inclusive calendar days', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            dates: { start: '2026-03-07', end: '2026-03-09' },
        }, 'packages');
        assert.equal(intent.durationDays, 3);
    });
});

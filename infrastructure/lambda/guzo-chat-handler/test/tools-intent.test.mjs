import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyIntent,
    mergeIntent,
    getPackageMissingFields,
    isPackageIntentComplete,
} from '../lib/intent.js';
import { normalizeTravelDate, resolveTravelYear } from '../lib/dates.js';
import { buildSystemPrompt } from '../lib/prompts.js';

describe('date year inference', () => {
    it('resolves day and month in code without a prompt year rule', () => {
        const prompt = buildSystemPrompt('packages', createEmptyIntent('packages'), {
            today: '2026-08-09',
        });
        assert.match(prompt, /Today's date: 2026-08-09/);
        assert.doesNotMatch(prompt, /NEVER ask which year/i);
        assert.doesNotMatch(prompt, /12 months/i);
    });
});

import {
    MAX_MESSAGE_LENGTH,
    validateMessageLength,
    isEthiopiaFirstDestination,
    ethiopiaAllowlistHint,
    assessChatScope,
    sanitizeToolArgs,
} from '../lib/guardrails.js';
import { appendDiagnostic, appendMessage, getSession, upsertSession } from '../lib/sessions.js';
import { handleSessionGet } from '../lib/routes.js';

describe('package intent completeness', () => {
    it('starts incomplete', () => {
        const intent = createEmptyIntent('packages');
        assert.equal(isPackageIntentComplete(intent), false);
        assert.ok(getPackageMissingFields(intent).includes('origin'));
        assert.ok(getPackageMissingFields(intent).includes('dates.start'));
    });

    it('requires destination or interests/duration', () => {
        let intent = createEmptyIntent('packages');
        intent = mergeIntent(intent, {
            origin: { name: 'London', code: 'LHR' },
            dates: { start: '2026-10-01' },
            travelers: { adults: 2 },
        }, 'packages');
        assert.equal(isPackageIntentComplete(intent), false);
        assert.ok(getPackageMissingFields(intent).includes('destination|interests|durationDays'));

        intent = mergeIntent(intent, { interests: ['history'], durationDays: 8 }, 'packages');
        assert.equal(isPackageIntentComplete(intent), true);
        assert.deepEqual(getPackageMissingFields(intent), []);
    });

    it('accepts destination without interests', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            origin: { name: 'Frankfurt', code: 'FRA' },
            destination: { name: 'Lalibela', code: 'LLI' },
            dates: { start: '2026-11-12' },
            travelers: { adults: 2 },
        }, 'packages');
        assert.equal(isPackageIntentComplete(intent), true);
    });

    it('merges package-planning fields', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            pace: 'relaxed',
            tier: 'comfort',
            budget: { amount: 4000, currency: 'GBP' },
            preferences: 'no early starts',
            packageId: 'pkg_northern_7d',
            itineraryId: 'itin_abc',
        }, 'packages');
        assert.equal(intent.pace, 'relaxed');
        assert.equal(intent.tier, 'comfort');
        assert.equal(intent.budget.amount, 4000);
        assert.equal(intent.preferences, 'no early starts');
        assert.equal(intent.packageId, 'pkg_northern_7d');
        assert.equal(intent.itineraryId, 'itin_abc');
    });

    it('merges and sanitizes stayPlan on update_package_intent fields', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            stayPlan: [
                { destinationId: 'Addis Ababa', days: 2.8 },
                { destinationId: 'lalibela', days: '3' },
                { destinationId: 'atlantis', days: 2 },
                { destinationId: 'gondar', days: 0 },
                { destinationId: 'bahir-dar', days: 'nope' },
            ],
        }, 'packages');
        assert.deepEqual(intent.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);

        const cleared = mergeIntent(intent, { stayPlan: [] }, 'packages');
        assert.equal(cleared.stayPlan, null);
    });

    it('treats a non-empty stayPlan like interests for completeness', () => {
        let intent = mergeIntent(createEmptyIntent('packages'), {
            origin: { name: 'London', code: 'LHR' },
            dates: { start: '2026-10-01' },
            travelers: { adults: 2 },
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 4 },
            ],
        }, 'packages');
        assert.equal(isPackageIntentComplete(intent), true);
        assert.deepEqual(getPackageMissingFields(intent), []);
    });

    it('lifts a preference day-split into stayPlan and durationDays', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            origin: { name: 'London', code: 'LHR' },
            dates: { start: '2026-11-01' },
            travelers: { adults: 2 },
            preferences: '2 days in Addis Ababa and 3 days in Lalibela',
        }, 'packages');
        assert.deepEqual(intent.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);
        assert.equal(intent.durationDays, 5);
        assert.equal(intent.dates.end, '2026-11-05');
        assert.equal(isPackageIntentComplete(intent), true);
    });

    it('does not overwrite an explicit stayPlan with preferences', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 5 },
            ],
            preferences: '3 days in Addis Ababa and 3 days in Bahir Dar',
        }, 'packages');
        assert.deepEqual(intent.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 5 },
        ]);
        assert.equal(intent.durationDays, 7);
    });

    it('derives an inclusive end date from start date and duration', () => {
        let intent = mergeIntent(createEmptyIntent('packages'), {
            dates: { start: '2026-09-23' },
            durationDays: 9,
        }, 'packages');
        assert.equal(intent.dates.end, '2026-10-01');

        intent = mergeIntent(intent, { durationDays: 10 }, 'packages');
        assert.equal(intent.dates.end, '2026-10-02');
    });

    it('lets an explicit date range win over stayPlan duration', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            dates: { start: '2026-10-10', end: '2026-10-17' },
            preferences: '2 days in Addis Ababa and 3 days in Lalibela',
        }, 'packages');
        assert.deepEqual(intent.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);
        assert.equal(intent.durationDays, 8);
        assert.equal(intent.dates.end, '2026-10-17');
    });

    it('uses an explicit date range as the duration source of truth', () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            dates: { start: '2026-10-10', end: '2026-10-17' },
            durationDays: 7,
        }, 'packages');
        assert.equal(intent.durationDays, 8);
        assert.equal(intent.dates.end, '2026-10-17');
    });

    it('resolves day+month without asking for a year', () => {
        const now = new Date('2026-08-09T12:00:00Z');
        assert.equal(resolveTravelYear(10, 15, now), 2026);
        assert.equal(normalizeTravelDate('15 October', now), '2026-10-15');
        assert.equal(normalizeTravelDate('October 15', now), '2026-10-15');

        const pastNow = new Date('2026-10-20T12:00:00Z');
        assert.equal(normalizeTravelDate('15 October', pastNow), '2027-10-15');

        const intent = mergeIntent(createEmptyIntent('packages'), {
            dates: { start: '15 October' },
        }, 'packages');
        assert.match(intent.dates.start, /^\d{4}-10-15$/);
    });
});

describe('session get/hydrate payload', () => {
    it('returns messages on GET session', async () => {
        const id = `guzo_test_${Date.now()}`;
        await upsertSession(id, { tab: 'packages' });
        await appendMessage(id, 'user', '15 October city break in Addis');
        await appendMessage(id, 'assistant', 'Great — let us plan that.');

        const res = await handleSessionGet({
            queryStringParameters: { sessionId: id },
            headers: {},
        });
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.sessionId, id);
        assert.equal(body.messages.length, 2);
        assert.equal(body.title, '15 October city break in Addis');
    });
});

describe('session diagnostics', () => {
    it('retains tool calls and summarized results', async () => {
        const sessionId = `test_${Date.now()}_${Math.random()}`;
        await upsertSession(sessionId, { tab: 'packages' });
        await appendDiagnostic(sessionId, {
            type: 'tool_call',
            name: 'search_catalog',
            args: { destination: 'lalibela' },
        });
        const session = await getSession(sessionId);
        assert.equal(session.diagnostics.length, 1);
        assert.equal(session.diagnostics[0].name, 'search_catalog');
    });
});

describe('guardrails', () => {
    it('enforces max message length', () => {
        assert.equal(MAX_MESSAGE_LENGTH, 2000);
        assert.equal(validateMessageLength('').ok, false);
        assert.equal(validateMessageLength('hello').ok, true);
        assert.equal(validateMessageLength('x'.repeat(2001)).ok, false);
    });

    it('checks Ethiopia-first destinations', () => {
        assert.equal(isEthiopiaFirstDestination('Lalibela'), true);
        assert.equal(isEthiopiaFirstDestination('Simien trek'), true);
        assert.equal(isEthiopiaFirstDestination('Kenya safari'), false);
        assert.ok(ethiopiaAllowlistHint('Kenya safari'));
        assert.equal(ethiopiaAllowlistHint('Addis Ababa'), null);
    });

    it('sanitizes tool args', () => {
        const clean = sanitizeToolArgs({
            q: 'x'.repeat(500),
            adults: 2,
            __proto__: { polluted: true },
            nested: { ok: true, deep: { n: 1 } },
        });
        assert.equal(clean.q.length, 200);
        assert.equal(clean.adults, 2);
        assert.equal(clean.nested.ok, true);
        assert.equal(sanitizeToolArgs(null).q, undefined);
        assert.deepEqual(sanitizeToolArgs(null), {});
    });

    it('declines off-topic and other-country chats', () => {
        assert.equal(assessChatScope('6-day Lalibela from London').inScope, true);
        assert.equal(assessChatScope('Selam, help me plan a trip').inScope, true);
        assert.equal(assessChatScope('Write python code for a scraper').inScope, false);
        assert.equal(assessChatScope('Tell me a joke').inScope, false);
        assert.equal(assessChatScope('Plan a Kenya safari holiday').inScope, false);
        assert.ok(assessChatScope('Plan a Kenya safari holiday').reply.includes('Ethiopian Holidays'));
    });
});

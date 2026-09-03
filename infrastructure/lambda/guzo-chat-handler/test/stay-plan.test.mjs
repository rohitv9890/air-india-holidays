import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildItinerary,
    buildStayPlan,
    calendarDaysForNights,
    nightsForAllocatedDays,
    resolveJourney,
} from '../lib/itinerary-builder.js';
import {
    resolveItineraryStayPlan,
    stayPlanFromItinerary,
    stayPlanFromPackage,
} from '../lib/stay-plan.js';
import { getById, rankPackagesForIntent, suggestStops } from '../lib/catalog.js';
import { validateStayPlan } from '../lib/stay-validation.js';
import { runTool } from '../lib/tools.js';
import { createEmptyIntent } from '../lib/intent.js';
import {
    enrichItineraryDays,
    ideaForStayDay,
    loadDayIdeas,
    selectDayIdea,
    shouldPreserveDayContent,
} from '../lib/day-content.js';

describe('structured stayPlan', () => {
    it('returns an explicit stayPlan with normalized slugs', () => {
        const plan = buildStayPlan({
            stayPlan: [
                { destinationId: 'Addis Ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'Bahir Dar', days: 2 },
            ],
        }, 7);
        assert.deepEqual(plan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
            { destinationId: 'bahir-dar', days: 2 },
        ]);
    });

    it('scales proportionally when stayPlan days do not match durationDays', () => {
        const fewer = buildStayPlan({
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 2 },
            ],
        }, 7);
        assert.equal(fewer.reduce((n, s) => n + s.days, 0), 7);
        assert.ok(fewer.every((s) => s.days >= 1));
        assert.equal(fewer[1].days, 7 - fewer[0].days);

        const more = buildStayPlan({
            stayPlan: [
                { destinationId: 'addis-ababa', days: 4 },
                { destinationId: 'lalibela', days: 4 },
            ],
        }, 5);
        assert.equal(more.reduce((n, s) => n + s.days, 0), 5);
        assert.ok(more.every((s) => s.days >= 1));
    });

    it('prefers stayPlan over a conflicting preferences string', () => {
        const plan = buildStayPlan({
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 5 },
            ],
            preferences: '3 days in Addis Ababa and 3 days in Bahir Dar',
        }, 7);
        assert.deepEqual(plan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 5 },
        ]);
    });

    it('drops unknown destinations and falls through to regex when all unknown', () => {
        const mixed = buildStayPlan({
            stayPlan: [
                { destinationId: 'not-a-place', days: 2 },
                { destinationId: 'lalibela', days: 3 },
            ],
        }, 5);
        assert.deepEqual(mixed, [{ destinationId: 'lalibela', days: 5 }]);

        const fallback = buildStayPlan({
            stayPlan: [{ destinationId: 'atlantis', days: 4 }],
            preferences: '2 days in Addis Ababa and 3 days in Lalibela',
        }, 5);
        assert.deepEqual(fallback, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);
    });

    it('builds a bespoke itinerary from a structured 7-day stayPlan', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 7,
            adults: 2,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'bahir-dar', days: 2 },
            ],
            preferences: '3 days in Gondar', // must not win
            bespoke: true,
        });
        assert.equal(itin.bespoke, true);
        assert.equal(itin.days.length, 7);
        assert.deepEqual(
            itin.days.map((d) => d.destinationId),
            [
                'addis-ababa', 'addis-ababa',
                'lalibela', 'lalibela', 'lalibela',
                'bahir-dar', 'bahir-dar',
            ],
        );
    });

    it('derives a catalog package stay plan from the route and pads the last stop', () => {
        const pkg = getById('pkg-northern-historic-7d');
        const plan = stayPlanFromPackage(pkg, 7);
        assert.deepEqual(plan, [
            { destinationId: 'addis-ababa', days: 1 },
            { destinationId: 'bahir-dar', days: 1 },
            { destinationId: 'gondar', days: 1 },
            { destinationId: 'simien', days: 1 },
            { destinationId: 'lalibela', days: 3 },
        ]);
        assert.equal(plan.reduce((n, s) => n + s.days, 0), 7);
    });

    it('keeps a catalog package on its route even when intent already has that stayPlan', () => {
        const pkg = getById('pkg-northern-historic-7d');
        const packagePlan = stayPlanFromPackage(pkg, 7);
        const resolved = resolveItineraryStayPlan({
            stayPlan: packagePlan,
            pkg,
            requestedDays: 7,
        });
        assert.equal(resolved.wantsBespoke, false);
        assert.equal(resolved.source, 'package');
        assert.deepEqual(resolved.stayPlan, packagePlan);

        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 7,
            adults: 2,
            stayPlan: packagePlan,
        });
        assert.equal(itin.bespoke, false);
        assert.equal(itin.packageId, 'pkg-northern-historic-7d');
        assert.deepEqual(stayPlanFromItinerary(itin), packagePlan);
    });

    it('turns a preference day-split into a custom stay plan instead of the package route', () => {
        const pkg = getById('pkg-northern-historic-7d');
        const resolved = resolveItineraryStayPlan({
            preferences: '2 days in Addis Ababa and 3 days in Lalibela',
            pkg,
            requestedDays: 5,
        });
        assert.equal(resolved.wantsBespoke, true);
        assert.deepEqual(resolved.stayPlan, [
            { destinationId: 'addis-ababa', days: 2 },
            { destinationId: 'lalibela', days: 3 },
        ]);
    });

    it('compose_itinerary persists a stay plan for a ready-made package', async () => {
        const result = await runTool('compose_itinerary', {
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 7,
            adults: 2,
        }, { intent: createEmptyIntent('packages'), tab: 'packages' });

        assert.equal(result.ok, true);
        assert.equal(result.itinerary.bespoke, false);
        assert.deepEqual(result.itinerary.days.map((d) => d.destinationId).slice(0, 4), [
            'addis-ababa',
            'bahir-dar',
            'gondar',
            'simien',
        ]);
        assert.deepEqual(stayPlanFromItinerary(result.itinerary), [
            { destinationId: 'addis-ababa', days: 1 },
            { destinationId: 'bahir-dar', days: 1 },
            { destinationId: 'gondar', days: 1 },
            { destinationId: 'simien', days: 1 },
            { destinationId: 'lalibela', days: 3 },
        ]);
    });

    it('composes a long family holiday as a multi-stop tour instead of stretching Addis', async () => {
        const intent = {
            ...createEmptyIntent('packages'),
            origin: { name: 'Frankfurt', code: 'FRA' },
            destination: { name: 'Addis Ababa, Ethiopia', code: 'ADD', catalogId: 'addis-ababa' },
            dates: { start: '2027-01-22', end: '2027-01-31' },
            travelers: { adults: 2, children: 2, childAges: [], infants: 0, rooms: 1 },
            durationDays: 10,
            interests: ['family', 'culture', 'nature'],
            preferences: 'Family trip around Ethiopia',
            tier: 'comfort',
        };
        const [match] = rankPackagesForIntent(intent, { limit: 1 });
        const ctx = { intent, tab: 'packages' };
        const result = await runTool('compose_itinerary', {
            packageId: match.id,
            destination: intent.destination,
            durationDays: 10,
            startDate: intent.dates.start,
            endDate: intent.dates.end,
            originIata: 'FRA',
            adults: 2,
            children: 2,
            interests: intent.interests,
            preferences: intent.preferences,
            tier: intent.tier,
            bespoke: false,
        }, ctx);

        assert.equal(result.ok, true);
        assert.notEqual(match.id, 'pkg-addis-stopover-3d');
        assert.ok(new Set(ctx.itinerary.days.map((day) => day.destinationId)).size > 1);
    });

    it('keeps authoritative KUL session origin across flights, currency, and itinerary days', async () => {
        const intent = {
            ...createEmptyIntent('packages'),
            origin: { name: 'Kuala Lumpur', code: 'KUL' },
            dates: { start: '2027-02-01', end: '2027-02-07' },
            travelers: { adults: 2, children: 0, childAges: [], infants: 0, rooms: 1 },
            durationDays: 7,
            destination: { name: 'Northern Ethiopia', code: 'ADD', catalogId: 'addis-ababa' },
        };
        const ctx = { intent, tab: 'packages' };
        const result = await runTool('compose_itinerary', {
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: intent.dates.start,
            durationDays: 7,
            adults: 2,
        }, ctx);

        assert.equal(result.ok, true);
        assert.equal(ctx.itinerary.originIata, 'KUL');
        assert.equal(ctx.itinerary.quote.currency, 'MYR');
        assert.ok(ctx.itinerary.flights.some((flight) => flight.origin === 'KUL' && flight.destination === 'ADD'));
        assert.ok(ctx.itinerary.flights.some((flight) => flight.origin === 'ADD' && flight.destination === 'KUL'));
        assert.equal(ctx.itinerary.flights.some((flight) => flight.origin === 'LHR' || flight.destination === 'LHR'), false);
        assert.equal(ctx.itinerary.days.some((day) => /london/i.test(day.destinationId || day.title)), false);
    });

    it('refuses a three-day international trip without silently extending it, while ten days composes', async () => {
        const intent = {
            ...createEmptyIntent('packages'),
            origin: { name: 'Kuala Lumpur', code: 'KUL' },
            dates: { start: '2027-02-01', end: '2027-02-03' },
            travelers: { adults: 2, children: 0, childAges: [], infants: 0, rooms: 1 },
            durationDays: 3,
            destination: { name: 'Addis Ababa', code: 'ADD', catalogId: 'addis-ababa' },
        };
        const shortCtx = { intent, tab: 'packages' };
        const short = await runTool('compose_itinerary', {
            packageId: 'pkg-addis-stopover-3d',
            startDate: intent.dates.start,
            durationDays: 3,
            adults: 2,
        }, shortCtx);

        assert.equal(short.ok, false);
        assert.equal(short.code, 'minimum-duration');
        assert.equal(short.requestedDurationDays, 3);
        assert.equal(short.minimumDurationDays, 4);
        assert.equal(shortCtx.itinerary, undefined);
        assert.equal(shortCtx.intent.durationDays, 3);

        const longCtx = {
            intent: {
                ...intent,
                dates: { start: '2027-02-01', end: '2027-02-10' },
                durationDays: 10,
            },
            tab: 'packages',
        };
        const long = await runTool('compose_itinerary', {
            packageId: 'pkg-northern-historic-7d',
            startDate: '2027-02-01',
            durationDays: 10,
            adults: 2,
        }, longCtx);

        assert.equal(long.ok, true);
        assert.equal(longCtx.itinerary.duration.days, 10);
        assert.equal(longCtx.itinerary.originIata, 'KUL');
        assert.equal(longCtx.itinerary.quote.currency, 'MYR');
    });
});

describe('suggestStops', () => {
    it('returns catalog destinations excluding the anchor', () => {
        const stops = suggestStops({ anchors: ['addis-ababa'], count: 2 });
        assert.equal(stops.length, 2);
        assert.ok(stops.every((s) => s.destinationId !== 'addis-ababa'));
        assert.ok(stops.every((s) => typeof s.score === 'number'));
        assert.ok(stops.every((s) => Array.isArray(s.reasons)));
        const again = suggestStops({ anchors: ['addis-ababa'], count: 2 });
        assert.deepEqual(again.map((s) => s.destinationId), stops.map((s) => s.destinationId));
    });

    it('shifts ranking toward trek destinations for trekking themes', () => {
        const trek = suggestStops({
            anchors: ['addis-ababa'],
            count: 4,
            themes: ['trekking', 'hiking'],
        });
        const ids = trek.map((s) => s.destinationId);
        const trekIdx = Math.min(
            ...['simien', 'bale'].map((id) => {
                const idx = ids.indexOf(id);
                return idx === -1 ? 99 : idx;
            }),
        );
        const cityIdx = Math.min(
            ...['harar', 'adama', 'bishoftu'].map((id) => {
                const idx = ids.indexOf(id);
                return idx === -1 ? 99 : idx;
            }),
        );
        assert.ok(trekIdx < 99, `expected a trek stop in ${ids.join(', ')}`);
        if (cityIdx < 99) assert.ok(trekIdx < cityIdx);
    });

    it('runTool suggest_stops returns the ranked shape', async () => {
        const result = await runTool('suggest_stops', {
            anchors: ['addis-ababa'],
            count: 2,
            themes: ['history'],
        }, { intent: createEmptyIntent('packages'), tab: 'packages' });
        assert.equal(result.ok, true);
        assert.equal(result.stops.length, 2);
        assert.ok(result.stops[0].destinationId);
        assert.ok(Array.isArray(result.stops[0].reasons));
    });
});

describe('validateStayPlan', () => {
    it('warns when a stop is shorter than stayGuidance.minDays', () => {
        const short = validateStayPlan([{ destinationId: 'simien', days: 1 }]);
        assert.equal(short.ok, true);
        assert.ok(short.warnings.some((w) => w.code === 'min-days' && w.destinationId === 'simien'));

        const ok = validateStayPlan([{ destinationId: 'simien', days: 2 }]);
        assert.equal(ok.warnings.filter((w) => w.code === 'min-days').length, 0);
    });

    it('blocks when consecutive stops have no catalogued connection', () => {
        const result = validateStayPlan([
            { destinationId: 'lalibela', days: 2 },
            { destinationId: 'unmapped-atoll', days: 2 },
        ]);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((e) => e.code === 'no-route'));
        assert.ok(result.warnings.some((w) => w.code === 'no-route'));
    });

    it('warns when there are too many stops for the trip length', () => {
        const result = validateStayPlan([
            { destinationId: 'addis-ababa', days: 1 },
            { destinationId: 'bahir-dar', days: 1 },
            { destinationId: 'gondar', days: 1 },
            { destinationId: 'lalibela', days: 2 },
        ]);
        assert.ok(result.warnings.some((w) => w.code === 'too-many-stops'));
    });

    it('compose_itinerary still succeeds and returns warnings', async () => {
        const result = await runTool('compose_itinerary', {
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 5,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 1 },
                { destinationId: 'bahir-dar', days: 1 },
                { destinationId: 'gondar', days: 1 },
                { destinationId: 'simien', days: 1 },
                { destinationId: 'lalibela', days: 1 },
            ],
        }, { intent: createEmptyIntent('packages'), tab: 'packages' });

        assert.equal(result.ok, true);
        assert.ok(result.itinerary?.stops?.length || result.itinerary?.durationDays);
        assert.ok(Array.isArray(result.warnings));
        assert.ok(result.warnings.some((w) => w.code === 'min-days' || w.code === 'too-many-stops'));
    });
});

describe('days vs nights occupancy', () => {
    it('maps calendar days to occupancy as days, days, days-1', () => {
        assert.equal(nightsForAllocatedDays(2, false), 2);
        assert.equal(nightsForAllocatedDays(3, false), 3);
        assert.equal(nightsForAllocatedDays(2, true), 1);
        assert.equal(nightsForAllocatedDays(1, true), 0);
        assert.equal(calendarDaysForNights(1, false), 1);
        assert.equal(calendarDaysForNights(2, true), 3);
    });

    it('2 Addis + 3 Lalibela + 2 Simien is seven days and six hotel nights', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 7,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'simien', days: 2 },
            ],
        });
        assert.equal(itin.days.length, 7);
        assert.equal(itin.duration.days, 7);
        assert.equal(itin.duration.nights, 6);
        assert.deepEqual(
            itin.days.map((d) => d.destinationId),
            [
                'addis-ababa', 'addis-ababa',
                'lalibela', 'lalibela', 'lalibela',
                'simien', 'simien',
            ],
        );
        assert.deepEqual(
            itin.route.map((r) => ({ destinationId: r.destinationId, days: r.days, nights: r.nights })),
            [
                { destinationId: 'addis-ababa', days: 2, nights: 2 },
                { destinationId: 'lalibela', days: 3, nights: 3 },
                { destinationId: 'simien', days: 2, nights: 1 },
            ],
        );
        const nightSum = itin.stays.reduce((n, s) => n + s.nights, 0);
        assert.equal(nightSum, 6);
        const simienStay = itin.stays.find((s) => s.destinationId === 'simien');
        assert.equal(simienStay.nights, 1);
        assert.equal(simienStay.checkIn, '2026-11-06');
        assert.equal(simienStay.checkOut, '2026-11-07');
        assert.ok(itin.days[0].journey, 'arrival day carries the inbound journey');
        assert.ok(itin.days[2].journey, 'Lalibela arrival day carries the inbound journey');
        assert.equal(itin.days[2].journey.from, 'addis-ababa');
        assert.equal(itin.days[2].journey.to, 'lalibela');
        assert.equal(itin.days[2].journey.hours, 5.1);
        assert.equal(itin.days[2].journey.mode, 'flight');
        assert.equal(itin.days[2].journey.flightRouteId, 'flt-add-lli');
        assert.equal(itin.days[1].journey, undefined);
        assert.ok(itin.days[5].journey, 'Simien arrival day carries the inbound journey');
        assert.equal(itin.days[5].journey.from, 'lalibela');
        assert.equal(itin.days[5].journey.to, 'simien');
        assert.equal(itin.days[5].journey.hours, resolveJourney('lalibela', 'simien').hours);

        const ideas = loadDayIdeas().destinations;
        const expected = [
            ...ideas['addis-ababa'].plans['2'],
            ...ideas.lalibela.plans['3'],
            ...ideas.simien.plans['2'],
        ];
        assert.deepEqual(itin.days.map((d) => d.moduleId), expected);
        for (let i = 0; i < itin.days.length; i += 1) {
            const dest = ideas[itin.days[i].destinationId];
            const module = dest.modules.find((m) => m.id === expected[i]);
            assert.equal(itin.days[i].title, module.title);
            assert.equal(itin.days[i].summary, module.summary);
            assert.equal(itin.days[i].description, module.summary);
            assert.ok(itin.days[i].image);
            assert.deepEqual(itin.days[i].experienceIds, module.experienceIds || []);
        }
    });

    it('does not schedule a full-day activity on a full-day transfer', () => {
        const itin = buildItinerary({
            packageId: 'pkg-harar-heritage-4d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 4,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'harar', days: 2 },
            ],
        });
        const arrival = itin.days.find((d) => d.destinationId === 'harar');
        const catalogued = resolveJourney('addis-ababa', 'harar');
        assert.equal(arrival.journey.load, 'full-day');
        assert.equal(arrival.journey.hours, catalogued.hours);
        assert.ok(arrival.journey.hours >= 6, `expected a full-day journey, got ${arrival.journey.hours}h`);
        assert.equal(arrival.moduleId, 'harar-jegol');
        assert.deepEqual(arrival.experienceIds, []);
        const module = loadDayIdeas().destinations.harar.modules.find((m) => m.id === arrival.moduleId);
        assert.notEqual(module.kind, 'full-day');
        assert.notEqual(arrival.moduleId, 'harar-markets-hyena');
    });

    it('does not hardcode every custom leg as flight', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 4,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'gondar', days: 2 },
                { destinationId: 'simien', days: 2 },
            ],
        });
        const gondar = itin.route.find((r) => r.destinationId === 'gondar');
        assert.equal(gondar.transportToNext, 'road');
        assert.equal(itin.days[2].journey.mode, 'road');
    });

    it('expands package occupancy: non-final nights days, final nights+1', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-12-10',
            adults: 2,
        });
        assert.equal(itin.days.length, 7);
        assert.equal(itin.duration.nights, 6);
        const dests = itin.days.map((d) => d.destinationId);
        assert.deepEqual(dests, [
            'addis-ababa',
            'bahir-dar',
            'gondar',
            'simien',
            'lalibela', 'lalibela', 'lalibela',
        ]);
        const nightSum = itin.stays.reduce((n, s) => n + s.nights, 0);
        assert.equal(nightSum, 6);
        const lalibelaStay = itin.stays.find((s) => s.destinationId === 'lalibela');
        assert.equal(lalibelaStay.nights, 2);
    });
});

describe('module-owned experience selection', { concurrency: false }, () => {
    const moduleCatalog = {
        lalibela: {
            modules: {
                'lal-arrive': {
                    id: 'lal-arrive',
                    title: 'Touch down in Lalibela',
                    summary: 'Fly in and settle above the rock churches.',
                    highlights: ['Arrival'],
                    image: 'images/lal-arrive.jpg',
                    imageAlt: 'Lalibela airstrip',
                    experienceIds: [],
                },
                'lal-north': {
                    id: 'lal-north',
                    title: 'Northern cluster',
                    summary: 'The northern group of rock-hewn churches.',
                    highlights: ['Northern cluster'],
                    image: 'images/lal-north.jpg',
                    imageAlt: 'Northern churches',
                    experienceIds: ['exp-lalibela-churches'],
                },
                'lal-south': {
                    id: 'lal-south',
                    title: 'Bete Giyorgis',
                    summary: 'The cruciform church and surrounding highland paths.',
                    highlights: ['Bete Giyorgis'],
                    image: 'images/lal-south.jpg',
                    imageAlt: 'Bete Giyorgis',
                    experienceIds: ['exp-lalibela-giyorgis'],
                },
            },
            plans: {
                1: ['lal-north'],
                2: ['lal-arrive', 'lal-north'],
                3: ['lal-arrive', 'lal-north', 'lal-south'],
                4: ['lal-arrive', 'lal-north', 'lal-south', 'lal-north'],
                5: ['lal-arrive', 'lal-north', 'lal-south', 'lal-north', 'lal-south'],
            },
            arrivalModuleId: 'lal-arrive',
        },
        'addis-ababa': [
            {
                title: 'Gateway to the highlands',
                summary: 'Settle into Addis.',
                highlights: ['Coffee'],
                image: 'images/addis.jpg',
                imageAlt: 'Addis',
            },
        ],
    };

    it('uses the authored plan for stay length and module experience ids', () => {
        const two = selectDayIdea(moduleCatalog, 'lalibela', 0, 2, 'short');
        const threeDay = [
            selectDayIdea(moduleCatalog, 'lalibela', 0, 3, 'short'),
            selectDayIdea(moduleCatalog, 'lalibela', 1, 3, null),
            selectDayIdea(moduleCatalog, 'lalibela', 2, 3, null),
        ];
        assert.equal(two.moduleId, 'lal-arrive');
        assert.deepEqual(two.experienceIds, []);
        assert.deepEqual(threeDay.map((d) => d.moduleId), ['lal-arrive', 'lal-north', 'lal-south']);
        assert.deepEqual(threeDay[1].experienceIds, ['exp-lalibela-churches']);
        assert.deepEqual(threeDay[2].experienceIds, ['exp-lalibela-giyorgis']);
    });

    it('swaps in the arrival module on a half-day inbound journey', () => {
        const idea = selectDayIdea(moduleCatalog, 'lalibela', 0, 3, 'half-day');
        assert.equal(idea.moduleId, 'lal-arrive');
    });

    it('clears experiences on a full-day transfer', () => {
        const idea = selectDayIdea(moduleCatalog, 'lalibela', 0, 3, 'full-day');
        assert.equal(idea.moduleId, 'lal-arrive');
        assert.deepEqual(idea.experienceIds, []);
    });

    it('supports legacy array prefix lookup alongside modules', () => {
        const addis = selectDayIdea(moduleCatalog, 'addis-ababa', 0);
        assert.equal(addis.title, 'Gateway to the highlands');
        const overflow = selectDayIdea(moduleCatalog, 'addis-ababa', 1);
        assert.match(overflow.title, /Deeper into Addis Ababa/);
    });

    it('overflows stays longer than five days with unused then leisure modules', () => {
        const catalog = {
            simien: {
                modules: {
                    'sim-a': { id: 'sim-a', title: 'A', summary: 'A', highlights: ['A'] },
                    'sim-b': { id: 'sim-b', title: 'B', summary: 'B', highlights: ['B'] },
                    'sim-c': { id: 'sim-c', title: 'C', summary: 'C', highlights: ['C'] },
                    'sim-d': { id: 'sim-d', title: 'D', summary: 'D', highlights: ['D'] },
                    'sim-e': { id: 'sim-e', title: 'E', summary: 'E', highlights: ['E'] },
                    'sim-f': { id: 'sim-f', title: 'F unused', summary: 'F', highlights: ['F'] },
                },
                plans: {
                    1: ['sim-a'],
                    2: ['sim-a', 'sim-b'],
                    3: ['sim-a', 'sim-b', 'sim-c'],
                    4: ['sim-a', 'sim-b', 'sim-c', 'sim-d'],
                    5: ['sim-a', 'sim-b', 'sim-c', 'sim-d', 'sim-e'],
                },
            },
        };
        const day6 = selectDayIdea(catalog, 'simien', 5, 7);
        const day7 = selectDayIdea(catalog, 'simien', 6, 7);
        assert.equal(day6.moduleId, 'sim-f');
        assert.equal(day7.moduleId, 'simien-leisure');
        assert.equal(day7.leisure, true);
    });

    it('follows overflow policy on a real 6-day Lalibela stay', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 6,
            adults: 2,
            bespoke: true,
            stayPlan: [{ destinationId: 'lalibela', days: 6 }],
        });
        const plan5 = loadDayIdeas().destinations.lalibela.plans['5'];
        assert.deepEqual(itin.days.slice(0, 5).map((d) => d.moduleId), plan5);
        assert.equal(itin.days[5].moduleId, 'lalibela-leisure');
        assert.equal(itin.days[5].title, loadDayIdeas().destinations.lalibela.modules.find((m) => m.id === 'lalibela-leisure').title);
    });

    it('does not round-robin catalog experiences onto old-shape days', () => {
        const fromFile = ideaForStayDay('lalibela', 0);
        assert.match(fromFile.title, /northern cluster/i);

        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'ADD',
            startDate: '2026-11-01',
            durationDays: 3,
            adults: 2,
            bespoke: true,
            stayPlan: [{ destinationId: 'lalibela', days: 3 }],
        });
        assert.ok(itin.days.every((d) => Array.isArray(d.experienceIds)));
        const fromRoundRobin = itin.days.some((d) => (d.experienceIds || []).length > 1);
        assert.equal(fromRoundRobin, false);
    });
});

describe('browser overlay preservation', () => {
    it('keeps module-resolved API titles and images', () => {
        assert.equal(shouldPreserveDayContent({
            moduleId: 'lal-north',
            title: 'Northern cluster',
            summary: 'The northern group of rock-hewn churches.',
            image: 'images/lal-north.jpg',
            highlights: ['Northern cluster'],
        }), true);
        assert.equal(shouldPreserveDayContent({
            title: 'Lalibela',
            destinationId: 'lalibela',
            description: 'Northern Historic — day 4 in Lalibela.',
            image: 'images/generic.jpg',
        }), false);
        assert.equal(shouldPreserveDayContent({
            title: 'Day 3',
            summary: 'Keep going.',
        }), false);
    });

    it('does not overwrite API-resolved day content when enriching', () => {
        const apiDays = [{
            destinationId: 'lalibela',
            moduleId: 'lalibela-northern-cluster',
            title: 'API northern cluster',
            summary: 'Server-authored copy.',
            description: 'Server-authored copy.',
            image: 'https://example.test/api.jpg',
            highlights: ['From API'],
            experienceIds: ['exp-lalibela-churches'],
        }, {
            destinationId: 'lalibela',
            title: 'Lalibela',
            description: 'Northern Historic — day 2 in Lalibela.',
            image: 'images/generic.jpg',
        }];
        const enriched = enrichItineraryDays(apiDays);
        assert.equal(enriched[0].title, 'API northern cluster');
        assert.equal(enriched[0].image, 'https://example.test/api.jpg');
        assert.equal(enriched[0].moduleId, 'lalibela-northern-cluster');
        assert.notEqual(enriched[1].title, 'Lalibela');
        assert.ok(enriched[1].moduleId);
    });
});

describe('ready-made and custom parity', () => {
    it('shares base modules with an equivalent custom allocation when no override exists', () => {
        const ready = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-12-10',
            adults: 2,
        });
        const custom = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-12-10',
            durationDays: 7,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 1 },
                { destinationId: 'bahir-dar', days: 1 },
                { destinationId: 'gondar', days: 1 },
                { destinationId: 'simien', days: 1 },
                { destinationId: 'lalibela', days: 3 },
            ],
        });
        assert.deepEqual(
            ready.days.map((d) => d.moduleId),
            custom.days.map((d) => d.moduleId),
        );
        assert.deepEqual(
            ready.days.map((d) => d.title),
            custom.days.map((d) => d.title),
        );
    });

    it('applies a package moduleId override instead of the default destination plan', () => {
        const ready = buildItinerary({
            packageId: 'pkg-harar-heritage-4d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            adults: 2,
        });
        const custom = buildItinerary({
            packageId: 'pkg-harar-heritage-4d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 4,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 1 },
                { destinationId: 'harar', days: 3 },
            ],
        });
        assert.equal(ready.days[3].moduleId, 'harar-coffee-departure');
        assert.equal(custom.days[3].moduleId, 'harar-shrines');
        assert.notEqual(ready.days[3].moduleId, custom.days[3].moduleId);
        assert.deepEqual(
            ready.days.slice(0, 3).map((d) => d.moduleId),
            custom.days.slice(0, 3).map((d) => d.moduleId),
        );
    });

    it('produces byte-stable day content for identical inputs', () => {
        const args = {
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 7,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'simien', days: 2 },
            ],
        };
        const a = buildItinerary(args);
        const b = buildItinerary(args);
        assert.equal(JSON.stringify(a.days), JSON.stringify(b.days));
        assert.equal(JSON.stringify(a), JSON.stringify(b));
    });
});

describe('journey inference', () => {
    it('treats same-IATA hops as road rather than inventing a flight', () => {
        const journey = resolveJourney('gondar', 'simien');
        assert.equal(journey.mode, 'road');
        assert.notEqual(journey.mode, 'flight');
        assert.equal(journey.load, 'short');
    });

    it('uses catalogued Addis–Lalibela flight hours and load', () => {
        const journey = resolveJourney('addis-ababa', 'lalibela');
        assert.equal(journey.mode, 'flight');
        assert.equal(journey.load, 'half-day');
        assert.equal(journey.hours, 5.1);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    loadConnections,
    planRoute,
    resetRoutePlannerCache,
    resolveJourney,
    DEFAULT_GATEWAY_ID,
    DEFAULT_GATEWAY_IATA,
    EXACT_SEARCH_LIMIT,
} from '../lib/route-planner.js';
import { destinationIata, selectFlights } from '../lib/flights.js';
import { destinationsConnected, validateStayPlan } from '../lib/stay-validation.js';

const CONNECTIONS = [
    { from: 'addis-ababa', to: 'lalibela', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-add-lli' },
    { from: 'lalibela', to: 'addis-ababa', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-lli-add' },
    { from: 'addis-ababa', to: 'bahir-dar', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-add-bjr' },
    { from: 'bahir-dar', to: 'addis-ababa', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-bjr-add' },
    { from: 'addis-ababa', to: 'gondar', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-add-gdq' },
    { from: 'gondar', to: 'addis-ababa', mode: 'flight', hours: 4.5, load: 'half-day', flightRouteId: 'flt-gdq-add' },
    { from: 'addis-ababa', to: 'axum', mode: 'flight', hours: 5, load: 'half-day', flightRouteId: 'flt-add-axu' },
    { from: 'axum', to: 'addis-ababa', mode: 'flight', hours: 5, load: 'half-day' },
    { from: 'addis-ababa', to: 'arba-minch', mode: 'flight', hours: 4.8, load: 'half-day', flightRouteId: 'flt-add-amh' },
    { from: 'arba-minch', to: 'addis-ababa', mode: 'flight', hours: 4.8, load: 'half-day' },
    { from: 'addis-ababa', to: 'harar', mode: 'road', hours: 8.5, load: 'full-day' },
    { from: 'harar', to: 'addis-ababa', mode: 'road', hours: 8.5, load: 'full-day' },
    { from: 'addis-ababa', to: 'hawassa', mode: 'road', hours: 4, load: 'half-day' },
    { from: 'hawassa', to: 'addis-ababa', mode: 'road', hours: 4, load: 'half-day' },
    { from: 'addis-ababa', to: 'jimma', mode: 'road', hours: 6.5, load: 'full-day' },
    { from: 'jimma', to: 'addis-ababa', mode: 'road', hours: 6.5, load: 'full-day' },
    { from: 'addis-ababa', to: 'bale', mode: 'road', hours: 8, load: 'full-day' },
    { from: 'bale', to: 'addis-ababa', mode: 'road', hours: 8, load: 'full-day' },
    { from: 'gondar', to: 'simien', mode: 'road', hours: 3.5, load: 'half-day' },
    { from: 'simien', to: 'gondar', mode: 'road', hours: 3.5, load: 'half-day' },
    { from: 'bahir-dar', to: 'gondar', mode: 'road', hours: 4, load: 'half-day' },
    { from: 'gondar', to: 'bahir-dar', mode: 'road', hours: 4, load: 'half-day' },
    { from: 'gondar', to: 'lalibela', mode: 'flight', hours: 3.5, load: 'half-day', flightRouteId: 'flt-gdq-lli' },
    { from: 'lalibela', to: 'gondar', mode: 'flight', hours: 3.5, load: 'half-day', flightRouteId: 'flt-lli-gdq' },
];

function plan(opts) {
    return planRoute({
        connections: CONNECTIONS,
        originIata: 'LHR',
        ...opts,
    });
}

function idsOf(result) {
    return result.orderedStops.map((stop) => stop.destinationId);
}

describe('planRoute', () => {
    it('defaults the international gateway to Addis Ababa', () => {
        const result = plan({ destinations: ['lalibela'] });
        assert.equal(result.gateway.id, DEFAULT_GATEWAY_ID);
        assert.equal(result.gateway.iata, DEFAULT_GATEWAY_IATA);
        assert.equal(result.ok, true);
    });

    it('returns an empty successful plan for no destinations', () => {
        const result = planRoute({
            destinations: [],
            gatewayId: 'custom-gateway',
            destinationRecords: [{ id: 'custom-gateway', iata: 'DIR' }],
            connections: [],
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.orderedStops, []);
        assert.deepEqual(result.ordered, []);
        assert.equal(result.gateway.iata, 'DIR');
    });

    it('returns no-route errors for an unknown disconnected destination', () => {
        const result = plan({ destinations: ['unmapped-atoll'] });
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((error) =>
            error.code === 'no-route'
            && (error.from === 'unmapped-atoll' || error.to === 'unmapped-atoll'),
        ));
    });

    it('de-duplicates destination ids', () => {
        const result = plan({
            destinations: ['lalibela', 'gondar', 'lalibela', 'gondar'],
        });
        assert.equal(result.ok, true);
        assert.deepEqual([...idsOf(result)].sort(), ['gondar', 'lalibela']);
    });

    it('sequences unordered Lalibela, Simien, and Addis without Addis in the middle', () => {
        const result = plan({
            destinations: ['lalibela', 'simien', 'addis-ababa'],
        });
        const ids = idsOf(result);
        assert.deepEqual([...ids].sort(), ['addis-ababa', 'lalibela', 'simien']);
        const addisIdx = ids.indexOf('addis-ababa');
        assert.ok(addisIdx === 0 || addisIdx === ids.length - 1);
        assert.equal(Math.abs(ids.indexOf('lalibela') - ids.indexOf('simien')), 1);
        assert.equal(result.diagnostics.selectedRoute.join(','), ids.join(','));
        assert.ok(result.diagnostics.rejectedAlternatives.length >= 1);
        assert.ok(Number.isFinite(result.diagnostics.totalHours));
        assert.equal(result.diagnostics.searchMode, 'exact');
        assert.deepEqual(result.ordered, ids);
    });

    it('chooses a coherent northern circuit and scores the return to ADD', () => {
        const closed = plan({
            destinations: ['bahir-dar', 'gondar', 'lalibela', 'simien'],
        });
        const open = plan({
            destinations: ['bahir-dar', 'gondar', 'lalibela', 'simien'],
            openJaw: true,
        });
        const ids = idsOf(closed);
        assert.equal(ids.includes('addis-ababa'), false);
        assert.equal(Math.abs(ids.indexOf('gondar') - ids.indexOf('simien')), 1);
        assert.ok(
            Math.abs(ids.indexOf('bahir-dar') - ids.indexOf('gondar')) === 1
            || Math.abs(ids.indexOf('lalibela') - ids.indexOf('gondar')) === 1,
        );
        assert.ok(closed.journeys.some((j) => j.kind === 'outbound' && j.to === 'addis-ababa'));
        assert.equal(open.journeys.some((j) => j.kind === 'outbound'), false);
        assert.ok(closed.totalHours > open.totalHours);
    });

    it('preserves an explicit feasible order', () => {
        const result = plan({
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'simien', days: 2 },
            ],
            explicitOrder: true,
        });
        assert.deepEqual(idsOf(result), ['addis-ababa', 'lalibela', 'simien']);
        assert.equal(result.warnings.some((w) => w.code === 'inefficient-order'), false);
        assert.deepEqual(result.stayPlan.map((s) => s.days), [2, 3, 2]);
    });

    it('warns on an inefficient explicit order and suggests an alternative', () => {
        const result = plan({
            stayPlan: [
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'simien', days: 2 },
            ],
            explicitOrder: true,
        });
        assert.deepEqual(idsOf(result), ['lalibela', 'addis-ababa', 'simien']);
        const warning = result.warnings.find((w) => w.code === 'inefficient-order');
        assert.ok(warning);
        assert.ok(Array.isArray(warning.suggestedOrder));
        assert.ok(warning.suggestedOrder.includes('addis-ababa'));
        assert.notEqual(warning.suggestedOrder.join(','), 'lalibela,addis-ababa,simien');
        const addisIdx = warning.suggestedOrder.indexOf('addis-ababa');
        assert.ok(addisIdx === 0 || addisIdx === warning.suggestedOrder.length - 1);
    });

    it('uses ADD as a hub transfer without creating an Addis stay', () => {
        const result = plan({
            destinations: ['lalibela', 'harar'],
        });
        assert.equal(idsOf(result).includes('addis-ababa'), false);
        assert.deepEqual([...idsOf(result)].sort(), ['harar', 'lalibela']);
        const viaAddis = result.journeys.find((j) => j.kind === 'connection');
        assert.ok(viaAddis);
        assert.equal(viaAddis.viaHub, true);
        assert.ok(viaAddis.hubIds.includes('addis-ababa'));
        assert.ok(viaAddis.path.some((leg) => leg.from === 'addis-ababa' || leg.to === 'addis-ababa'));
    });

    it('does not force a return to ADD for an open-jaw departure', () => {
        const result = plan({
            destinations: ['lalibela', 'simien'],
            openJaw: true,
        });
        assert.equal(result.openJaw, true);
        assert.equal(result.journeys.some((j) => j.kind === 'outbound'), false);
        assert.equal(
            result.journeys.some((j) => j.kind === 'connection' && j.to === 'addis-ababa'),
            false,
        );
    });

    it('prefers catalogued door-to-door hours over geographic convenience', () => {
        const connections = [
            { from: 'addis-ababa', to: 'west', mode: 'flight', hours: 10, load: 'full-day' },
            { from: 'addis-ababa', to: 'mid', mode: 'flight', hours: 10, load: 'full-day' },
            { from: 'addis-ababa', to: 'east', mode: 'flight', hours: 10, load: 'full-day' },
            { from: 'west', to: 'east', mode: 'flight', hours: 2, load: 'short' },
            { from: 'west', to: 'mid', mode: 'road', hours: 20, load: 'full-day' },
            { from: 'mid', to: 'east', mode: 'road', hours: 20, load: 'full-day' },
        ];
        const destinationRecords = [
            { id: 'addis-ababa', iata: 'ADD', lat: 9, lng: 38.7 },
            { id: 'west', lat: 10, lng: 38 },
            { id: 'mid', lat: 10, lng: 39 },
            { id: 'east', lat: 10, lng: 40 },
        ];
        const result = planRoute({
            destinations: ['west', 'mid', 'east'],
            connections,
            destinationRecords,
            originIata: 'LHR',
        });
        const ids = idsOf(result);
        assert.equal(Math.abs(ids.indexOf('west') - ids.indexOf('east')), 1);
        const westEast = result.journeys.find((j) =>
            (j.from === 'west' && j.to === 'east') || (j.from === 'east' && j.to === 'west'),
        );
        assert.ok(westEast);
        assert.equal(westEast.hours, 2);
    });

    it('resolves Addis–Lalibela and Lalibela–Simien on catalogued paths', () => {
        const addisLalibela = resolveJourney('addis-ababa', 'lalibela', { connections: CONNECTIONS });
        assert.equal(addisLalibela.hours, 4.5);
        assert.equal(addisLalibela.path.length, 1);
        assert.equal(addisLalibela.path[0].flightRouteId, 'flt-add-lli');
        assert.equal(addisLalibela.load, 'half-day');
        assert.equal(addisLalibela.mode, 'flight');

        const lalibelaSimien = resolveJourney('lalibela', 'simien', { connections: CONNECTIONS });
        assert.equal(lalibelaSimien.hours, 7);
        assert.deepEqual(lalibelaSimien.path.map((leg) => `${leg.from}>${leg.to}`), [
            'lalibela>gondar',
            'gondar>simien',
        ]);
        assert.equal(lalibelaSimien.viaHub, true);
        assert.deepEqual(lalibelaSimien.hubIds, ['gondar']);
        assert.equal(lalibelaSimien.mode, 'mixed');
    });

    it('loads catalogued connections.json hours when no override is given', () => {
        const addisLalibela = resolveJourney('addis-ababa', 'lalibela');
        assert.equal(addisLalibela.hours, 5.1);
        assert.equal(addisLalibela.path[0].flightRouteId, 'flt-add-lli');
        assert.equal(addisLalibela.load, 'half-day');
        assert.equal(addisLalibela.mode, 'flight');

        const gondarSimien = resolveJourney('gondar', 'simien');
        assert.equal(gondarSimien.mode, 'road');
        assert.equal(gondarSimien.hours, 3);
        assert.equal(gondarSimien.load, 'short');

        const lalibelaSimien = resolveJourney('lalibela', 'simien');
        assert.equal(lalibelaSimien.hours, 6);
        assert.equal(lalibelaSimien.flightRouteId, 'flt-lli-gdq');
        assert.ok(lalibelaSimien.hubIds.includes('gondar'));
    });

    it('returns the same route for identical inputs', () => {
        const args = { destinations: ['lalibela', 'simien', 'bahir-dar', 'gondar'] };
        assert.deepEqual(plan(args).diagnostics, plan(args).diagnostics);
    });

    it('uses exact search at the configured boundary', () => {
        const result = plan({
            destinations: [
                'lalibela', 'bahir-dar', 'gondar', 'axum',
                'arba-minch', 'harar', 'hawassa', 'jimma',
            ],
        });
        assert.equal(EXACT_SEARCH_LIMIT, 8);
        assert.equal(result.ok, true);
        assert.equal(result.diagnostics.searchMode, 'exact');
        assert.equal(result.orderedStops.length, EXACT_SEARCH_LIMIT);
    });

    it('clamps the exact-search limit and uses a heuristic above the boundary', () => {
        const result = plan({
            destinations: [
                'lalibela', 'bahir-dar', 'gondar', 'simien', 'axum',
                'harar', 'arba-minch', 'hawassa', 'jimma',
            ],
            exactSearchLimit: Number.MAX_SAFE_INTEGER,
        });
        assert.equal(result.ok, true);
        assert.equal(result.diagnostics.searchMode, 'heuristic');
        assert.equal(result.orderedStops.length, 9);
        assert.ok(Number.isFinite(result.totalHours));
        assert.equal(EXACT_SEARCH_LIMIT, 8);
    });
});

describe('loadConnections', () => {
    it('falls back without caching when connections.json is malformed', () => {
        const directory = mkdtempSync(join(tmpdir(), 'guzo-route-planner-'));
        const path = join(directory, 'connections.json');
        const previousPath = process.env.CONNECTIONS_PATH;
        writeFileSync(path, '{ malformed json');
        process.env.CONNECTIONS_PATH = path;
        resetRoutePlannerCache();

        try {
            const loaded = loadConnections();
            assert.equal(loaded.source, 'fallback');
            assert.ok(loaded.connections.length > 0);

            writeFileSync(path, JSON.stringify({
                connections: [
                    { from: 'alpha', to: 'beta', mode: 'road', hours: 1.25 },
                ],
            }));
            const retried = loadConnections();
            assert.equal(retried.source, path);
            assert.deepEqual(
                retried.connections.map((connection) => `${connection.from}>${connection.to}`),
                ['alpha>beta', 'beta>alpha'],
            );
            assert.equal(resolveJourney('alpha', 'beta').hours, 1.25);
        } finally {
            if (previousPath === undefined) delete process.env.CONNECTIONS_PATH;
            else process.env.CONNECTIONS_PATH = previousPath;
            resetRoutePlannerCache();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('selectFlights stay boundaries', () => {
    it('reads IATA codes from the destination registry', () => {
        assert.equal(destinationIata('lalibela'), 'LLI');
        assert.equal(destinationIata('simien'), 'GDQ');
        assert.equal(destinationIata('addis-ababa'), 'ADD');
        assert.equal(destinationIata('bishoftu'), null);
    });

    it('selects domestic flights on stay boundaries from the connection path', () => {
        const segs = selectFlights({
            originIata: 'LHR',
            stayPlan: [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'simien', days: 2 },
            ],
            startDate: '2026-11-01',
            durationDays: 7,
            cabin: 'Economy',
            connections: CONNECTIONS,
        });
        assert.ok(segs.some((s) => s.origin === 'LHR' && s.destination === 'ADD' && s.direction === 'outbound'));
        const addLli = segs.find((s) => s.origin === 'ADD' && s.destination === 'LLI');
        assert.ok(addLli);
        assert.equal(addLli.date, '2026-11-03');
        assert.equal(addLli.direction, 'domestic');
        const lliGdq = segs.find((s) => s.origin === 'LLI' && s.destination === 'GDQ');
        assert.ok(lliGdq);
        assert.equal(lliGdq.date, '2026-11-06');
        assert.ok(segs.some((s) => s.origin === 'GDQ' && s.destination === 'ADD' && s.date === '2026-11-07'));
        assert.ok(segs.some((s) => s.direction === 'return' && s.origin === 'ADD' && s.destination === 'LHR'));
    });

    it('does not add a domestic return to ADD on an open-jaw itinerary', () => {
        const segs = selectFlights({
            originIata: 'LHR',
            stayPlan: [
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'simien', days: 2 },
            ],
            startDate: '2026-11-01',
            durationDays: 5,
            openJaw: true,
            connections: CONNECTIONS,
        });
        assert.equal(segs.some((s) => s.direction === 'return'), false);
        assert.equal(segs.some((s) => s.origin === 'GDQ' && s.destination === 'ADD'), false);
        assert.ok(segs.some((s) => s.origin === 'ADD' && s.destination === 'LLI'));
    });
});

describe('validateStayPlan connection graph', () => {
    it('keeps min-stay findings as warnings on a feasible plan', () => {
        const result = validateStayPlan(
            [{ destinationId: 'simien', days: 1 }],
            { connections: CONNECTIONS },
        );
        assert.equal(result.ok, true);
        assert.ok(result.warnings.some((w) => w.code === 'min-days' && w.destinationId === 'simien'));
    });

    it('blocks when consecutive stays have no catalogued path', () => {
        const result = validateStayPlan(
            [
                { destinationId: 'lalibela', days: 2 },
                { destinationId: 'unmapped-atoll', days: 2 },
            ],
            { connections: CONNECTIONS },
        );
        assert.equal(destinationsConnected('lalibela', 'unmapped-atoll', { connections: CONNECTIONS }), false);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((e) => e.code === 'no-route'));
        assert.ok(result.warnings.some((w) => w.code === 'no-route'));
    });

    it('blocks when a journey is longer than the arriving stay allocation', () => {
        const result = validateStayPlan(
            [
                { destinationId: 'lalibela', days: 2 },
                { destinationId: 'harar', days: 1 },
            ],
            { connections: CONNECTIONS },
        );
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((e) => e.code === 'journey-too-long' && e.destinationId === 'harar'));
    });

    it('classifies a full-day Addis–Harar arrival so the assembler can skip a full-day module', () => {
        const result = validateStayPlan(
            [
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'harar', days: 2 },
            ],
            { connections: CONNECTIONS },
        );
        assert.equal(result.ok, true);
        const arrival = result.journeys.find((j) => j.kind === 'connection' && j.to === 'harar');
        assert.equal(arrival.load, 'full-day');
        assert.equal(arrival.hours, 8.5);
    });

    it('surfaces an inefficient-order warning for an explicit stay plan', () => {
        const result = validateStayPlan(
            [
                { destinationId: 'lalibela', days: 3 },
                { destinationId: 'addis-ababa', days: 2 },
                { destinationId: 'simien', days: 2 },
            ],
            { connections: CONNECTIONS },
        );
        assert.ok(result.warnings.some((w) => w.code === 'inefficient-order' && Array.isArray(w.suggestedOrder)));
    });
});

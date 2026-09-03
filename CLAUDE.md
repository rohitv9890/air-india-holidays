# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This is the **Air India Holidays concept demo** — the ICC Men's Cricket World Cup 2027 (hero product) and Taj Holidays, built on **Guzo** (the AI trip-planning assistant), a real easyGDS engine originally built for an Ethiopian Airlines RFP. This repo is a cleaned, rebranded fork of that original: easyGDS's RFP/proposal artefacts, other clients' branding, and Ethiopia-specific research data were stripped out before this repo was created — what remains is the reusable product engine plus new Air India/Taj catalog content.

**Runs in `mockMode: true`** (`guzo/guzo-config.js`) — the whole demo works off local catalog JSON with no backend, no AWS, no OpenRouter API key. `infrastructure/lambda/guzo-chat-handler/` (the real AI backend) is intentionally left untouched/un-rebranded since it isn't deployed for this demo — see "Known gaps" below before wiring it up for real.

## Commands

```bash
node scripts/guzo-local-server.mjs     # site + /guzo/* API on :8787 (needs infrastructure/.env)
npm run build                          # build.mjs -> dist/
npm run test:frontend                  # node --test test/*.test.mjs
npm test --prefix infrastructure/lambda/guzo-chat-handler   # full backend suite
npm run catalog:validate               # integrity gate over data/catalog/v1 (--json for machine output)
npm run catalog:sync                   # validate, then copy catalog into the Lambda package
```

Single test file / single test:

```bash
node --test infrastructure/lambda/guzo-chat-handler/test/stay-plan.test.mjs
node --test --test-name-pattern "stay plan" infrastructure/lambda/guzo-chat-handler/test/*.test.mjs
```

`npm run test:catalog` runs **only** `catalog.test.mjs`; it is not the backend suite. As of the last check, 4 of 173 backend tests fail on `main` (Addis day-image distinctness, one `compose_itinerary` stay-plan persistence case) — verify against a clean baseline before assuming a change caused a failure.

`infrastructure/.env` (gitignored) must contain `OPENROUTER_API_KEY`; the local server **exits** without it, even for static pages. Copy from `infrastructure/.env.example`.

## Architecture

Four layers, all plain ESM with no bundler and no runtime dependencies outside AWS SDK in the Lambda.

**1. Static site.** `index.html` (demo homepage) + `scripts.js` (non-module, exposes `window.EHSearch` / `window.EHSearchPanel` used by Guzo for origin autocomplete and the sticky search panel) + `styles.css`. Tailwind, Lucide, and flatpickr come from CDNs. `itinerary.html` is the itinerary page shell, populated by `js/itinerary-renderer.js`.

**2. Guzo frontend** (`guzo/*.js`, loaded as `<script type="module" src="guzo/index.js">`). `index.js` is the controller: binds DOM, owns `sendMessage`, drives everything through a subscribe/render loop over `guzo-state.js` (a single mutable `guzoState` + `notify()`). `guzo-planner.js` decides between the API path and the offline/mock path; `guzo-client.js` speaks HTTP/SSE; `guzo-catalog-client.js` fetches `data/catalog/v1/*.json` directly for the mock path; `guzo-ui.js` renders message/card HTML. Two chat surfaces exist (inline hero card and the right-hand drawer); `renderAll` keeps exactly one populated and blanks the other.

**3. Guzo backend** (`infrastructure/lambda/guzo-chat-handler/`). One handler, two entry points sharing the same `lib/`:
- `index.mjs` — AWS Lambda, using `awslambda.streamifyResponse` when available (SSE) and a buffered fallback otherwise.
- `scripts/guzo-local-server.mjs` — Node http server that adapts requests into Lambda-shaped events, serves the repo root statically, and uses in-memory sessions.

`lib/chat.js` is the agent loop: build system prompt → call OpenRouter with `GUZO_TOOLS` streaming → fan tool calls through `runTool` → emit SSE events (`text_delta`, `intent_update`, `recommendations`, `cross_sell_packages`, `trip_summary`, `enhancement_suggestions`, `composite_quote`, `itinerary_ready`, `error`, `done`). Max 4 tool rounds. There is a deterministic shortcut before the model runs: a "build my itinerary" message with complete intent calls `compose_itinerary` directly.

**4. Catalog data** (`data/catalog/v1/`, JSON Schemas in `data/catalog/schema/`). This is the grounding source of truth:
- `catalog.json` — 125 products (packages, accommodation, experiences, transfers) with `status`, tier, base price in GBP, images, EasyGDS refs.
- `destinations.json` — 22 destinations with `iata`, cluster, lat/lng, stay guidance.
- `day-ideas.json` — reusable per-destination **day modules** plus ordered `plans` for stays of 1–5 days, with `arrivalModuleId` / `departureModuleId` / `leisureModuleId`. Longer stays append unused modules then leisure.
- `connections.json` — 114-edge door-to-door journey graph (mode, hours, load, optional `flightRouteId`); `addis-ababa` is the default gateway.
- `flights.json` — ET routes with base fares and cabin multipliers.

### Itinerary composition pipeline

`compose_itinerary` → `stay-plan.js` (resolve destination/night split from intent, preferences, or the source package) → `route-planner.js` (`planRoute` orders stops; `resolveJourney` resolves each hop against `connections.json`, weighting backtracks/mode changes/extra hubs) → `itinerary-builder.js` (allocate calendar days, attach stays and journeys) → `day-content.js` (`enrichItineraryDays` fills day copy from day modules) → `flights.js` + `pricing.js` + `miles.js` + `availability.js` (quote, ShebaMiles estimate, seeded availability). Output conforms to `data/catalog/schema/itinerary.schema.json` and is consumed by `js/itinerary-renderer.js` and stored in `sessionStorage.guzoItinerary`.

## Conventions and invariants

**Business rules live in code, not the prompt.** `lib/prompts.js#buildSystemPrompt` is deliberately short (≤350 words before runtime context) and must not contain currency maps, date arithmetic, required-field lists, tool-argument spelling, or UI card policy. Itinerary construction, pricing, currency conversion, and date arithmetic stay deterministic. See `docs/guzo-prompt-orchestration-refactor-plan.md` for the full definition of done.

**Never put client intent or free text in a system message.** Trip state is passed via `buildTripContextMessage(projectIntentForModel(...))` as a user-role message labelled untrusted data. Session intent (DynamoDB / in-memory) is authoritative; a validated client patch may update it but never replaces it wholesale (`chat-request.js#resolveSessionIntent`).

**Tool results are projected before reaching the model.** `lib/projections.js` strips internal fields (`assertNoInternalFields` guards this); `lib/guardrails.js` clamps message length, sanitizes tool args, and runs the Ethiopia-first scope gate — ordinary corrections ("forget the previous dates") must stay in scope, and Ethiopia keywords must not smuggle off-topic work through.

**Unknown values stay unknown.** Do not silently materialise two adults, a default cabin, or invented dates as user-confirmed facts (`intent.js#getOperationalAssumptions`, `projectIntentForModel`'s `valueStatus`).

**Currency is decided once, in code** — `display-currency.js#displayCurrencyForOrigin` maps origin IATA to display currency, and the same value must flow through quotes, itineraries, recommendation cards, enhancement cards, and fallbacks. `guzo/display-currency.js` and `infrastructure/lambda/.../lib/display-currency.js` are **byte-identical copies**; keep them in sync. `guzo/day-content.js` mirrors the backend module's lookup contract with a browser-side fetch instead of `fs` — same requirement.

**Catalog edits go through the tooling.** Edit `data/catalog/v1/`, run `npm run catalog:validate`, then `npm run catalog:sync` to copy into `infrastructure/lambda/guzo-chat-handler/data/catalog/v1/` (sync refuses on validation failure unless `--force`; manifests are excluded). Validation covers product shape, destination geo, day modules/plans, connection→flight mapping, and package `dayTemplates` moduleId overrides; draft records report separately and do not fail the run. Hermes import bundles land via `scripts/merge-hermes-import-bundle.mjs` (`npm run catalog:merge-dry` first).

**Guzo config.** `guzo/guzo-config.js` — `mockMode: false` plus same-origin `apiUrl` (falls back to `http://localhost:8787` for `file:` origins). Do not drive `file://` pages when testing. With `mockMode: true` the frontend runs entirely off the catalog JSON with no backend.

## Build and deploy

`build.mjs` crawls every asset reachable from `index.html` (follows href/src/url()/ES imports and lazy data-src/srcset) and copies the reachable set into `dist/`. Catalog JSON under `data/catalog/` and itinerary JS are force-included regardless of reachability. Consequence: a new asset referenced only in a way the crawler's token regexes miss will silently not ship — check `dist/` after adding one. `dist/` is gitignored. No proposal/index rename dance — `index.html` is the entry point.

Hosting is Cloudflare Pages (`wrangler.toml`, `_headers`) with an AWS Amplify config also committed (`amplify.yml`, which duplicates the headers because Amplify ignores `_headers`). The whole site is `noindex` via three mechanisms. Backend deploys via AWS SAM from `infrastructure/` — see `infrastructure/README.md` for the endpoint table, env vars, and secret setup (not needed for the mockMode demo).

## Known gaps (deliberate scope decisions for this demo)

- **Backend currency logic is untouched and still GBP/Ethiopia-flavored.** `guzo/display-currency.js` (frontend, used by mockMode) was rewritten to a USD base with INR/GBP/AED origin mapping. Its backend mirror at `infrastructure/lambda/guzo-chat-handler/lib/display-currency.js` — along with `pricing.js`, `itinerary-builder.js`, and their tests, which import GBP/EUR/ZAR/MYR-named exports by name — was deliberately left alone, since the backend isn't deployed for this demo and touching one without the other would break both. Before ever deploying the real AI backend for Air India, align these (rename the GBP-based exports/variables throughout `infrastructure/lambda/guzo-chat-handler/lib/` and its tests to match the new currency model).
- **Backend Ethiopia-specific content/tests** (system prompt scope gate, catalog fixtures, "Addis" test cases) were not systematically rebranded — same reasoning, same caveat.
- Catalog is intentionally right-sized (~15-20 products across 2 verticals), not a 1:1 match to the original's 125-product/22-destination scale.

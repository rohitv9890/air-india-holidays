# Air India Holidays — Concept Demo

**Live:** https://rohitv9890.github.io/air-india-holidays/
**Repo:** https://github.com/rohitv9890/air-india-holidays (public)

A concept mockup for Air India + Tata Group: **Cricket World Cup 2027** (South
Africa/Zimbabwe/Namibia) as the hero product, plus **Taj Holidays** packages
across real IHCL/Taj properties. Built on top of a real AI trip-planning
engine originally built by easyGDS for an Ethiopian Airlines RFP — this repo
is a cleaned, rebranded fork with new Air India/Taj catalog content.

**Not an official Air India product** — a demo for internal review only.

## Quick start

No build step, no API key needed — runs entirely off local catalog JSON
(`mockMode: true` in `guzo/guzo-config.js`).

```bash
npx serve .
```

`index.html` is the homepage.

## What's real vs. hardcoded

- **The "Maharaja" assistant** (search widget "Ask Maharaja", or the chat
  button bottom-right) is a real rule-based recommendation/itinerary engine
  reading `data/catalog/v1/*.json` — not scripted. It fast-paths the two
  flagship packages: name one ("India v Australia", "Taj Lake Palace") → it
  asks travellers → links straight to the matching static flow below.
- **Two fully hardcoded, deterministic booking flows** (search → select →
  checkout), modeled on a real Air India/Kanoo/DreamSetGo booking pattern:
  - `search-cwc.html` → `select-cwc.html` → `checkout-cwc.html` — Delhi→
    Johannesburg, CWC 2027 opener, 3 real stand tiers (Category 2/1 Stand,
    Bullring Hospitality Suite).
  - `search-taj.html` → `select-taj.html` → `checkout-taj.html` — London
    Heathrow→Jaipur (with an explicit Jaipur→Udaipur transfer note), Taj Lake
    Palace, 3 real room categories (Luxury Room, Historical Suite, Grand
    Royal Suite).
  These don't touch the catalog/engine — prices and content are written
  directly into each page.
- **Currency** is INR by default, switching to GBP/AED/USD based on the
  selected origin airport (`guzo/display-currency.js`).

## File map

- **`index.html` / `scripts.js` / `styles.css`** — site shell: hero, search
  widget, CWC fan packages, Taj Holidays, Maharaja Club banner, Tata
  ecosystem strip.
- **`guzo/`** — the assistant engine (chat UI, intent parsing, itinerary
  building). Internal code/folder/element-id names still say `guzo` —
  deliberate, only user-facing text was renamed to "Maharaja" (see Known
  limitations).
- **`data/catalog/v1/`** — destinations, packages, day-by-day itinerary
  modules, flight routes, journey graph.
- **`infrastructure/`** — the real AWS Lambda backend for the AI assistant
  (OpenRouter-powered). Not deployed, not rebranded — see `CLAUDE.md` →
  "Known gaps" before ever wiring it up live.
- **`AI-logo.svg`** — the real Air India logo, used via a `.header-logo` CSS
  hook that renders it white-on-photo and full-color once the header scrolls
  to a white background.

## Known limitations

- **Airport autocomplete is broken.** The "City or Airport" fields in the
  general search widget call a live easyGDS demo API blocked by CORS from
  any other origin. Inherited as-is from the original codebase — not fixed,
  since neither the Maharaja assistant nor the two hardcoded flows use it.
- **Backend currency model is stale.** `infrastructure/lambda/.../lib/
  display-currency.js` and `pricing.js` are still GBP-based and untouched
  (the frontend copy was rewritten to USD/INR/GBP/AED) — align these before
  ever deploying the real backend.
- **All 3 CWC stand tiers share one stadium photo** — no distinct per-tier
  imagery.
- **`guzo/` internals are unrenamed.** Folder name, `GUZO_CONFIG`, element
  IDs (`guzo-panel`, `guzo-fab`, etc.) still say "guzo" — a bigger, riskier
  refactor that was deliberately skipped; only visible text says "Maharaja".

See [`CLAUDE.md`](CLAUDE.md) for full architecture notes and
[`DEPLOY.md`](DEPLOY.md) for hosting.

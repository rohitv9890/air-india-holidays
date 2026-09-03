# Air India Holidays — Concept Demo

A concept mockup for Air India + Tata Group: **Cricket World Cup 2027** (South
Africa/Zimbabwe/Namibia) as the hero product, plus **Taj Holidays** packages
across real IHCL/Taj properties. Built on top of **Guzo**, a real AI
trip-planning engine originally built by easyGDS for an Ethiopian Airlines RFP
— this repo is a cleaned, rebranded fork of that codebase with new Air
India/Taj catalog content in place of the original Ethiopia content.

**Not an official Air India product** — a demo for internal review only.

## Quick start

No build step, no API key needed — it runs entirely off local catalog JSON
(`mockMode: true` in `guzo/guzo-config.js`).

```bash
npx serve .
# or: python3 -m http.server 8080
```

Open the served URL — `index.html` is the homepage. Try the "Ask Guzo"
assistant in the search widget or the chat button (bottom-right) — it's a real
rule-based recommendation/itinerary engine reading `data/catalog/v1/*.json`,
not a scripted demo.

## What's here

- **`index.html` / `scripts.js` / `styles.css`** — the site shell: hero,
  search widget, Cricket World Cup 2027 fan packages, Taj Holidays, Maharaja
  Club loyalty banner, Tata ecosystem strip.
- **`guzo/`** — the AI trip-planning assistant frontend (chat UI, intent
  parsing, itinerary building), running fully client-side against the catalog.
- **`data/catalog/v1/`** — the actual content: destinations, packages, day-by-
  day itinerary modules, flight routes, and the journey graph connecting them.
- **`infrastructure/`** — the real AWS Lambda backend for the AI assistant
  (OpenRouter-powered). Not deployed or rebranded for this demo — see
  `CLAUDE.md` → "Known gaps" before ever wiring it up live.

See [`CLAUDE.md`](CLAUDE.md) for full architecture notes and
[`DEPLOY.md`](DEPLOY.md) for hosting (Cloudflare Pages / AWS Amplify).

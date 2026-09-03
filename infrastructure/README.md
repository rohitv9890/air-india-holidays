# Guzo backend (AWS SAM)

HTTP API + Lambda (`guzo-chat-handler`) + DynamoDB sessions + OpenRouter + catalog tools.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/guzo/health` | Health check |
| `POST` | `/guzo/session` | Create or refresh session (24h TTL); may include `itinerary` |
| `POST` | `/guzo/chat` | SSE chat stream |
| `GET` | `/guzo/catalog/search?q=&type=&destination=` | Search versioned Ethiopia catalog |
| `GET` | `/guzo/catalog/product/:id` | Product by path id (also `?id=`) |
| `POST` | `/guzo/itinerary` | Build itinerary (`packageId`, `originIata`, `startDate`, `adults`, …) |
| `GET` | `/guzo/itinerary?id=` | Retrieve itinerary from process memory; optional `&sessionId=` for DynamoDB session |

`GET /guzo/itinerary` is best-effort: the in-memory map is per Lambda instance. Prefer storing `itinerary` on the session (chat/`POST` with `sessionId`) for durability within the 24h TTL.

### Chat SSE events

```
data: {"type":"text_delta","content":"..."}
data: {"type":"intent_update","intent":{...}}
data: {"type":"recommendations","items":[...]}
data: {"type":"trip_summary","summary":{...}}
data: {"type":"itinerary_ready","itinerary":{"id":"...",...}}
data: {"type":"error","message":"..."}
data: {"type":"done"}
```

## Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) configured
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- OpenRouter API key

## Deploy

```bash
cd infrastructure
npm install --prefix lambda/guzo-chat-handler
sam build
sam deploy --guided
```

On first deploy, note the **ApiUrl** output.

### Set OpenRouter key

After deploy, update the secret (do not commit real keys):

```bash
aws secretsmanager put-secret-value \
  --secret-id guzo/openrouter-api-key-dev \
  --secret-string '{"OPENROUTER_API_KEY":"sk-or-..."}'
```

Replace `dev` with your `Environment` parameter value.

### CORS / production origin

Redeploy with your site origin:

```bash
sam deploy --parameter-overrides \
  CorsAllowOrigins="http://localhost:5500,https://your-production-domain.com"
```

## Frontend configuration

In `guzo/guzo-config.js`:

```js
export const GUZO_CONFIG = {
    mockMode: false,
    apiUrl: 'https://YOUR_API_ID.execute-api.REGION.amazonaws.com',
    // ...
};
```

Leave `mockMode: true` for local development without AWS.

## Local testing

### Health (after deploy)

```bash
curl https://YOUR_API.execute-api.REGION.amazonaws.com/guzo/health
```

### Session

```bash
curl -X POST https://YOUR_API.execute-api.REGION.amazonaws.com/guzo/session \
  -H "Content-Type: application/json" \
  -d '{"tab":"packages"}'
```

### Catalog search

```bash
curl "https://YOUR_API.execute-api.REGION.amazonaws.com/guzo/catalog/search?q=lalibela&type=package"
```

### Build itinerary

```bash
curl -X POST https://YOUR_API.execute-api.REGION.amazonaws.com/guzo/itinerary \
  -H "Content-Type: application/json" \
  -d '{"originIata":"LHR","startDate":"2026-10-01","adults":2,"destination":"Lalibela"}'
```

### Chat (SSE)

```bash
curl -N -X POST https://YOUR_API.execute-api.REGION.amazonaws.com/guzo/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"guzo_test","tab":"packages","message":"Weekend trip to Lalibela from Frankfurt"}'
```

### Unit tests

```bash
npm test --prefix lambda/guzo-chat-handler
```

### SAM local (limited)

`sam local start-api` does not fully support Lambda response streaming; use deployed API for SSE tests.

## Stack resources

- **Lambda**: `guzo-chat-handler-{env}` — OpenRouter streaming, tools (`search_places`, `extract_trip_intent`, `update_package_intent`, `search_catalog`, `get_product`, `compose_itinerary`, `quote_trip`)
- **DynamoDB**: `guzo-sessions-{env}` — session intent, optional itinerary, message history, TTL 24h
- **Secrets Manager**: `guzo/openrouter-api-key-{env}`
- **HTTP API**: CORS-enabled routes under `/guzo/*`
- **Catalog**: packaged under `lambda/guzo-chat-handler/data/catalog/v1/` (synced from repo `data/catalog/v1/` via `node scripts/sync-catalog-to-lambda.mjs`). Merge Hermes staging with `node scripts/merge-hermes-import-bundle.mjs` before sync. Override with `CATALOG_PATH` / `CATALOG_DIR` if needed.

## Environment variables (Lambda)

| Variable | Default | Purpose |
|----------|---------|---------|
| `GUZO_MODEL` | `openai/gpt-5.6-luna` | OpenRouter model |
| `OPENROUTER_API_KEY` | (local `.env`) | Direct key override (preferred for local) |
| `EASYGDS_API_BASE` | `https://demo.apps.easygds.com/api` | Places search proxy |
| `SESSIONS_TABLE` | (from stack) | DynamoDB table name; omit for in-memory local sessions |
| `OPENROUTER_SECRET_ARN` | (from stack) | API key secret (AWS) |
| `CATALOG_PATH` | relative `data/catalog/v1/catalog.json` | Catalog JSON path |

## Local OpenRouter server

```bash
cp infrastructure/.env.example infrastructure/.env
# put OPENROUTER_API_KEY in infrastructure/.env
node scripts/guzo-local-server.mjs
```

Then set `guzo/guzo-config.js` to `mockMode: false` and `apiUrl: 'http://localhost:8787'`.

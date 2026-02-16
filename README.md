# Xpire

Xpire helps households track perishable items, highlight what will expire soon, and remove stale inventory quickly.

## Stack

- `client/`: Vite + React dashboard for item management.
- `server/`: Express API with JSON-file persistence.

## API Endpoints

- `GET /health`: service heartbeat.
- `GET /api/items?status=all|fresh|expiring|expired`: list items with computed status and days left.
- `POST /api/items`: create an item.
- `PATCH /api/items/:id`: update an item.
- `DELETE /api/items/:id`: remove an item.

## Production Hardening Included

- Request-size limit and malformed JSON handling.
- CORS allowlist with explicit origin enforcement.
- IP-based in-memory rate limiting headers + 429 protection.
- Security response headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`).
- Stronger item normalization and field length caps.

## Run Locally

Install dependencies:

```bash
npm ci --prefix server
npm ci --prefix client
```

Start API:

```bash
npm --prefix server start
```

Start web app (new terminal):

```bash
npm --prefix client dev
```

By default, the client calls `http://localhost:4000`.  
Override with `VITE_API_URL`.

### Data Storage

- Runtime data is persisted to `server/data/runtime/items.json` (git-ignored).
- Initial seed data is loaded from `server/data/seed-items.json` when runtime data does not exist.
- Optional environment overrides:
  - `XPIRE_DATA_FILE`: custom runtime file path.
  - `XPIRE_SEED_FILE`: custom seed file path.
  - `XPIRE_ALLOWED_ORIGINS`: comma-separated CORS allowlist.
  - `XPIRE_RATE_LIMIT_WINDOW_MS`: request rate-limit window in milliseconds.
  - `XPIRE_RATE_LIMIT_MAX_REQUESTS`: max requests per window and IP.

## Validation Commands

Server smoke tests:

```bash
npm --prefix server test
```

Client unit tests:

```bash
npm --prefix client test
```

Client production build:

```bash
npm --prefix client run build
```

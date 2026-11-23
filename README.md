# BuildLedger

Construction accounting and project management for a residential home builder: per-home job costing, vendor bills,
check writing and printing, client invoices, lien waivers, documents, mileage, and accountant-ready reports — on one
double-entry general ledger.

See **ARCHITECTURE.md** for how it is built and **PROGRESS.md** for exactly what works, how it was verified, and what is not built yet.

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first visit asks for your company name and creates the owner account.
No database server is needed locally: an embedded PostgreSQL (PGlite) stores everything in `./.data/`.
**Back up the `.data` folder** — it holds the database, uploaded files and the encryption key.

## Run it for real (production)

1. Create a PostgreSQL 14+ database (a managed service with automatic daily backups is strongly recommended).
2. Host the app on a server or container with a **persistent disk** for uploaded files (a VPS, Render, Fly.io, Railway…).
   Serverless hosts without a persistent disk will lose uploads until an object-storage adapter is added.
3. Copy `.env.example` to `.env` and set:
   - `DATABASE_URL` — your Postgres connection string
   - `APP_SECRET` — a long random string (`openssl rand -hex 32`). It encrypts bank and tax ID numbers. Store a copy safely; never change it.
   - `STORAGE_DIR` — a folder on the persistent disk
4. `npm run build && npm start`, behind HTTPS (session cookies are HTTPS-only in production).
5. Back up both the database and `STORAGE_DIR` on a schedule, and test a restore.

Database tables are created and upgraded automatically at startup from the `drizzle/` migrations.

### One-click version: Render

The repository includes `render.yaml`. In Render choose **New > Blueprint**, pick this repository and apply. It creates the
web service, a 5 GB private disk for uploads, a PostgreSQL database, and a generated `APP_SECRET`. Afterwards copy the
`APP_SECRET` value from the service's Environment tab and keep it somewhere safe.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Runs the accounting workflow tests against a throw-away in-memory database |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:generate` | After editing `src/db/schema.ts`, generates the next SQL migration |

## Optional: automatic invoice reading

Set `ANTHROPIC_API_KEY` and a "Fill in from this document" button appears when you attach a PDF or photo to a bill.
It only pre-fills the form; a person confirms every value. Without the key the feature is simply hidden.

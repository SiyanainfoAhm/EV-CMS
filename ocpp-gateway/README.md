# EV-CMS OCPP Gateway (Phase 1)

OCPP 1.6J WebSocket gateway + REST API for the DFCCIL EV-CMS.

## Quick start

```bash
cd ocpp-gateway
cp .env.example .env
# Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role — server only)
npm install
npm run dev
```

- Health: `GET http://localhost:4040/health`
- REST API: `http://localhost:4040/ocpp/*` (matches web `ocppService.ts`)
- OCPP WebSocket: `ws://localhost:4040/ocpp/<CHARGE_POINT_ID>`

Example: `ws://localhost:4040/ocpp/MP-DC-001`

## Phase 1 implemented

| OCPP (inbound from charger) | REST (from web admin) |
|-----------------------------|------------------------|
| BootNotification | `POST /ocpp/remote-start` |
| Heartbeat | `POST /ocpp/remote-stop` |
| StatusNotification | `POST /ocpp/reset` |
| Authorize | `POST /ocpp/unlock` |
| StartTransaction | `POST /ocpp/change-configuration` |
| StopTransaction | `POST /ocpp/trigger-meter-values` |
| MeterValues | `GET /ocpp/chargers/:id/status` |

All charger events sync to Supabase `EV_Chargers`, `EV_ChargerConnectors`, `EV_ChargingSessions`, `EV_MeterValues`, `EV_ChargerEvents`.

## Web app

Root `.env`:

```
VITE_OCPP_GATEWAY_API_URL=http://localhost:4040
```

Charger detail page remote commands call the gateway REST API.

## Test without physical charger

1. Register a charger in admin (e.g. charge point `MP-TEST-001`)
2. Start gateway with Supabase credentials
3. Run test client:

```bash
node scripts/ocpp-test-client.mjs MP-TEST-001
```

4. Use admin **Remote Start** on that charger (requires connected test client)

## Docker

```bash
docker build -t ev-cms-ocpp-gateway .
docker run -p 4040:4040 --env-file .env ev-cms-ocpp-gateway
```

## Deploy on Fly.io (recommended, ~$4/mo, Mumbai)

Full guide: **[FLY_DEPLOY.md](./FLY_DEPLOY.md)**

```powershell
fly auth login
fly secrets set SUPABASE_URL="https://fvveqziyusjgqejowkfp.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<key>"
fly deploy
```

- REST: `https://ev-cms-ocpp-dfccil.fly.dev`
- Charger: `wss://ev-cms-ocpp-dfccil.fly.dev/ocpp/<CHARGE_POINT_ID>`
- Vercel: `VITE_OCPP_GATEWAY_API_URL=https://ev-cms-ocpp-dfccil.fly.dev`

No local PC or Cloudflare tunnel required in production.

## Deploy on Railway (low-cost, ~$5/mo)

Railway runs the gateway 24/7 with HTTPS/WSS — required for OCPP chargers.

### 1. Create project

1. Sign in at [railway.app](https://railway.app) (GitHub login).
2. **New Project** → **Deploy from GitHub repo** → select `EV-CMS`.
3. Open the new service → **Settings** → **Root Directory** = `ocpp-gateway`.
4. **Settings** → **Build** → builder should detect `Dockerfile` (or use `railway.toml`).

### 2. Environment variables

In **Variables**, add (never commit the service role key):

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | `https://fvveqziyusjgqejowkfp.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase **service role** key (Dashboard → Settings → API) |
| `OCPP_WS_PATH` | `/ocpp` |

Railway sets `PORT` automatically — do not hardcode it.

### 3. Public URL

1. **Settings** → **Networking** → **Generate Domain**.
2. Note the URL, e.g. `https://ev-cms-ocpp-production.up.railway.app`.

### 4. Wire web admin (Vercel)

In Vercel project env:

```
VITE_OCPP_GATEWAY_API_URL=https://<your-railway-domain>
```

Redeploy the web app after saving.

### 5. Charger WebSocket URL

Per charger (use the charge point ID from admin):

```
wss://<your-railway-domain>/ocpp/<CHARGE_POINT_ID>
```

Example: `wss://ev-cms-ocpp-production.up.railway.app/ocpp/DL-SI-001`

### 6. Verify

```bash
curl https://<your-railway-domain>/health
```

Expected: `{"ok":true,"service":"ev-cms-ocpp-gateway",...}`

Test OCPP (from `ocpp-gateway` folder):

```bash
set OCPP_GATEWAY_WS=wss://<your-railway-domain>
node scripts/ocpp-test-client.mjs DL-SI-001
```

In web admin → **Chargers** → fleet/OCPP status should show the charger connected after BootNotification.

### 7. Optional custom domain

Railway **Settings** → **Networking** → add `ocpp.yourdomain.com` (CNAME to Railway). Use that host in Vercel and on chargers.

## Still TODO (Phase 1 tail)

- TLS 1.2/1.3 WSS in production (`TLS_CERT_PATH`, `TLS_KEY_PATH`)
- Smart Charging profiles (Set/Clear ChargingProfile)
- Physical lab validation (MyPower Experts + Tri Square)
- Staging deploy + monitoring

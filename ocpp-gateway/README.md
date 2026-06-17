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

## Still TODO (Phase 1 tail)

- TLS 1.2/1.3 WSS in production (`TLS_CERT_PATH`, `TLS_KEY_PATH`)
- Smart Charging profiles (Set/Clear ChargingProfile)
- Physical lab validation (MyPower Experts + Tri Square)
- Staging deploy + monitoring

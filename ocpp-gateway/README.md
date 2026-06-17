# EV-CMS OCPP Gateway (Phase 0 scaffold)

OCPP 1.6J WebSocket gateway + REST API for the DFCCIL EV-CMS.

## Quick start

```bash
cd ocpp-gateway
cp .env.example .env
npm install
npm run dev
```

- Health: http://localhost:4040/health
- REST stubs: http://localhost:4040/ocpp/* (matches web `ocppService.ts`)
- OCPP WebSocket: `ws://localhost:4040/ocpp` (handler in Phase 1)

## Web app connection

Set in project root `.env`:

```
VITE_OCPP_GATEWAY_API_URL=http://localhost:4040
```

## Docker

```bash
docker build -t ev-cms-ocpp-gateway .
docker run -p 4040:4040 --env-file .env ev-cms-ocpp-gateway
```

## Phase 1 tasks

See `Documents/EV-CMS-Project-Completion-Plan.md` — implement OCPP Core messages and Supabase sync.

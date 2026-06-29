# Deploy OCPP Gateway on Fly.io

Always-on OCPP 1.6J WebSocket + REST API for DFCCIL EV-CMS (~$4/month, Mumbai).

## Prerequisites

1. [Fly.io account](https://fly.io/app/sign-up) + credit card (pay-as-you-go, ~$3–5/mo)
2. Fly CLI installed (see below)
3. Supabase **service role** key (Dashboard → Settings → API)

## 1. Install Fly CLI (Windows)

PowerShell:

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Close and reopen the terminal, then:

```powershell
fly version
fly auth login
```

## 2. Create app (first time only)

```powershell
cd c:\Jatin\Projects\EV-CMS\EV-CMS-Project\ocpp-gateway
fly apps create ev-cms-ocpp-dfccil
```

If the name is taken, edit `app` in `fly.toml` to a unique name and run `fly apps create <your-name>`.

## 3. Set secrets

```powershell
fly secrets set SUPABASE_URL="https://fvveqziyusjgqejowkfp.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
```

Never commit the service role key to Git.

## 4. Deploy

```powershell
fly deploy
```

First deploy builds the Docker image and starts the machine in **Mumbai (`bom`)**.

## 5. Verify

```powershell
fly status
fly logs
curl.exe https://ev-cms-ocpp-dfccil.fly.dev/health
```

Expected:

```json
{"ok":true,"service":"ev-cms-ocpp-gateway","supabase":true,...}
```

Your public URLs:

| Use | URL |
|-----|-----|
| REST / health | `https://ev-cms-ocpp-dfccil.fly.dev` |
| Charger WSS | `wss://ev-cms-ocpp-dfccil.fly.dev/ocpp/<CHARGE_POINT_ID>` |

Example: `wss://ev-cms-ocpp-dfccil.fly.dev/ocpp/DL-SI-001`

## 6. Web admin (Vercel)

Set environment variable and redeploy:

```
VITE_OCPP_GATEWAY_API_URL=https://ev-cms-ocpp-dfccil.fly.dev
```

## 7. Test OCPP (optional)

```powershell
$env:OCPP_GATEWAY_WS="wss://ev-cms-ocpp-dfccil.fly.dev"
node scripts/ocpp-test-client.mjs DL-SI-001
```

### Temporary RFID bypass (lab testing only)

Accept any idTag on `Authorize` / `StartTransaction` without checking `EV_RFIDCards`:

```powershell
fly secrets set OCPP_BYPASS_RFID_AUTH=true -a ev-cms-ocpp-dfccil
fly deploy
curl.exe https://ev-cms-ocpp-dfccil.fly.dev/health
```

Health should show `"bypassRfidAuth": true`. **Turn off after testing:**

```powershell
fly secrets unset OCPP_BYPASS_RFID_AUTH -a ev-cms-ocpp-dfccil
fly deploy
```

This does **not** bypass RFID checks inside the physical charger firmware.

## Custom domain (optional)

```powershell
fly certs add ocpp.yourdomain.com
```

Add the CNAME Fly shows in your DNS. Then use `wss://ocpp.yourdomain.com/ocpp/...`.

## Useful commands

```powershell
fly deploy          # redeploy after code changes
fly logs            # live logs
fly secrets list    # check secrets exist (values hidden)
fly scale count 1   # ensure one always-on machine
fly apps restart ev-cms-ocpp-dfccil
```

## Cost

- **512 MB shared CPU**, always on: ~**$4/month** (~$48/year)
- 12 chargers use **one** gateway — no per-charger fee

## No local tunnel

Production uses Fly directly. You do **not** need Cloudflare quick tunnel or a local PC running 24/7.

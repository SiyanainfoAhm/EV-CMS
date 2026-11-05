# DFCCIL EV CMS

Web dashboard, mobile application, and protected mobile SSO/payment APIs.

See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting configuration, database steps, and release verification.

```sh
npm ci
cd mobile && npm ci && cd ..
npm run check:deployment
```

Real DFCCIL payments remain disabled until deployment verification and an approved controlled live test. Server-side Status API verification is implemented.

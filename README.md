#  Abasthan

 WebSocket server (Node.js) for Abasthan PaaS free tier.

## Deploy

1. Push this repo to GitHub, connect it in Abasthan dashboard → Create App.
2. Set environment variables in Abasthan:
   - `UUID` — the VLESS UUID (e.g. `51a0af77-a60c-4d9b-81a4-f50e1b38d90b`)
   - `WS_PATH` — WebSocket path (default `/`, e.g. `/?ed=2560` is a query, path is `/`)
3. Abasthan builds (`npm install`) and runs `npm start`, serves at `https://<app>.abasthan.app` with free SSL.

## Client link

```
vless://<UUID>@<app>.abasthan.app:443?encryption=none&security=tls&sni=<app>.abasthan.app&fp=chrome&type=ws&host=<app>.abasthan.app&path=%2F%3Fed%3D2560#Abasthan
```

(Adjust `path` to match `WS_PATH`. Abasthan terminates TLS; the app itself sees plain WS.)

## Notes

- Free tier sleeps after 90 minutes with no traffic; first visit after sleep shows a loading page. Paid plans are always-on.
- TCP fully supported; UDP (DNS etc.) via VLESS length-prefixed packets.
- Health check: `GET /` returns `ok`.

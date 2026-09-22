# s2h export

Generated API server for the `__HARNESS_NAME__` harness (v`__HARNESS_VERSION__`).

## Run

```bash
npm install
npm run build
cp .env.example .env   # then edit model/provider credentials
npm start
```

The server listens on `PORT` (default `8080`).

## Endpoints

- `GET /healthz`
- `GET /api/harness`
- `GET /api/skills`
- `GET /api/docs`
- `GET /api/docs/:name`
- `POST /api/chat` (SSE)
- `POST /api/sessions/:id/input`
- `POST /api/sessions/:id/cancel`
- `DELETE /api/sessions/:id`

See the sop2harness `docs/EXPORT_RUNTIME.md` for the event and request shapes.

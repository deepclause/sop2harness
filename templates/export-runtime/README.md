# s2h export

Generated API server and chat web app for the `__HARNESS_NAME__` harness
(v`__HARNESS_VERSION__`).

## Run locally

```bash
npm install
npm run build
cp .env.example .env   # then edit model/provider credentials
npm start
```

Open `http://localhost:8080/` for the chat web app.

## Run with Docker

```bash
cp .env.example .env   # then edit model/provider credentials
docker compose up --build
```

## Endpoints

- `GET /` (chat web app)
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

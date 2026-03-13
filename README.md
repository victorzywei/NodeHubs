# nodehubsapi

New control plane for dual deployment targets:

- Cloudflare: Workers + D1 + R2 + Workers Assets
- Docker on a single VPS: Node + SQLite + MinIO

This project is greenfield. It does not preserve old project parameter names or old release payloads.

## What is implemented

- Node, template, and subscription CRUD
- Runtime releases only; node install parameters are managed on the node itself
- Release publishing with real artifact generation
- Protocol template preset catalog
- Public subscription endpoint that only reads healthy current releases
- Agent heartbeat, env-based reconcile, release apply script, and release ack
- Agent install script generation for a generic systemd-managed polling agent
- Runtime binaries installed from upstream release archives instead of OS packages
- Basic telemetry persistence for bytes, connections, CPU, and memory
- Shared backend for Cloudflare Worker and Node runtime

## Core API

- `GET /api/system/status`
- `GET/POST /api/nodes`
- `GET/PATCH /api/nodes/:id`
- `GET /api/nodes/:id/releases`
- `POST /api/nodes/:id/releases`
- `GET /api/nodes/:id/traffic`
- `GET /api/nodes/:id/install-script`
- `GET /api/templates/catalog`
- `GET/POST /api/templates`
- `PATCH /api/templates/:id`
- `GET/POST /api/subscriptions`
- `GET /sub/:token?format=plain|base64|json`

Agent endpoints:

- `POST /api/nodes/agent/heartbeat`
- `GET /api/nodes/agent/reconcile?nodeId=...`
- `GET /api/nodes/agent/reconcile?nodeId=...&format=env`
- `GET /api/nodes/agent/releases/:releaseId/apply-script?nodeId=...`
- `POST /api/nodes/agent/releases/:releaseId/ack`

## Local development

```bash
npm install
npm run db:sqlite:init
npm run dev:api
npm run dev:web
```

Default local URLs:

- API: `http://127.0.0.1:3000`
- Web: `http://127.0.0.1:5173`

If the web app should call a separate local API:

```bash
set VITE_API_BASE=http://127.0.0.1:3000
```

For the Pages Functions + KV panel layer in `apps/web`:

1. Copy the Pages env template:

```bash
copy apps\web\.dev.vars.example apps\web\.dev.vars
```

2. Create a KV namespace and fill its id in `apps/web/wrangler.jsonc`
3. Build the Vite app:

```bash
npm run build -w apps/web
```

4. Start Pages local dev from `apps/web`:

```bash
npm run pages:dev -w apps/web
```

## Docker deployment

1. Copy env file:

```bash
copy .env.example .env
```

2. Start services:

```bash
docker compose up --build
```

Containers:

- `app`: Node API + built web assets
- `minio`: object storage
- `minio-init`: bucket bootstrap

Persistent volumes:

- `sqlite_data`
- `minio_data`

## Cloudflare deployment

1. Build the web assets:

```bash
npm run build -w apps/web
```

2. Fill real bindings in `apps/api/wrangler.jsonc`
3. Initialize D1:

```bash
wrangler d1 execute DB --file=apps/api/migrations/0001_init.sql
```

4. Deploy:

```bash
wrangler deploy --config apps/api/wrangler.jsonc
```

Use `apps/api/.dev.vars.example` as the local Worker env template.

### Pages panel with Functions + KV

The Vite frontend in `apps/web` now supports a lightweight Pages Functions layer for storing backend profiles in KV. The UI still connects directly to each selected target backend; Pages Functions only handles panel auth and KV-backed backend profile persistence.

1. Create a KV namespace and put its id in `apps/web/wrangler.jsonc`
2. Set the panel secrets in your Pages project:

```bash
PANEL_PASSWORD=your-panel-password
PANEL_SESSION_SECRET=optional-session-secret
```

3. Build the web assets:

```bash
npm run build -w apps/web
```

4. Deploy the Pages site from `apps/web/dist`:

```bash
npm run pages:deploy -w apps/web
```

## Current release model

- A node can only publish templates from one runtime engine per release.
- Supported rendered protocols today: `vless`, `trojan`, `shadowsocks`
- Supported rendered transports today: `ws`, `grpc`, `tcp`
- Public subscriptions read only `healthy` releases that match the node's `current_release_revision`
- Release artifacts store rendered runtime files, pinned runtime binary metadata, and subscription URIs
- The generated agent install script downloads the agent and runtime binaries directly from upstream releases
- When `installWarp` is enabled, the installer uses the host package manager to install the official Cloudflare WARP client
- The generated agent uses `curl`, `wget`, or `busybox wget` and falls back to `unzip`, `bsdtar`, `python3`, or `busybox unzip` for zip archives
- Hooks can be dropped into `/etc/nodehubsapi/hooks/pre-apply.d` and `/etc/nodehubsapi/hooks/post-apply.d`

## Validation

The current repo passes:

- `npm run typecheck`
- `npm test`
- `npm run build`

## Remaining work

- Add richer protocol renderers beyond the current supported set
- Add release rollback and timeout jobs
- Add aggregated traffic rollups
- Add one-time install tickets instead of long-lived install scripts if you want stronger install security

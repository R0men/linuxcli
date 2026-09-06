# LinuxCLI — Backend

Backend for a disposable, isolated Linux CLI: a user in the browser types one read-only diagnostic/OSINT command (`dig`, `curl`, `whois`, `openssl s_client`, `mtr`, `ping`, `nc`, `host`), the backend runs it in a one-shot Docker container (`cap-drop=ALL`, seccomp, read-only rootfs) and destroys the container immediately. No shell access, no persistent state, no active port scanning.

**Frontend:** separate project `../frontend` (xterm.js over WebSocket, static export on Cloudflare Pages) · **Deploy:** VPS, systemd + Docker Engine API · **Runtime:** Node.js ≥ 20 (vanilla, minimal dependencies)

---

## Contents

1. [Tech stack](#tech-stack)
2. [Project structure](#project-structure)
3. [Architecture](#architecture)
4. [Setup and running](#setup-and-running)
5. [Environment variables](#environment-variables)
6. [Documentation](#documentation)

---

## Tech stack

| Category | Technology | Version |
|-----------|------------|--------|
| Runtime | Node.js | ≥ 20 (`type: module`) |
| Execution isolation | Docker Engine API (`dockerode`) | 4.0.2 |
| WebSocket | `ws` | 8.18.0 |
| DB (audit log, API keys) | MongoDB (`mongodb`) | 6.9.0 |
| DB (rate-limit, pool state) | Redis (`ioredis`) | 5.4.1 |
| Anti-bot | Cloudflare Turnstile | — |
| Tests | `node:test` (built-in, zero extra deps) | — |
| Linter | ESLint (`eslint:recommended`) | 10.8.1 |

**Notable design choices:**

- Not a single call goes through a shell (`sh -c`, `{shell: true}`) anywhere in the codebase — a command is parsed into `{ binary, args: [] }` and run directly inside the sandbox; this is the single most important security invariant of the project
- Command Validator — an extensible tool registry: each tool is its own module with `argSchema`/`hardLimits`/`timeoutMs`; adding a new tool never touches the Validator/Orchestrator core
- Anonymous access by default (IP-based rate limiting + Turnstile), an optional API key for higher limits — no mandatory registration
- Sandbox containers run from a pre-warmed pool with a hard `SANDBOX_MAX_CONCURRENT` ceiling; each one is destroyed right after use (`finally`, regardless of outcome)

> `TECH.md` is the single source of truth for architectural decisions (isolation, tool whitelist, DB choice).

---

## Project structure

```
backend/
│
├── src/
│   ├── index.js                      # Entry point
│   ├── config.js                     # env config, every numeric limit lives here
│   ├── logger.js                     # Lightweight leveled logger (info/warn/error)
│   │
│   ├── gateway/                      # HTTP+WebSocket entry point
│   │   ├── server.js                 #   REST: session start, health/status
│   │   ├── wsHandler.js              #   WS: terminal channel, running-guard (one exec at a time)
│   │   └── clientIp.js               #   Origin check, trusted X-Forwarded-For
│   │
│   ├── validator/                    # Command Validator — no shell, no Docker/DB dependencies
│   │   ├── tokenize.js, validate.js, registry.js, net.js, errors.js
│   │   └── tools/                    #   dig, curl, whois, host, openssl, mtr, ping, nc
│   │
│   ├── orchestrator/                 # Docker sandbox pool, one-shot container lifecycle
│   │   ├── pool.js, sandbox.js, dockerClient.js, containerConfig.js
│   │
│   ├── abuse/                        # Rate limiting, anti-bot, optional API key
│   │   ├── rateLimiter.js, turnstile.js, apiKey.js, ipHash.js
│   │
│   ├── audit/logger.js               # Insert-only log of executed commands, TTL retention
│   └── db/                           # mongo.js, redis.js — raw singleton clients
│
├── test/                             # node:test — against fake-docker/fake-Mongo, no live infra required
│   ├── validator.test.js             #   21 cases covering all tools
│   ├── pool.test.js                  #   maxConcurrent ceiling, PoolExhaustedError
│   └── apiKey.test.js                #   1 live key per ipHash, sliding TTL
│
├── docker/sandbox.Dockerfile         # Sandbox container image with whitelisted tools
│
├── deploy/                           # systemd units + VPS setup scripts
│   ├── linuxcli-backend.service      #   ProtectSystem=strict, CapabilityBoundingSet=, MemoryMax, etc.
│   ├── sandbox-network.service       #   Docker network with egress filtering for sandbox containers
│   └── {finish-server-setup,setup-sandbox-network}.sh
│
├── docs/                             # Project documentation — see "Documentation" below
├── eslint.config.js                  # eslint:recommended, Node globals declared manually
└── TECH.md                           # Architecture, decisions, security model, MVP tool list
```

---

## Architecture

```
┌────────────┐      HTTPS/WSS      ┌────────────────────┐
│  Frontend  │◄───────────────────►│    API Gateway       │
│ (xterm.js) │                     │  (Node.js, ws)        │
└────────────┘                     └──────────┬────────────┘
                                               │
                    ┌──────────────────────────┼───────────────────────────┐
                    ▼                          ▼                           ▼
            ┌───────────────┐         ┌─────────────────┐         ┌────────────────┐
            │  Anti-abuse    │         │ Command Validator │         │  Audit Logger   │
            │ (rate-limit,   │         │  (whitelist +      │         │ (MongoDB,       │
            │  Turnstile,    │         │   per-tool arg-     │         │  insert-only)   │
            │  opt. API key) │         │   schema, no shell)  │         └────────────────┘
            └───────────────┘         └──────────┬──────────┘
                                                  ▼
                                       ┌────────────────────┐
                                       │ Sandbox Orchestrator │
                                       │ (Docker Engine API)  │
                                       └──────────┬───────────┘
                                                  ▼
                                       ┌────────────────────────┐
                                       │  Pre-warmed pool          │
                                       │  of Docker containers      │
                                       │  (cap-drop=ALL, seccomp,    │
                                       │   read-only rootfs,          │
                                       │   egress-filtered network)   │
                                       └────────────────────────────┘
```

One `exec` frame's journey: `wsHandler` holds a running-guard (one exec at a time per connection) → `ensureChallenge()` (Turnstile) → `checkRateLimit()` (Redis) → `validateCommand()` (whitelist + arg schema) → `runCommand()` via the pool → streamed `chunk` frames → `done` (exitCode, durationMs) → `logCommand()` into the audit log → `pool.destroy()` on the container **always**, in `finally`, regardless of outcome. A module-by-module breakdown, including issues already fixed and remaining trade-offs found during a critical code review, lives in [`docs/architecture/README.md`](docs/architecture/README.md).

---

## Setup and running

```bash
npm install
```

### Development

```bash
npm run dev
```

`node --watch src/index.js` — requires Docker, MongoDB and Redis running locally (see [`docs/SETUP.md`](docs/SETUP.md) and `.env.example`).

### Production

```bash
npm start
```

Deployment target: a plain VPS — Docker Engine, Node ≥ 20, MongoDB, Redis, a separate Docker network with egress filtering for sandbox containers, systemd units from `deploy/` (`linuxcli-backend.service`, `sandbox-network.service`). Auto-deploy via `../.github/workflows/deploy-backend.yml` (repo root — GitHub Actions only reads workflows from there) on push to `main`. Full step-by-step guide — [`docs/SETUP.md`](docs/SETUP.md).

### Tests and lint

```bash
npm test    # node:test — validator (21 cases), pool, apiKey — against fake-docker/fake-Mongo
npm run lint
```

---

## Environment variables

Full annotated list — [`.env.example`](.env.example). Key groups:

| Group | Variables |
|---|---|
| Server | `HOST`, `PORT`, `ALLOWED_ORIGINS` (frontend domains allowed for the WS handshake) |
| DB | `MONGO_URL`, `MONGO_DB`, `REDIS_URL` |
| Sandbox | `DOCKER_SOCKET`, `SANDBOX_IMAGE`, `SANDBOX_NETWORK`, `SANDBOX_POOL_MIN`, `SANDBOX_POOL_LOW_WATERMARK`, `SANDBOX_MAX_CONCURRENT` |
| Execution limits | `COMMAND_TIMEOUT_MS`, `MAX_OUTPUT_BYTES`, `WS_MAX_PAYLOAD_BYTES` |
| Rate limiting | `RATE_LIMIT_ANON_PER_MIN/HOUR`, `RATE_LIMIT_KEY_PER_MIN/HOUR` |
| Anti-abuse | `TURNSTILE_SECRET_KEY`, `TURNSTILE_REQUIRED_EVERY_N_COMMANDS/MS`, `IP_HASH_SECRET`, `API_KEY_IDLE_TTL_SECONDS` |
| Audit | `AUDIT_LOG_RETENTION_SECONDS` |

> `.env` holds real secrets (Mongo/Redis credentials, `IP_HASH_SECRET`, `TURNSTILE_SECRET_KEY`) and is never committed — only `.env.example` ships as a value-less template.

---

## Documentation

| Document | Description |
|----------|--------------|
| [`TECH.md`](TECH.md) | Single source of truth: problem/goals/non-goals, decisions made, MVP tool list and their allowlist schemas |
| [`docs/architecture/README.md`](docs/architecture/README.md) | Module-by-module index (`gateway/`, `validator/`, `orchestrator/`, `abuse/`, `audit/`, `db/`) — how the code works, file by file, including issues found and fixed |
| [`docs/SETUP.md`](docs/SETUP.md) | Step-by-step deploy onto a bare VPS: Docker, Node, Mongo, Redis, sandbox network, systemd units |
| [`docs/VERIFY.md`](docs/VERIFY.md) | How to verify each component on a real Linux host (sandbox image, egress filtering, orchestrator pool, validator, Mongo/Redis) |
| [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md) | Registering GitHub/Google OAuth apps, wiring `client_id`/`client_secret` |

Deeper architecture notes (`docs/architecture/*.md`) are written in Ukrainian as part of this project's normal working process.

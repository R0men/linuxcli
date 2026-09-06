# LinuxCLI

**A real Linux terminal in your browser — no install, no signup.**

Type a read-only network diagnostic command — `dig`, `curl`, `whois`, `openssl s_client`, `mtr`, `ping`, `nc`, `host` — and it runs inside a disposable, sandboxed Docker container that's destroyed the instant your command finishes. No shell access, no persistent state, no account required.

**Live:** [linuxcli.xyz](https://linuxcli.xyz)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](backend/package.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](frontend/package.json)

---

## What this is

Web developers and sysadmins often need to run one quick network diagnostic — check a DNS record, hit an endpoint with `curl`, inspect a TLS handshake — but don't have a Linux box handy, or don't want to install a toolkit for a single command. LinuxCLI hands out a one-shot, isolated Linux CLI in the browser: one session runs exactly one whitelisted command, then the sandbox self-destructs. No shell for arbitrary scripts, no scanning tools, no state left behind.

This repo is a monorepo of the two halves of the product:

| | |
|---|---|
| [`backend/`](backend) | Node.js API + WebSocket gateway that validates, sandboxes and executes each command |
| [`frontend/`](frontend) | Next.js static site with an xterm.js terminal, SEO content, and optional account/login |

Each has its own `README.md` and `TECH.md` with the full design rationale — this file is the map.

## How it works

```
Browser (xterm.js) ──WSS──▶ API Gateway ──▶ Anti-abuse ──▶ Command Validator ──▶ Sandbox Orchestrator
                                          (rate-limit,      (whitelist +           (Docker Engine API)
                                           Turnstile,        per-tool arg               │
                                           opt. API key)     schema, no shell)           ▼
                                                                              ┌─────────────────────────┐
                                                                              │   pre-warmed pool of      │
                                                                              │   Docker containers        │
                                                                              │   cap-drop=ALL · seccomp    │
                                                                              │   read-only rootfs ·         │
                                                                              │   egress-filtered network      │
                                                                              └─────────────────────────────┘
                                                                                          │
                                                                          exit code + output ──▶ Audit Logger (MongoDB, insert-only)
                                                                                          │
                                                                          container destroyed, always, in `finally`
```

One `exec` frame's journey: the gateway holds a running-guard (one command at a time per connection) → an anti-bot challenge (Turnstile) → a Redis-backed rate limit check → the Command Validator (whitelist + per-tool argument schema, **no shell interpreter anywhere**) → the sandbox pool runs the command and streams its output back over the WebSocket, chunk by chunk → the container is destroyed unconditionally, and an immutable audit record is written.

## Security model

The interesting engineering here is less "run a command" and more "run an untrusted string safely, forever, for free, with no login." A few of the load-bearing decisions:

- **No shell, anywhere.** A command is parsed into `{ binary, args: [] }` and executed directly inside the container — never through `sh -c` or `{ shell: true }`. Shell metacharacters (`;`, `&&`, `|`, `` ` ``, `$()`) simply have no special meaning, because no shell is ever invoked to interpret them.
- **Whitelist, not a blacklist.** Each tool is its own registry entry with an explicit argument schema (allowed flags, value patterns, hard limits). `curl` can't write to disk (`-o`/`--output` blocked) or hit `file://`/`gopher://`; `nc` can only do a single connect-check, never listen or exec; `openssl` is locked to the `s_client` subcommand.
- **Defense in depth on the container itself:** `--cap-drop=ALL`, a custom seccomp profile, `--read-only` rootfs with tmpfs for `/tmp`, no `--privileged`, `--pids-limit` against fork bombs, and memory/CPU cgroup limits.
- **Egress-filtered sandbox network** — RFC1918 private ranges, loopback/link-local (including the `169.254.169.254` cloud metadata address), and the host provider's own IP ranges are hard-blocked at the network level, not just in application code. `curl`/`nc` alone are enough of an SSRF vector that this can't be optional.
- **One-shot by construction.** A container is acquired from a pre-warmed pool, runs exactly one command, and is destroyed in a `finally` block regardless of success, failure, or timeout — there's no code path where a container survives its command.
- **Privacy-conscious audit trail.** Every execution is logged (target, exit code, duration) for abuse investigation, but only an HMAC hash of the IP is stored — never the raw address — with a 90-day TTL enforced natively by MongoDB, no cron job required.

Full write-up, including the specific argument schema per tool — [`backend/TECH.md`](backend/TECH.md).

## Tech stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js ≥ 20, vanilla `http`/`ws` — no framework |
| Sandbox isolation | Docker Engine API (`dockerode`), `cap-drop=ALL`, seccomp, read-only rootfs |
| Backend state | MongoDB (audit log, users, API keys) · Redis (rate limiting, pool state) |
| Anti-bot | Cloudflare Turnstile |
| Frontend | Next.js 16 (App Router, static export), React 19 |
| Terminal UI | `xterm.js` over a raw WebSocket |
| Content | MDX blog (`/commands`) generated statically at build time for SEO |
| Frontend hosting | Cloudflare Pages (static export, auto-deploy on push) |
| Backend hosting | A plain VPS — systemd units + Docker Engine, auto-deploy via GitHub Actions |

## Getting started

```bash
git clone https://github.com/R0MEN/linuxcli.git
cd linuxcli

cd backend && npm install   # needs Docker, MongoDB, Redis running locally
cd ../frontend && npm install
```

Backend dev server: `npm run dev` (in `backend/`) — see [`backend/docs/SETUP.md`](backend/docs/SETUP.md) for a from-scratch local setup (Docker sandbox image, Mongo, Redis, `.env`).

Frontend dev server: `npm run dev` (in `frontend/`), then point `.env.local` at your local backend — see [`frontend/docs/SETUP.md`](frontend/docs/SETUP.md).

### Tests

```bash
cd backend && npm test    # node:test — validator, pool, apiKey — against fake-docker/fake-Mongo, no live infra needed
cd backend && npm run lint
```

## Deployment

- **Frontend** — Cloudflare Pages, connected directly to this repo (root directory `frontend/`), builds and deploys `out/` on every push to `main`. No server-side component in production.
- **Backend** — a plain VPS: Docker Engine, Node ≥ 20, MongoDB, Redis, a dedicated egress-filtered Docker network for sandbox containers, systemd units (`backend/deploy/`). GitHub Actions (`.github/workflows/deploy-backend.yml`) SSHes in and restarts the service on every push to `main` that touches `backend/`.

Full step-by-step guides: [`backend/docs/SETUP.md`](backend/docs/SETUP.md), [`frontend/docs/SETUP.md`](frontend/docs/SETUP.md).

## Documentation

| | |
|---|---|
| [`backend/TECH.md`](backend/TECH.md) | Backend architecture, decisions, security model, MVP tool list |
| [`frontend/TECH.md`](frontend/TECH.md) | Frontend architecture, SEO strategy, WS contract with the backend |
| `backend/docs/architecture/`, `frontend/docs/architecture/` | Module-by-module deep dives (in Ukrainian) |

## License

[MIT](LICENSE)

---

Built with [Claude Code](https://claude.com/claude-code) as an AI pair-programmer throughout design, implementation, and security review.

# TECH.md — Disposable Linux CLI for web developers/testers

## 1. Problem

Web developers and testers often need to quickly run a single network diagnostic/OSINT command (`dig`, `curl`, `whois`, `mtr`, `openssl s_client`, `nc`, etc.), but:

- there's no Linux terminal at hand (Windows/macOS without native utilities);
- installing the toolkit locally is overkill for a single command;
- existing "online dig/whois" services are scattered across different sites, limited to one tool each, or don't inspire trust regarding the privacy of the input.

**Idea**: a web frontend hands the user a disposable, isolated Linux CLI. One session ≈ one command → the sandbox self-destructs right after execution. No persistent state, no shell for arbitrary scripts — only whitelisted read-only diagnostic/OSINT utilities.

## 2. Goals / Non-goals

**Goals:**
- Run one whitelisted command in an isolated, disposable environment as fast as possible (seconds, no registration friction).
- Rule out shell command injection, privilege escalation, pivoting into the internal network.
- Keep the tool whitelist **extensible** — the architecture is built for continuously adding new tools, not a fixed list.

**Non-goals (MVP):**
- Active port/network scanning (`nmap`, `masscan`) — deliberately out of scope for the MVP: a different risk class (DDoS vector, raw sockets, legal weight) and a different pace of work. May be considered as a separate future phase, isolated from the main pipeline.
- Persistent state, file storage, cross-session history.
- Arbitrary shell access.

## 3. Decisions made

| Question | Decision |
|---|---|
| Execution isolation | **Plain Docker** (`--cap-drop=ALL`, seccomp profile, `--read-only` rootfs) — speed is prioritized since MVP tools don't need raw sockets |
| Tool set | Read-only / passive-OSINT categories, an **extensible** whitelist (not a fixed list) |
| Authentication | **Anonymous access** by default: IP-based rate limit + anti-bot challenge. Optional API key for higher limits |
| Backend stack | Node.js (vanilla, minimal dependencies) |
| DB | **MongoDB** (audit log, optional API keys) + Redis (rate-limit counters, session/pool state) |

> There's no active scanning (nmap/masscan) in the MVP, so the gVisor/microVM question is off the table for now. If the whitelist expands to active scanners with raw sockets in the future, isolation will need a separate review (gVisor or microVM — see §9).

## 4. High-level architecture

```
┌────────────┐      HTTPS/WSS      ┌───────────────────┐
│  Frontend  │◄───────────────────►│   API Gateway      │
│ (xterm.js) │                     │  (Node.js, ws)     │
└────────────┘                     └─────────┬──────────┘
                                              │
                     ┌────────────────────────┼─────────────────────────┐
                     ▼                        ▼                         ▼
             ┌──────────────┐        ┌────────────────┐        ┌───────────────┐
             │ Anti-abuse   │        │ Session Manager │        │ Audit Logger   │
             │ (rate-limit, │        │ (Redis)         │        │ (MongoDB)      │
             │ anti-bot,    │        └────────┬────────┘        └───────────────┘
             │ opt. API key)│                 │
             └──────────────┘                 ▼
                                    ┌───────────────────┐
                                    │ Command Validator  │  ← tool registry:
                                    │  (whitelist +      │    per-tool arg schema,
                                    │   arg-schema)       │    easy to extend
                                    └─────────┬──────────┘
                                              │
                                              ▼
                                    ┌───────────────────┐
                                    │ Sandbox Orchestrator│
                                    │ (Docker Engine API) │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  Pre-warmed pool     │
                                    │  of Docker containers│
                                    │  (cap-drop, seccomp,  │
                                    │   egress-filtered)    │
                                    └───────────────────────┘
```

## 5. Components

### 5.1 API Gateway (Node.js)
- REST: session start, health/status, (optionally) API key issuance.
- WebSocket: terminal channel (stdin/stdout/stderr stream from the sandbox).
- Anti-bot challenge (e.g. Cloudflare Turnstile) before a sandbox is issued — protection against mass automation with no registration required.

### 5.2 Anti-abuse layer + optional registration (2026-08-14)
- **IP-based rate limiting**: N commands/min, N/hour per IP (Redis counters with a sliding window).
- **Anti-bot challenge** at session start — filters out simple scripts and mass automation without requiring an account.
- **Optional anonymous API key**: `POST /api-key`, email-less, no registration — just "generate my key". Ties counters to a `key_id` instead of the IP.
- **Real registration (email+password, GitHub, Google OAuth)** — implemented not as a third-party auth provider *replacing* the in-house system, but as an extension of the same API-key flow: `POST /register`, `POST /login`, `POST /logout`, `GET /oauth/:provider/start|callback` all issue the same key format as the anonymous path, just tied to a `userId`. Full design, `users` schema, why the OAuth callback is handled by the backend (frontend is a static export, no SSR) — `docs/architecture/auth.md`.
- **Account deletion (2026-08-17)** — `POST /account/delete`, the same apiKey trust level as `/logout`; deletes the `users` document and all live `api_keys` for the user, does not retroactively scrub already-recorded `audit_logs` (insert-only, 90-day TTL). Details — `docs/architecture/auth.md`.
- A hashed IP (not the raw IP) plus a fingerprint are written to the audit log for abuse-report investigations — accountability regardless of whether the request is anonymous or from a logged-in user.

### 5.3 Command Validator — an extensible tool registry
The most security-critical component, and at the same time the product's extension point. Design:

- Each tool is a separate module/entry in the registry: `{ binary, argSchema, defaults, hardLimits, timeoutMs }`. Adding a new tool means adding a new entry, with no changes to the Validator/Orchestrator core.
- **No shell interpreter, anywhere.** A command is parsed into `{ binary, args: [] }` and run directly (`execFile`-style, no `sh -c`) inside the sandbox. Metacharacters (`;`, `&&`, `|`, `` ` ``, `$()`, `>`, `<`) carry no shell semantics, because a shell is never invoked in the first place.
- **Per-tool argument schema** — an allowlist of flags/value patterns for each tool. Examples for the MVP categories:
  - **DNS/OSINT**: `dig`, `whois`, `host` — virtually no dangerous flags, the main thing is validating the domain/IP argument itself.
  - **HTTP**: `curl` — `-o`/`--output` is forbidden (writing to disk outside the sandbox's tmpfs), `--data`/`-X` allowed with restrictions, `file://`, `gopher://` and other dangerous schemes are blocked (SSRF via protocol smuggling).
  - **TLS**: `openssl s_client` — fixed safe flags, arbitrary `-engine`/`-rand` paths forbidden.
  - **Network reachability**: `mtr`, `ping` — packet count/duration capped; `nc` — single-connection check mode only (`-zv host port`, no `-l` listen mode, no `-e` exec mode).
- The registry stays open for extension (new tools = new entries), but the **MVP list is locked in**:

| Tool | Allowed invocation forms | Restrictions |
|---|---|---|
| `dig` | `dig [@server] domain [A\|AAAA\|MX\|TXT\|NS\|CNAME\|SOA\|PTR] [+short]` | no `+trace` (too many queries → timeout) |
| `whois` | `whois domain` | — |
| `host` | `host domain [server]` | — |
| `curl` | `curl [-I\|-i\|-L] [-X GET\|POST\|HEAD\|PUT\|DELETE] [-H "k: v"]... [-A ua\|--user-agent ua] [-d data] url` | `http(s)://` only; `-o/-O/--output`, `-F`, `-K`, `--data-binary @file`, `--unix-socket` forbidden; forced `--max-time` and `--max-filesize` |
| `openssl` | `openssl s_client -connect host:port [-servername name] [-showcerts]` | `s_client` subcommand only; `-cert/-key/-engine/-rand` forbidden; non-interactive (stdin closed) |
| `mtr` | `mtr -r -c count [-4\|-6] host` | report mode only (`-r`), `count` ≤ 10 |
| `ping` | `ping -c count host` | `count` ≤ 5, no `-f`/`-i` (flood/interval) |
| `nc` | `nc -zv host port` | single-port connect-check only; no `-l` (listen), no `-e` (exec) |

- Forced safe defaults (execution timeout, output limits) that the user cannot override via arguments.

### 5.4 Sandbox Orchestrator
- Docker Engine API, the standard `runc` runtime.
- Containers are configured with `--cap-drop=ALL`, a custom seccomp profile (deny-by-default, allowlisting only the syscalls actually needed), `--read-only` rootfs + tmpfs for `/tmp`, no `--privileged`, `--pids-limit` (anti fork-bomb), memory/CPU cgroup limits.
- **Pre-warmed pool**: N ready-to-go containers kept "warm" to minimize the latency of handing a sandbox to the user.
- Session = one sandbox = one command. After completion (success, error, or timeout), the container is killed and removed — no re-attaching.

### 5.5 Sandbox network policy
- A separate Docker network for the sandbox pool, isolated from the backend services' network.
- **Egress filtering** (iptables/network policy, not just application-level): hard-blocks RFC1918 private ranges, loopback/link-local (including cloud metadata `169.254.169.254`), and the backend host provider's own IP ranges.
- This stays mandatory regardless of the toolset — `curl`/`nc` alone are enough of an SSRF vector.

### 5.6 Audit Logger
For every session, an immutable record in MongoDB (`audit_logs` collection, insert-only, no update/delete in application code):
`ip_hash, api_key_id (if any), timestamp, target, full command, sandbox_id, duration, exit_code, output size`.

Retention — **90 days**, implemented via a native MongoDB **TTL index** on the `timestamp` field (`expireAfterSeconds: 7776000`) — old records are removed with no separate cron job. Only `ip_hash` (HMAC of the IP + a server secret) is stored, never the raw IP.

## 6. Session lifecycle (happy path)

1. Frontend opens a WebSocket → the gateway issues an anti-bot challenge (once per session/period, not per command).
2. Rate-limit check by IP (or API key, if provided).
3. The gateway reserves a pre-warmed Docker sandbox from the pool.
4. The user enters a command → it's parsed into `{binary, args}` → the Command Validator checks the whitelist + argument schema.
5. If valid — it runs inside the sandbox with no shell, output is streamed over the WebSocket in real time, with a timeout.
6. On completion — the sandbox is immediately killed/removed, an audit record is written.
7. The WebSocket is ready for a new command → a new sandbox from the pool.

## 7. Tech stack

- **Backend**: Node.js, vanilla (`http`/`ws`, no heavy frameworks).
- **Containerization**: Docker Engine API, standard `runc`.
- **Session/rate-limit state store**: Redis.
- **Audit log / optional API keys**: MongoDB (TTL index on audit records for retention).
- **Frontend terminal**: xterm.js over WebSocket (separate project/repo).

## 8. Locked-in parameters (previously open questions)

| Parameter | Value |
|---|---|
| Rate limit, anonymous | 20 commands/min, 200/hour per IP (sliding window, Redis) |
| Rate limit, with API key | 60 commands/min, 1000/hour per key_id |
| Command execution timeout | 20s (hard-kills the sandbox once exceeded) |
| Pre-warmed pool | 10 containers at startup, refilled below 5 idle |
| Anti-bot | Cloudflare Turnstile; challenge once per WebSocket connection, repeated every 20 commands or 30 minutes |
| API key | No email: a "Generate key" button → a random token, stored in MongoDB (hashed) + locally on the client (localStorage). Rate limits tied to the key_id instead of the IP |
| Audit log retention | 90 days, MongoDB TTL index on `timestamp`, stores `ip_hash` (HMAC), never the raw IP |

## 9. Future extension (out of MVP scope, does not block current development)

If the product later expands to active scanners (`nmap`, `masscan`) — that's a different risk class (raw sockets, DDoS potential, higher legal weight) and would need its own decision: stronger isolation (gVisor/microVM), mandatory registration, a consent flow with target logging, a hard rate cap on packets/sec. The current architecture (registry-based Command Validator, a separate sandbox pool) supports such an extension without rewriting the core, but launching that phase is a separate decision, not part of the MVP.

## 10. Implementation phases

- **Phase 0 — PoC**: Docker sandbox with cap-drop/seccomp, verifying `dig`/`curl`/`whois`/`mtr`/`openssl s_client`/`nc` work inside it, a basic pre-warmed pool.
- **Phase 1 — MVP backend**: Anti-abuse layer (rate-limit + anti-bot), a registry-based Command Validator for the starting tool set, Sandbox Orchestrator, Audit Logger, egress filtering.
- **Phase 2 — Performance and UX**: tuning the pre-warmed pool for real load, an optional API key, expanding the whitelist with new tool categories.
- **Phase 3 — (optional, separate decision)**: active scanning — requires its own security review before starting.

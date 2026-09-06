# LinuxCLI — Frontend

An SEO-oriented static site (Next.js, static export) built around a web terminal (xterm.js) over WebSocket — the user types one read-only diagnostic/OSINT command (`dig`, `curl`, `whois`, `openssl s_client`, `mtr`, `ping`, `nc`, `host`) and sees the output stream in real time, like a real terminal.

**Backend:** separate project `../backend` (WS protocol, tool whitelist, sandbox — the contract and security model live there; the frontend itself validates and executes nothing) · **Deploy:** Cloudflare Pages (static export, auto-build on every push to `main`) · **Runtime:** Next.js 16 (App Router, `output: 'export'`)

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
| Framework | Next.js (App Router, static export) | 16.3.0 |
| UI library | React | 19.2.0 |
| Styling | SASS/SCSS (plain `.scss` per component, no CSS Modules) | 1.102.0 |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` | 6.0.0 / 0.11.0 |
| Content/blog | MDX (`@next/mdx`, `@mdx-js/react`, `@mdx-js/loader`) | 16.3.0 / 3.1.1 |
| Deploy target | Cloudflare Pages (build output: `out/`) | — |

**Notable design choices:**

- `output: 'export'` — the site is entirely static, no server component in production; all SEO content is rendered at build time, never per-request
- The only runtime component is the terminal's WS client (`lib/useTerminalSocket.js`), which connects straight from the browser to the backend
- No client-side copy of the command validator: the on-page help text comes from `lib/toolsContent.js`, real validation always happens on the backend, errors arrive as an `error` frame
- The content data layer is locale-ready from day one (`lib/content/<locale>/*.json`), currently `en` only

> `TECH.md` is not the single source of truth for backend architecture — that lives in `../backend/TECH.md`; this file covers only what's specific to the client.

---

## Project structure

```
frontend/
│
├── app/                              # Next.js App Router (pages, static export)
│   ├── layout.jsx, page.jsx          # Root layout + home (hero + its own terminal)
│   ├── globals.scss                  # Only CSS variables + a minimal reset
│   ├── sitemap.js, robots.js         # Generated at build time (/, /tools, /about, /privacy, /terms, /commands + blog categories/articles)
│   ├── opengraph-image.jsx           # OG image
│   │
│   ├── tools/                        # /tools — the main SEO asset: one shared terminal
│   │                                 #   + 8 anchor sections (one per tool), no WS remount
│   ├── about/                        # /about — about the project + #acceptable-use
│   ├── commands/                     # /commands — MDX blog: hub → category → article
│   │   └── [module]/[command]/       #   dns/dig, network/ping, tls/openssl-s-client, etc.
│   ├── login/, register/             # email+password + GitHub/Google OAuth
│   ├── auth/complete/                # receives apiKey+username after the backend's OAuth redirect
│   ├── account/                      # account page: username, logout, account deletion
│   ├── changelog/                    # /changelog — public "What's new", every entry in full on one page
│   └── privacy/, terms/              # Privacy Policy / Terms of Service (draft, needs legal review)
│
├── content/commands/                 # MDX blog articles, grouped by category
├── content/changelog/                 # MDX entries for the public "What's new" (one file per entry)
│   ├── dns/{dig,host,whois}.mdx
│   ├── network/{mtr,nc,ping}.mdx
│   ├── tls/openssl-s-client.mdx
│   ├── web/curl.mdx
│   └── troubleshooting/{website-down,email-not-arriving,ssl-certificate-errors,slow-or-unreachable-server}.mdx  # multi-tool scenario articles
│
├── components/                       # Each component in its own folder: Name/Name.jsx + Name.scss
│   ├── Terminal/                     # xterm.js + a custom line editor + the WS hook
│   ├── HomeView/, ToolsView/, ToolSection/, AboutView/
│   ├── SiteHeader/, ThemeToggle/, Breadcrumb/
│   ├── CommandsHub/, CommandModule/, CommandArticle/   # blog
│   ├── LoginView/, RegisterView/, OAuthButtons/, AuthComplete/, AuthStatus/, AccountView/  # registration/login/account
│   ├── ChangelogView/                 # public "What's new" — every entry in full
│   └── PrivacyView/, TermsView/, CookieNotice/         # legal pages + an informational cookie banner
│
├── lib/                              # All client-side logic outside the UI
│   ├── useTerminalSocket.js          # WS protocol, state machine
│   ├── turnstile.js                  # Cloudflare Turnstile (anti-bot), invisible widget
│   ├── apiKey.js, auth.js            # Optional anonymous API key + register/login/OAuth on top of it
│   ├── toolsContent.js, commandsContent.js, changelogContent.js, seo.js  # Content layer (tools + blog + changelog) and SEO helpers
│   ├── logger.js                     # Dev logging (paired with scripts/log-server.mjs)
│   └── content/en/{site,tools}.json  # Single source of copy (locale-ready)
│
├── docs/                             # Project documentation — see "Documentation" below
├── scripts/log-server.mjs            # Local log collector for `npm run logs`
├── public/                           # Static assets
│
├── next.config.js                    # output: 'export', MDX page extensions
├── mdx-components.js                 # Global MDX components
└── TECH.md                           # Architecture, decisions, WS contract, SEO strategy
```

---

## Architecture

```
lib/toolsContent.js  ←  lib/content/en/*.json   (single source of copy)
         │
   ┌─────┼──────────────────┐
   ▼                        ▼
app/page.jsx          app/tools/page.jsx     app/about/page.jsx     app/commands/**
(HomeView, its own       (ToolsView, its own    (AboutView)             (MDX blog,
 terminal)                terminal)                                    no terminal)
   │                        │
   │ dynamic(ssr:false)     │ dynamic(ssr:false)
   ▼                        ▼
          components/Terminal
     (xterm.js + line editor + WS hook)
                │
      ┌─────────┼──────────┐
      ▼         ▼          ▼
useTerminalSocket   turnstile.js   apiKey.js
      │
      ▼
wss://<backend>/terminal
```

`/` and `/tools` share **no React context or terminal state** — they're two independent component trees, each with its own `<Terminal>`, its own WS connection and its own command history; navigating between the pages unmounts one instance and mounts the other. A detailed module-by-module breakdown, including known issues (no `try/catch` around `new WebSocket()`, multiline paste breaking the line buffer, a Turnstile widget leak on unmount), lives in [`docs/architecture/README.md`](docs/architecture/README.md).

---

## Setup and running

```bash
npm install
```

### Development

```bash
npm run dev
```

Dev server at `http://localhost:3000`. The terminal needs a locally running backend — see [`docs/SETUP.md`](docs/SETUP.md) §6 (local `.env.local`).

### Production build (static export)

```bash
npm run build
```

Builds static output into `out/` — deployed on Cloudflare Pages (framework preset `Next.js (Static HTML Export)`, build output `out`), auto-built on every push to `main`. No PM2/VPS — the frontend has no server-side component in production. Step-by-step instructions for connecting the repository to Cloudflare Pages, the domain, and the Turnstile site key — [`docs/SETUP.md`](docs/SETUP.md).

### Logs

```bash
npm run logs
```

Starts `scripts/log-server.mjs` — a local log collector for dev sessions.

---

## Environment variables

Static export — values are baked into the build at `npm run build` time; changing a value requires a rebuild and redeploy.

```env
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.example.com/terminal
NEXT_PUBLIC_BACKEND_HTTP_URL=https://api.example.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=changeme
```

For local development against a local backend — copy into `.env.local` and point it at `ws://127.0.0.1:8080/terminal` (see [`docs/SETUP.md`](docs/SETUP.md) §6). `TURNSTILE_SECRET_KEY` is never stored in this project at all — the secret half stays on the backend only.

---

## Documentation

| Document | Description |
|----------|--------------|
| [`TECH.md`](TECH.md) | Single source of truth for the frontend: architecture, goals/non-goals, sitemap/SEO strategy, WS contract with the backend |
| [`docs/architecture/README.md`](docs/architecture/README.md) | Module-by-module index (WS hook, terminal, Turnstile, content layer, logging, theming) — how the code works, file by file |
| [`docs/SETUP.md`](docs/SETUP.md) | From the repository to a live site on Cloudflare Pages: domain, environment variables, Turnstile site key |
| [`docs/VERIFY.md`](docs/VERIFY.md) | How to verify each component locally (dev server, static export build) and end-to-end against the backend |

Deeper architecture notes (`docs/architecture/*.md`) are written in Ukrainian as part of this project's normal working process.

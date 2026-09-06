# TECH.md — Frontend (disposable CLI, web terminal)

This document covers only the frontend. The product, the security model and the backend contract live in `../backend/TECH.md` (the single source of truth for everything about the WS protocol, whitelisted tools and limits). This file covers only what's specific to the client side.

## 1. What this is

A small SEO-oriented site (a handful of static pages) built around a web terminal (xterm.js) over a WebSocket connection to the backend: the user types a command (`dig example.com`, `curl -I https://example.com`, etc.) and sees the output in real time, like a real terminal.

SEO here isn't a side effect, it's the main goal — the site exists to rank for queries like "online dig tool" and bring people to a page where they can immediately use a real CLI. That's why every tool gets its own content page (§3) instead of everything hiding behind one text-less SPA. The terminal stays the product's core — not a form, not a CRUD panel, but an actual command line — it now just lives inside several purpose-built pages instead of one.

## 2. Goals / Non-goals

**Goals:**
- **SEO as the primary goal:** content pages for every tool, semantic HTML, per-page metadata, a sitemap — everything so Google can index and rank specific pages instead of one bare SPA.
- The feel of a real terminal: monospace, character-by-character real-time output, local history (up arrow) for convenience.
- Zero extra friction in the terminal itself: land on the page → start typing a command immediately. Anti-bot/rate-limit stay transparent, no separate "solve a captcha" screen.
- Static build — the frontend shouldn't have its own state that needs a server (all runtime logic is the WS client to the backend; SEO content is generated at build time, not per request).

**Non-goals (MVP):**
- No SSR/data fetching per request — SEO pages are generated statically at build time from local content (§3), not from a runtime fetch. The terminal remains a pure WS client, all of its state lives in one browser's WS session.
- No client-side copy of the Command Validator — this would duplicate the backend's security-critical logic (`../backend/src/validator/tools/*.js`) and would guaranteed drift from it over time. The client only shows help text (§7) and relies on `error` frames from the server.
- **Registration/login — implemented (2026-08-14), no longer an MVP restriction.** Email+password and GitHub/Google OAuth, `/login`/`/register`/`/auth/complete` — an extension of the same anonymous API-key flow (`../backend/TECH.md` §5.2), not a parallel system. **A deliberate departure from the non-goal below** ("no third-party auth provider") — done at the user's direct request; the OAuth token exchange is handled exclusively by the backend (no client secret ever ships in the frontend bundle), the frontend only links to the backend URL and receives a ready-made `apiKey` at `/auth/complete`. Full details — `docs/architecture/auth.md`. **Still a non-goal:** SSR sessions on the frontend — all authenticated logic remains a pure WS/REST client to the backend, no server-side rendering was added for this.
- Blog (`/commands`, MDX, hub → category → article) — already implemented and deployed (§3). Not an MVP stub.

**`/changelog` — public "What's New", implemented 2026-08-23.** A single page listing every entry in full (not hub→article like `/commands` — deliberately simpler: entries are short, a separate page per entry wouldn't add SEO value). Data source — `content/changelog/*.mdx` (the same pattern as the blog), `lib/changelogContent.js` (an fs-based loader, server-only, like `commandsContent.js`). The latest 3 entries are duplicated as a widget on `/` (`HomeView`) — data is passed there as serialized props from `app/page.jsx` (a Server Component), since `HomeView` is a client component and can't import the fs-based loader directly. **Not to be confused with the internal `docs/changelog/`** (in Ukrainian, for the developer, a detailed technical log) — two fully independent sources, different language, different audience, a deliberate decision. Details — `docs/architecture/changelog-public.md`.

## 3. Site structure and SEO

**Sitemap (MVP), locked in 2026-08-12 (revised from an earlier version — see §12):**

```
/          — home/hub
/tools     — ONE page covering all tools, anchor sections inside
/about
```

The tool list (anchors on `/tools`) matches the help reference in §7 (`dig`, `whois`, `host`, `curl`, `openssl s_client`, `mtr`, `ping`, `nc`) — if the backend adds a new whitelisted tool, another section appears on that same page rather than a new page.

> **Revised decision (was: 8 separate `/tools/[tool]` pages).** The initial version of this document planned a dedicated page per tool specifically for SEO (each page ranking for its own query). The user deliberately rejected this in favor of **a single terminal instance**: one xterm.js instance, one WS connection that never gets recreated when switching between tools. Technically that can't be combined with 8 separate URLs without added complexity (layout persistence across route transitions), so instead there's **one URL, `/tools`, with anchor sections** (`#dig`, `#whois`, ...), each with its own SEO content, all pointing at the same shared terminal on that same page. A deliberate SEO trade-off: less precise per-keyword ranking than 8 separate URLs would give, offset by semantic H2s per anchor plus a JSON-LD `ItemList` in the page `<head>`.

**Blog (`/commands`) — already implemented and deployed**, hub → category → article (`app/commands/[module]/[command]/`, MDX), cross-linked with `/tools`.

**`/login`, `/register`, `/auth/complete`, `/account` — already implemented and deployed** (2026-08-14/17, details in `docs/architecture/auth.md`). `/account` — account page: view username, logout, delete account (`POST /account/delete` on the backend). Deliberately **not** in `app/sitemap.js` — a utility page, not an SEO asset, unlike the rest of the list above.

**`/privacy`, `/terms` — already implemented and deployed** (2026-08-17, draft copy, flagged as needing legal review before publication — `lib/content/en/site.json`). Unlike `/account`/`/login`/`/register` — real content, not a utility page, so it **is** in `app/sitemap.js` (low priority).

**Planned, out of MVP scope (not building now):** a switch to a "simplified mode" for non-technical users — not designing the implementation now, just avoiding stack decisions that would block it later.

**Role of `/` (home):** a hub, not the primary SEO asset — brand, a short "a real terminal in your browser" pitch, a list of tools linking to the corresponding `/tools#*` anchors, and its own general-purpose terminal at the bottom (no command prefill, a separate instance from the one on `/tools`) so someone who lands directly on the home page can start typing right away.

**Role of `/tools` — the primary SEO asset.** One page, not a thin "doorway page": its own H1 for the hub query ("Online network diagnostic tools: dig, whois, ping, curl…"), one shared terminal up top, and below it — one section per tool with its own H2/intro/example/description/use cases. Block order top to bottom:

1. **SEO block** — H1 for the hub query, a short intro paragraph.
2. **Terminal** — one shared instance for the whole page, no forced prefill by default.
3. **Anchor navigation** — internal links to the sections below (crawl depth, convenience).
4. **8 tool sections** — each: H2 for a specific query, intro, example command, description, use cases, a "Run `tool` →" button that writes the prefill into the shared terminal and scrolls to it (no xterm/WS remount — it's the same React component on the same page, state lifted into `ToolsView.jsx`).
5. **A slot for blog post links** — a reserved block, not rendered until the blog exists.

**Technically:** `app/tools/page.jsx` (a Server Component, `metadata` + JSON-LD) renders `<ToolsView />` (a Client Component) — it lifts the prefill state and maps `ToolSection` over the entries in `toolsContent.js`. One shared `<Terminal>` is mounted inside `ToolsView`, not inside each section. `toolsContent.js` remains the same data source as the §7 help reference (one text, not two that drift apart over time).

`app/sitemap.js` and `app/robots.js` (native App Router support, works in static export too) generate `sitemap.xml`/`robots.txt` at build time. `sitemap.js` includes `/`, `/tools`, `/about`, `/privacy`, `/terms`, `/commands`, every blog category (`/commands/{module}`), every article (`/commands/{module}/{command}`) and `/changelog` — sourced from `lib/commandsContent.js` (`getModules()`/`getAllCommandParams()`), not a static list (the `/tools#*` anchors and the utility `/login`/`/register`/`/auth/complete`/`/account` pages are not separate sitemap entries). `/changelog` uses `changeFrequency: 'weekly'` (the only exception to the default `'monthly'` for the rest of the routes), since it updates more often.

`app/llms.txt/route.js` — a Route Handler (not a native metadata convention like sitemap/robots; App Router Route Handlers render to a static file at build time by default, `dynamic = 'force-static'` is set explicitly) generates `/llms.txt` at build time: a short project description (`site.brand`/`site.tagline`) + the tool list (`toolsContent.js`) + the blog article list (`commandsContent.js`, `getAllCommands()`) + links to `/about`/`/commands`/`/privacy`/`/terms` under an "Optional" section. The format follows the unofficial [llms.txt](https://llmstxt.org) convention: a markdown file at the site root that gives AI crawlers concise context without parsing HTML. It has no official support in Google/Bing and isn't part of the sitemap protocol — it doesn't need Search Console registration, a crawler simply requests `/llms.txt` by convention (like `/robots.txt`), with no guarantee any given bot actually does. The data source is the same as the sitemap's — a content update (a new tool or article) is automatically picked up on the next build, no manual sync needed.

## 4. Stack and why

| Question | Decision |
|---|---|
| Framework | **Next.js, App Router, JSX** (not TypeScript) — by requirement |
| Rendering | **Static export** (`output: 'export'` in `next.config.js`) |
| Hosting | **Cloudflare Pages**, a domain separate from the backend (`../backend/docs/SETUP.md` §13) |
| Terminal | `xterm.js` (+`@xterm/addon-fit` for auto-sizing) |
| Anti-bot | Cloudflare Turnstile, invisible/managed mode |

**Why static export, not Next.js SSR:** the multi-page structure and SEO content (§3) don't require SSR — the App Router pre-renders every `/tools/*` page to HTML at build time (`generateStaticParams`), which is exactly what Google indexes, with no runtime server. The interactive part (WebSocket to the backend, `localStorage`, DOM-dependent xterm.js) still has nothing useful to hand off to a server at runtime. Cloudflare Pages was already adopted as the hosting target back at the backend-TECH.md stage, specifically as "static files" — SSR (via `@cloudflare/next-on-pages`, edge runtime) would add infrastructure complexity with no payoff: static export already delivers everything SEO needs at build time. The same approach scales to the MDX blog (posts are static pages at build time too).

**Why JSX, not TSX:** an explicit user requirement. The App Router accepts `page.jsx`/`layout.jsx` just the same — the same file convention, just without types. `jsconfig.json` instead of `tsconfig.json` (path aliases like `@/lib/...` still work).

## 5. Project structure

```
frontend/
  app/
    layout.jsx              — root layout, anti-FOUC theme script, default metadata, <SiteHeader>
    layout.scss               — .site-main/.site-footer styles (global import, plain CSS, no modules)
    page.jsx                    — home: metadata + <HomeView />
    about/
      page.jsx                   — about the project: metadata + <AboutView>
    tools/
      page.jsx                    — ONE page: metadata + JSON-LD ItemList + <ToolsView />
    commands/                     — /commands — MDX blog: hub → category → article
      page.jsx                     — hub: <CommandsHub />
      [module]/page.jsx             — category: <CommandModule />
      [module]/[command]/page.jsx    — article: <CommandArticle />, generateStaticParams from lib/commandsContent.js
    login/page.jsx               — email+password + OAuth buttons: <LoginView />
    register/page.jsx             — registration: <RegisterView />
    auth/complete/page.jsx         — receives apiKey+username after the backend OAuth redirect: <AuthComplete />
    account/page.jsx                — account page: username, logout, account deletion — <AccountView />
    changelog/page.jsx               — public "What's new": metadata + JSON-LD Blog + <ChangelogView /> (every entry in full, one page)
    privacy/page.jsx                 — Privacy Policy (draft, needs legal review) — <PrivacyView />
    terms/page.jsx                    — Terms of Service (draft, needs legal review) — <TermsView />
    opengraph-image.jsx           — OG image (generated at build time)
    sitemap.js                     — generates sitemap.xml at build time (/, /tools, /about, /privacy, /terms, /commands + every blog category/article)
    robots.js                       — generates robots.txt at build time
    globals.scss                     — THE ONLY file with color CSS variables (`:root`/`[data-theme]`) + a minimal reset
  content/commands/                — MDX blog articles, grouped by category (dns/, network/, tls/, web/, troubleshooting/ — multi-tool scenario articles)
  content/changelog/                — MDX entries for the public "What's new" (one file per entry, `changelogMeta` = {date, title, summary})
  lib/
    content/en/tools.json       — 8 entries (id, h2, intro, exampleCommand, description, useCases) — locale-ready
    content/en/site.json         — home/about/tools-hub/help copy
    toolsContent.js                — a locale-aware loader: getToolsList(), getToolContent(id), getSiteContent()
    commandsContent.js              — blog data layer: getModules(), getAllCommandParams(), getCommandsInModule(), getModuleSummaries() (`docs/architecture/content.md`)
    changelogContent.js             — public changelog data layer (fs-based, server-only): getAllChangelogEntries(), getLatestChangelogEntries(n) (`docs/architecture/changelog-public.md`)
    formatDate.js                    — formatChangelogDate() — no fs dependency, since it's needed in both server and client components
    useTerminalSocket.js            — hook: WS lifecycle, frames, reconnect state
    turnstile.js                     — a wrapper around the Cloudflare Turnstile JS API
    apiKey.js                         — localStorage get/set/generate (POST /api-key)
    auth.js                            — register/login/OAuth flow on top of apiKey.js (`docs/architecture/auth.md`)
    seo.js                              — SITE_URL and other SEO helpers, a single source of truth (§12)
    logger.js                          — log()/warn()/error(): a replacement for console.log/warn/error; in `next dev` (NODE_ENV=development) each call is additionally sent to `scripts/log-server.mjs` (a separate dev-only process, `npm run logs`) which appends to `logs/YYYY-MM-DD.log`. In production (static export) the network call is stripped out — there's no UI or access path for end users.
  components/                     — each component in its own folder: Name/Name.jsx + Name.scss
    Terminal/                       — xterm.js + a line editor, "use client", dynamic import ssr:false; takes `prefill` as a prop
    SiteHeader/                       — brand link, nav, <AuthStatus>, <ThemeToggle> (pulled out of layout.jsx for its own .scss)
    ThemeToggle/                        — light/dark switch, data-theme + localStorage
    HomeView/                            — client wrapper for home: hero + its own <Terminal> with no prefill
    ToolsView/                             — client wrapper for /tools: lifts the prefill state, one <Terminal> + maps <ToolSection>
    ToolSection/                             — one tool block on /tools (H2/intro/example/desc/CTA)
    AboutView/                                 — about the project + an acceptable-use policy section
    CommandsHub/, CommandModule/, CommandArticle/, Breadcrumb/ — MDX blog `/commands`
    LoginView/, RegisterView/, OAuthButtons/, AuthComplete/, AuthStatus/, AccountView/ — registration/login/account (`docs/architecture/auth.md`)
    ChangelogView/                          — public "What's new": every entry in full on one page (`docs/architecture/changelog-public.md`)
    PrivacyView/, TermsView/ — Privacy Policy/Terms of Service, mirror-image layout components
    CookieNotice/ — an informational cookie banner (doesn't block Turnstile)
  next.config.js                  — output: 'export'
  jsconfig.json
  package.json
```

**Styling:** plain (not CSS Modules) `.scss` per component, imported into the component itself as `import './Name.scss'` (a side-effect import — the Next.js App Router allows a global CSS import in any client or server component). Classes carry a component prefix (`.terminal-widget`, `.tool-section`, `.site-header`, ...) to stay globally unique without name hashing. `app/globals.scss` is the one file that doesn't belong to a specific component: just color CSS variables (`:root`/`[data-theme='dark']`) plus a minimal `box-sizing`/`body` reset. Requires the `sass` package (`devDependencies`) — Next.js compiles `.scss` out of the box once it's installed.

A second language later means a new `lib/content/<locale>/*.json`, with no changes to the components — they always go through `toolsContent.js`, never import JSON directly.

## 6. WS client — the backend contract

Source of truth — `../backend/src/gateway/wsHandler.js`. In short, from the frontend's point of view:

**Connecting:** `wss://<backend-domain>/terminal[?apiKey=<token>]`. The browser sets `Origin` itself (nothing to do there), but it **must exactly match** what's in the backend's `ALLOWED_ORIGINS` — coordination between the two projects/deployments, don't forget it when changing the frontend domain.

**Client → Server**, one frame type:
```json
{ "type": "exec", "command": "dig example.com +short", "turnstileToken": "<token>" }
```

**Server → Client**, four types:
- `{ type: "chunk", stream: "stdout"|"stderr", data: string }` — write to the terminal as it arrives
- `{ type: "done", exitCode, durationMs, timedOut, aborted }` — unlock the input, print a summary line
- `{ type: "error", message: string }` — invalid command, rate limit, internal error. Printed in the terminal in a different color, input unlocked immediately
- `{ type: "challenge-required" }` — the current Turnstile token has expired/is missing; force a token refresh (§8) and let the user resend the last command

**Important:** on a single WS connection, the server runs exactly one command at a time (a `running`-guard in `wsHandler.js`) — the UI input must be locked between sending `exec` and receiving `done`/`error`, otherwise a second `exec` is simply rejected by the server.

**xterm.js gotcha:** the output of `dig`/`curl`/`whois` contains bare `\n`, while xterm.js only returns the cursor to the start of the line on `\r\n` — otherwise the output "staircases". In the `chunk` handler, replace `\n` → `\r\n` before calling `terminal.write()`.

## 7. Command reference (client-side, not validation)

Show a help panel (or `help`/`?` as a pseudo-command handled locally and never sent to the server) listing the allowed tools. Content comes from `lib/toolsContent.js` (§3, §5) — the same file that powers the `/tools/*` pages, manually kept in sync with the table in `../backend/TECH.md` §5.3 whenever it changes (there's no technical way to pull the schema from the backend without duplicating a runtime dependency just for reference text — manual sync is acceptable since the table changes rarely and deliberately).

Example help content: `dig`, `whois`, `host`, `curl`, `openssl s_client`, `mtr`, `ping`, `nc` — with one example invocation each.

## 8. Anti-bot (Turnstile)

Rendered in **invisible/managed** mode (doesn't block the UI with a puzzle in the normal case). The token:
- Is fetched proactively on page load and cached in memory with a TTL slightly shorter than the real Turnstile token lifetime (~5 min) — so that `turnstileToken` in every `exec` frame is almost always fresh and the server (`ensureChallenge` in `wsHandler.js`) doesn't ask for a challenge mid-session.
- On `{type:"challenge-required"}` — forcibly regenerate the token (`turnstile.execute()`) and show the user that the command needs to be sent again (not automatically — Turnstile's execute is itself async and this is a rare case, so it's simpler not to add retry logic).

Needs a **Turnstile site key** (public, separate from the backend's `TURNSTILE_SECRET_KEY`, which stays server-only) — registered in the Cloudflare dashboard for the frontend's domain, placed in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

## 9. API key — anonymous and account-linked

Both paths end the same way: `localStorage` (`linuxcli_api_key`) → passed as `?apiKey=` when opening the WS connection (`useTerminalSocket.js`, deliberately opt-in — `../backend/TECH.md` §5.2). They differ only in how the key gets there:

- **Anonymous** (`lib/apiKey.js`, `generateApiKey`) — `POST /api-key` with no credentials. The function has existed in the codebase since the MVP, but **still has no UI** (no "Increase rate limit" button) — not in this iteration, not a priority now that full registration exists below.
- **Account-linked, implemented 2026-08-14** (`lib/auth.js`) — `/register` (email+password), `/login`, GitHub/Google OAuth (`/auth/complete` receives the token after the backend redirect). A second `localStorage` flag (`linuxcli_account_name`) alongside the key stores the `username` (a display name), not the email: the key itself is opaque, the UI would otherwise have no way to tell an anonymous session from a logged-in one, and the email is deliberately never shown anywhere in the UI. Full design, why the OAuth exchange happens exclusively on the backend (static export, no SSR route for the callback) — `docs/architecture/auth.md`.

In both cases, the raw key is never stored anywhere except the user's `localStorage` — matching the backend model (`../backend/docs/architecture/abuse.md`): the server only keeps a hash.

## 10. Configuration (build-time, `NEXT_PUBLIC_*`)

Static export means values are baked into the build, changing a value requires a rebuild+redeploy (fine for Cloudflare Pages — a redeploy happens on every push anyway).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_WS_URL` | `wss://api.example.com/terminal` |
| `NEXT_PUBLIC_BACKEND_HTTP_URL` | `https://api.example.com` (for `/api-key`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from the Cloudflare Turnstile dashboard |

## 11. Deploy

Historically a separate git repository (a sibling to `backend`, the same approach as `../backend/TECH.md` §7 "Frontend terminal ... separate project/repo"; now merged into this monorepo — see the root `README.md`). Cloudflare Pages connects directly to the GitHub repository — unlike the backend, **no separate GitHub Actions workflow is needed**: Cloudflare Pages builds (`npm run build`) and deploys `out/` on every push to `main` itself, a built-in integration feature, not a custom CI pipeline.

Domain: `linuxcli.xyz` — must match the value of `ALLOWED_ORIGINS` on the backend (§6).

## 12. Decision history

Settled (2026-08-12, second iteration — revised the sitemap decision):
- **One terminal instance, one `/tools` page:** instead of 8 separate `/tools/[tool]` pages — one shared xterm.js/WS instance on `/tools`, 8 SEO anchor sections around it (§3). Content language — English; the data layer was made locale-ready (`lib/content/<locale>/*.json`) for a future second language without rewriting components (§3, §5).
- **Simplified mode (future, not MVP):** only the direction is locked in — a possible switch for non-technical users; not designing the implementation now (§3).

Settled (2026-08-12, first iteration):
- **Design/branding:** a minimalist terminal (monospace, minimal CSS) with a **light/dark switch** (not just following the system theme) — color tokens pulled into CSS variables (`:root` / `[data-theme]`).
- **`/about` page:** needed, added to the structure (§5).
- **MVP scope:** only `/`, `/tools`, `/about`. The blog and registration were documented as a direction (§2, §9), not built at that point.
- **Registration (future):** an extension of the existing backend flow (email+password), not a third-party auth provider (§9).

Settled (external actions by the developer, outside the code):
- **The real frontend domain** — `linuxcli.xyz`, deployed and live.
- **Turnstile site key** — registered in the Cloudflare dashboard, the real value lives in `.env.local` (not in git).

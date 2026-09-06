# Turnstile — `lib/turnstile.js`

Обгортка над Cloudflare Turnstile JS API (`§8 TECH.md`) — invisible-
режим, кешування токена, форс-рефреш на `challenge-required`.

## Без site key (локальна розробка)

```js
if (!siteKey || siteKey === 'changeme') {
  warn('[turnstile] no site key configured — sending turnstileToken: null');
  return { getToken: async () => null, refresh: async () => null };
}
```

Жодного скрипта не завантажується, жодного віджета не рендериться —
`getToken()` одразу віддає `null`. Бекенд без реального
`TURNSTILE_SECRET_KEY` (чи з тестовим — `../../../backend/docs/SETUP.md`
§11) відповість `challenge-required` на кожен `exec`, що коректно
оброблюється (`websocket.md`).

**Публічний тестовий site key** (не секретний, можна коммітити) для
локальної розробки, коли на бекенді стоїть тестовий secret key
(`1x0000000000000000000000000000000AA`): `1x00000000000000000000AA`
— окрема строка, коротша за секретний тестовий ключ, легко переплутати
(і це вже траплялось).

## З реальним site key

```
ensureWidget() → loadScript() → window.turnstile.render(container, {
  sitekey, appearance: 'interaction-only', execution: 'execute', callback: handleToken,
})
```

`execution: 'execute'` означає, що віджет не запускається сам при
рендері — токен генерується лише коли код явно кличе
`window.turnstile.execute(widgetId)` (у `refresh()` нижче).
`appearance: 'interaction-only'` — жодного видимого UI, поки
Cloudflare не вирішить показати challenge.

Токен кешується з TTL трохи меншим за реальний строк дії (~5 хв,
`TOKEN_TTL_MS = 4.5 * 60_000`) — `getToken()` повертає кеш, поки він
свіжий, інакше форсує `refresh()`.

## Витік ресурсів (фікс 14-08-2026)

`ensureWidget()` створює `<div style="display:none">`, додає його в
`document.body` і реєструє через `window.turnstile.render(...)`. Без
явного прибирання це витікало б і в dev (React StrictMode
double-invoke — чернетковий перший mount губить свій клієнт разом з
DOM-контейнером, коли другий mount створює новий), і в проді, якби
Terminal колись демонтувався (зараз не демонтується — і на `/`, і на
`/tools` живе, поки живе сторінка, — але захист не залежить від того,
чи є такий сценарій сьогодні).

`createTurnstileClient` повертає `destroy()`:
```js
function destroy() {
  if (widgetId !== null) {
    window.turnstile?.remove?.(widgetId);
    widgetId = null;
  }
  container?.remove();
  container = null;
  pendingResolvers = [];
}
```
`Terminal.jsx` кличе `turnstileRef.current?.destroy()` в cleanup
mount-ефекту, поряд з `term.dispose()` і зняттям window-listeners.
Гілка без site key (`siteKey === 'changeme'`) повертає no-op
`destroy: () => {}` — там немає ні контейнера, ні віджета.

## Чому саме interaction-only/execute, не managed/always

`appearance: 'interaction-only'` — жодного видимого челенджа в
звичайному випадку (§8 TECH.md: "не блокує UI пазлом"). Cloudflare сам
вирішує, коли показати виклик (рідкісний edge case підозрілого
трафіку) — цей код на це жодним чином не впливає, тільки надає
`sitekey`/`callback` і момент виклику (`execute()`).

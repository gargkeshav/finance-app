---
mode: agent
description: Batch 36. Connect Splitwise by pasting a request copied as cURL. The dev server keeps it in memory and adds its cookies and headers to each call. About 40K tokens.
---
Build batch 36 only.
Read: `.github/prompts/PHASE4.md`, `vite.config.ts`, `src/adapters/splitwise.ts`, `src/ui/views/PeopleView.tsx`, `src/ui/views/ActivityView.tsx`, `src/ui/views/SettleView.tsx`, `tests/splitwise.test.ts`.

A page can't set `Cookie`, `Origin`, `Referer`, or `User-Agent` on `fetch`, because browsers forbid it. So the captured request is replayed by the dev server, which runs in Node. The browser only ever calls the dev server, with no credentials.

Trying this against the real site is in `.github/prompts/MANUAL.md`. This batch does not call Splitwise, and it does not wait on that check.

## Build
1. `src/adapters/curl-capture.ts`, pure `parseCurl(text)`:
   - Returns `{ method, url, headers, cookies }`.
   - Handles Chrome and Firefox output: `-H`/`--header`, `-b`/`--cookie`, `-X`, `--data`/`--data-raw`/`--data-urlencode`, single quotes, `$'…'`, and `\` line breaks.
   - Rejects any host other than `secure.splitwise.com`.
   - `headerNames(parsed)` lists the names only, never values.
2. `vite/splitwise-session.ts`, a dev-server plugin added in `vite.config.ts`:
   - `POST /__splitwise/session` takes the pasted text and keeps the parsed result in memory, never on disk. `GET` returns `{ connected, headerNames }`. `DELETE` clears it.
   - `/splitwise-api/*` forwards to `https://secure.splitwise.com/*`, and only for paths under `/api/v3.0/`.
     - On the way out: drop the captured `Host`, `Content-Length`, `Accept-Encoding`, and `Content-Type`, and send every other captured header and cookie. Set `Origin` and `Referer` to `https://secure.splitwise.com`. Use the browser's method, content type, and body.
     - On the way back, merge any `Set-Cookie` into the stored cookies, and strip `Set-Cookie` from what the browser gets.
   - Both routes reject an `Origin` that isn't the dev server's own, and require an `X-Finance-App: 1` header.
   - Never log headers, cookies, or bodies, including in errors.
3. `splitwise.ts`:
   - `baseUrl` becomes `/splitwise-api/api/v3.0`.
   - Remove `apiKey` and the `Bearer` header.
   - Replace `setKey` and `hasKey` with `connectSession(text)`, `disconnectSession()`, and `sessionStatus()`.
   - `request` takes a method and an optional form body, sends `X-Finance-App: 1`, and `postExpense` uses it.
   - A 401 or 403, or HTML where JSON was expected, throws `SplitwiseSessionExpiredError`: "Splitwise session expired. Copy a fresh cURL from splitwise.com."
   - No error text mentions API keys or CORS.
4. `PeopleView.tsx`: the API key field becomes a labelled textarea, "Paste a request copied as cURL from splitwise.com". Connect sends the text, clears the box, and confirms with `getCurrentUser`. Once connected, show the user's name, the header names, and Disconnect. An expired session shows Reconnect.
5. In `ActivityView` and `SettleView`, `hasKey()` checks become checks on the session status, with matching wording.
6. `README.md`, under Splitwise: how to copy the cURL (DevTools, Network, a request to `secure.splitwise.com`, then "Copy as cURL"); that it lives only in the dev server's memory and is cleared on restart; what to do when it expires.
7. `.github/copilot-instructions.md`: "A pasted Splitwise cURL is a credential. It lives only in dev-server memory. Never write it to the ledger, files, tests, logs, prompts, or chat. Dev-server code lives in `vite/`."

## Tests
- In `tests/splitwise.test.ts`, with made-up values: `parseCurl` on a multi-line Chrome command with `-b`, several `-H`, and `--data-raw` gives the right method, URL, and header names. A URL on another host is rejected.
- In `tests/e2e/splitwise.spec.ts`, with `page.route` mocking `/__splitwise/session` and `/splitwise-api/**`: Connect shows the user's name. Pulling a linked friend adds an inbox item to Review. A 401 shows Reconnect.

## Done when
All four commands pass. Update `PROGRESS.md`. Next is 37. Live checks against Splitwise are in `MANUAL.md`.

# 白嫖社区个人统计插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Chromium Manifest V3 extension that opens a compact popup showing the currently logged-in Baipiao community user's profile, available interaction statistics, recent activity, and a seven-day activity trend.

**Architecture:** A static popup communicates with a Manifest V3 service worker. The service worker locates or opens a `baipiao.org/bbs/` tab and sends a read-only request to a same-origin content script. The content script probes the site's session/profile/activity JSON routes and falls back to structured page data; `lib/data-adapter.js` converts all supported responses into one safe, non-sensitive model before data reaches popup storage.

**Tech Stack:** Plain HTML/CSS/JavaScript, Chromium Manifest V3, Chrome extension APIs, Node.js built-in test runner, Playwright CLI for browser smoke checks when available.

---

## Scope and File Map

The implementation lives only under `D:\Aava-xiangmu\中转\一键签到\baipiao-community-stats-extension`. The existing `newapi-checkin-edge-audit` project is not modified.

Create these files:

- `manifest.json`: MV3 metadata, popup entry, service worker, narrow permissions and `baipiao.org` host match.
- `popup.html`: semantic popup structure with profile header, statistics strip, trend, activity list and state panels.
- `popup.css`: 380px popup layout, typography, colors, focus states, loading/error states and reduced-motion rules.
- `popup.js`: popup state machine, message calls, safe rendering and user actions.
- `background.js`: service worker message router, target-tab lookup/creation, content-script request timeout and cache coordination.
- `content.js`: same-origin read-only data collector, endpoint probing, page fallback and response sanitization.
- `lib/data-adapter.js`: pure, browser/Node-compatible normalization and trend aggregation functions.
- `lib/storage.js`: non-sensitive cache wrapper with an in-memory fallback for tests.
- `tests/data-adapter.test.js`: unit tests for normalization, missing fields, activity classification, and seven-day trend aggregation.
- `tests/storage.test.js`: storage allowlist tests that reject credential-like fields and preserve only normalized cache.
- `tests/fixtures/profile-responses.js`: representative public/profile/activity response fixtures with no real account data.
- `package.json`: Node test script and syntax-check script.
- `README.md`: install, permissions, privacy guarantees, limitations and troubleshooting.
- `icons/icon.svg`: independent monochrome/mint extension mark used by the popup and documentation; the manifest uses no external assets.

No remote library, CDN script, analytics endpoint, cookie permission, or `<all_urls>` permission is introduced.

## Task 1: Bootstrap the standalone extension

**Files:**
- Create: `manifest.json`
- Create: `popup.html`
- Create: `popup.css`
- Create: `popup.js`
- Create: `background.js`
- Create: `content.js`
- Create: `lib/data-adapter.js`
- Create: `lib/storage.js`
- Create: `tests/data-adapter.test.js`
- Create: `tests/storage.test.js`
- Create: `tests/fixtures/profile-responses.js`
- Create: `package.json`
- Create: `README.md`
- Create: `icons/icon.svg`

- [ ] **Step 1: Add the minimal MV3 manifest**

Create `manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "白嫖社区个人统计",
  "version": "0.1.0",
  "description": "查看白嫖社区当前登录账号的个人资料、互动统计和最近活动。",
  "permissions": ["storage", "tabs", "scripting"],
  "host_permissions": ["https://baipiao.org/bbs/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "打开白嫖社区个人统计",
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://baipiao.org/bbs/*"],
      "js": ["lib/data-adapter.js", "content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Add the Node test commands**

Create `package.json`:

```json
{
  "name": "baipiao-community-stats-extension",
  "private": true,
  "version": "0.1.0",
  "type": "commonjs",
  "scripts": {
    "test": "node --test tests",
    "check": "node --check lib/data-adapter.js && node --check lib/storage.js && node --check content.js && node --check background.js && node --check popup.js"
  }
}
```

- [ ] **Step 3: Add placeholder pages and an independent icon**

Create the initial `popup.html` with these stable element IDs: `app`, `profileSection`, `avatar`, `displayName`, `handle`, `trustLabel`, `joinedAt`, `refreshButton`, `openProfileButton`, `openCommunityButton`, `statePanel`, `stateTitle`, `stateMessage`, `statsGrid`, `topicsValue`, `repliesValue`, `receivedValue`, `givenValue`, `trendSection`, `trendBars`, `trendEmpty`, `activityList`, `activityEmpty`, `updatedAt`.

Create `icons/icon.svg` as a 128px square mint/black mark with a simple bar-chart motif. Use it only as a local visual asset; do not reference any external URL.

- [ ] **Step 4: Add the first README and run structural checks**

Document the unpacked-extension installation flow for Edge and Chrome, the exact host permission, the fact that the extension does not read `document.cookie`, and the current limitation that the site may change its profile endpoints.

Run:

```powershell
npm test
npm run check
Get-Content -Raw .\manifest.json | ConvertFrom-Json | Out-Null
```

Expected: the test runner may report zero tests at this bootstrap point, syntax checks exit with code 0, and manifest parsing succeeds.

## Task 2: Build and test the pure data adapter

**Files:**
- Modify: `lib/data-adapter.js`
- Create: `tests/fixtures/profile-responses.js`
- Modify: `tests/data-adapter.test.js`

- [ ] **Step 1: Write failing tests for the normalized model**

Use Node's built-in test runner and assert the following public functions:

```js
const {
  normalizeProfile,
  normalizeStats,
  normalizeActivity,
  aggregateSevenDayTrend,
  normalizePayload,
} = require("../lib/data-adapter");

test("normalizes common profile and stat aliases", () => {
  const result = normalizePayload({
    user: {
      username: "demo",
      name: "Demo User",
      avatar_template: "/bbs/user_avatar/baipiao.org/demo/{size}/1.png",
      trust_level: 2,
      created_at: "2026-01-02T03:04:05Z"
    },
    summary: {
      topic_count: 4,
      post_count: 17,
      likes_received: 9,
      likes_given: 3
    },
    activities: []
  }, "api");

  assert.equal(result.profile.username, "demo");
  assert.equal(result.profile.displayName, "Demo User");
  assert.equal(result.stats.topics, 4);
  assert.equal(result.stats.replies, 13);
  assert.equal(result.stats.likesReceived, 9);
  assert.equal(result.stats.likesGiven, 3);
});

test("uses null for unavailable fields and removes duplicate activity records", () => {
  const result = normalizePayload({
    user: { username: "demo" },
    activities: [
      { id: "a1", type: "reply", title: "Hello", url: "/bbs/t/1", timestamp: "2026-09-10T01:00:00Z" },
      { id: "a1", type: "reply", title: "Hello", url: "/bbs/t/1", timestamp: "2026-09-10T01:00:00Z" }
    ]
  }, "dom");

  assert.equal(result.stats.topics, null);
  assert.equal(result.stats.replies, null);
  assert.equal(result.activity.length, 1);
  assert.equal(result.source, "dom");
});

test("aggregates activity into seven local date buckets", () => {
  const trend = aggregateSevenDayTrend([
    { timestamp: "2026-09-10T01:00:00Z" },
    { timestamp: "2026-09-10T04:00:00Z" },
    { timestamp: "2026-09-08T04:00:00Z" },
    { timestamp: "2026-08-01T04:00:00Z" }
  ], new Date("2026-09-10T12:00:00Z"));

  assert.equal(trend.length, 7);
  assert.equal(trend.at(-1).date, "2026-09-10");
  assert.equal(trend.at(-1).count, 2);
  assert.equal(trend.find((entry) => entry.date === "2026-09-08").count, 1);
  assert.equal(trend.find((entry) => entry.date === "2026-09-09").count, 0);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node --test tests/data-adapter.test.js
```

Expected: FAIL because the adapter exports and normalization functions do not yet exist.

- [ ] **Step 3: Implement the normalized data model**

Implement `lib/data-adapter.js` as a CommonJS/browser-compatible module. The module must export and expose:

```js
{
  normalizeProfile,
  normalizeStats,
  normalizeActivity,
  aggregateSevenDayTrend,
  normalizePayload,
  sanitizeUrl
}
```

Use these rules:

- Convert missing numeric values to `null`, never `0`.
- Treat `post_count` as total posts and derive replies as `post_count - topic_count` only when both are finite and the result is non-negative.
- Resolve relative avatar/profile/activity URLs against `https://baipiao.org`.
- Allow only `https://baipiao.org/` URLs in normalized output; reject `javascript:`, `data:`, external, and malformed URLs.
- Recognize `topic`, `topic_created`, `new_topic`, `reply`, `post`, and `activity` type aliases.
- De-duplicate activities by explicit ID first, then by `(type, url, timestamp, title)`.
- Sort activities newest first and cap at 5 in the normalized payload.
- Set `source` to the caller-provided `"api"`, `"dom"`, or `"mixed"`.

- [ ] **Step 4: Add representative fixtures**

Create `tests/fixtures/profile-responses.js` with static objects for:

- a complete Discourse-like `user` plus `summary`;
- an activity response with topic and reply records;
- a logged-out response with `{ error: "not_logged_in" }`;
- a partial DOM-style payload with only username and activity links.

The fixture values must be synthetic and contain no real user data.

- [ ] **Step 5: Run adapter tests and commit the pure module**

Run:

```powershell
node --test tests/data-adapter.test.js
```

Expected: all adapter tests pass. Commit:

```powershell
git add lib/data-adapter.js tests/data-adapter.test.js tests/fixtures/profile-responses.js
git commit -m "feat: normalize Baipiao profile data"
```

## Task 3: Add safe cache storage

**Files:**
- Modify: `lib/storage.js`
- Create: `tests/storage.test.js`

- [ ] **Step 1: Write failing storage allowlist tests**

Test that `saveSnapshot` stores only the normalized profile/stat/activity/trend model and timestamp, while dropping keys named `cookie`, `password`, `authorization`, `token`, `html`, `raw`, and arbitrary unknown keys.

The test must use an injected memory backend:

```js
const { createStorage } = require("../lib/storage");

test("cache strips credential-like and raw-response fields", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value)
  });

  await storage.saveSnapshot({
    profile: { username: "demo", password: "bad-data" },
    stats: { topics: 2, authorization: "bad-data" },
    activity: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    raw: "<html>bad-data</html>",
    cookie: "bad-data"
  });

  const saved = await storage.loadSnapshot();
  assert.equal(saved.profile.username, "demo");
  assert.equal("password" in saved.profile, false);
  assert.equal("authorization" in saved.stats, false);
  assert.equal("raw" in saved, false);
  assert.equal("cookie" in saved, false);
});
```

- [ ] **Step 2: Run the focused storage test and verify it fails**

Run:

```powershell
node --test tests/storage.test.js
```

Expected: FAIL because `createStorage` and the allowlist are not implemented.

- [ ] **Step 3: Implement the storage wrapper**

Implement `lib/storage.js` with:

```js
const STORAGE_KEY = "baipiao.stats.snapshot";
const THEME_KEY = "baipiao.stats.theme";

function createStorage(backend = chrome.storage.local) {}
```

Expose `createStorage`, `STORAGE_KEY`, and `THEME_KEY`. For extension runtime, wrap `chrome.storage.local.get/set` in Promises. For tests, accept an async `{ get, set }` backend.

`saveSnapshot` must construct a new object containing only:

```js
{
  profile: { username, displayName, avatarUrl, trustLevel, trustLabel, joinedAt, lastSeenAt, profileUrl },
  stats: { topics, replies, likesReceived, likesGiven, daysVisited, views },
  activity: [{ type, title, category, timestamp, url }],
  trend: [{ date, count }],
  fetchedAt,
  source
}
```

`loadSnapshot` returns `null` when no valid snapshot exists. `saveTheme` accepts only `"light"` or `"dark"`.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
node --test tests/storage.test.js
```

Expected: all storage tests pass. Commit:

```powershell
git add lib/storage.js tests/storage.test.js
git commit -m "feat: cache normalized stats safely"
```

## Task 4: Implement the same-origin content script collector

**Files:**
- Modify: `content.js`
- Modify: `lib/data-adapter.js`

- [ ] **Step 1: Add endpoint candidates and request helpers**

Implement `content.js` with constants:

```js
const BASE_PATH = "/bbs";
const ENDPOINTS = {
  session: ["/bbs/session/current.json", "/bbs/api/session/current"],
  user: (username) => [
    `/bbs/u/${encodeURIComponent(username)}.json`,
    `/bbs/u/${encodeURIComponent(username)}/summary.json`
  ],
  activity: (username) => [
    `/bbs/u/${encodeURIComponent(username)}/activity.json`,
    `/bbs/u/${encodeURIComponent(username)}/activity`
  ]
};
```

Implement `requestJson(path, timeoutMs = 1800)` using `fetch(path, { credentials: "include", headers: { Accept: "application/json" } })` and an `AbortController`. Return `{ ok, status, body }` without exposing headers or raw body outside the collector.

- [ ] **Step 2: Add the session/profile probe**

Implement `collectCommunityStats()`:

1. Probe session candidates until a JSON response identifies a current user.
2. If no user is returned, return `{ ok: false, code: "not_logged_in", message: "请先登录白嫖社区" }`.
3. Probe user and activity candidates using the current username.
4. Normalize the combined response with `normalizePayload(..., "api")`.
5. If endpoint probing fails or returns partial data, merge DOM fallback data and use source `"mixed"`.
6. Return only `{ ok, data, fetchedAt }`, never the original response object.

Load `lib/data-adapter.js` before `content.js` in the manifest content-script order and use its browser global (`globalThis.BaipiaoData`) inside the collector. Do not use `require` in extension runtime files.

The collector must reject any URL not rooted at `https://baipiao.org/bbs/` and must not access `document.cookie`, password inputs, local storage from the community page, or arbitrary third-party URLs.

- [ ] **Step 3: Add DOM fallback extraction**

Implement `collectDomFallback()` using selectors that are limited to:

- profile links matching `/bbs/u/<username>`;
- topic links matching `/bbs/d/<id>-<slug>`;
- visible text around those links for title, category, reply count and relative timestamp.

Return only a partial adapter payload. If the current page is not a user page, use the first visible `/bbs/u/` link only when it is unambiguously the logged-in user link exposed by the page header; otherwise return an empty partial payload.

- [ ] **Step 4: Add the content-script message listener**

Register:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_BAIPIAO_STATS") return undefined;
  collectCommunityStats()
    .then(sendResponse)
    .catch(() => sendResponse({
      ok: false,
      code: "collector_failed",
      message: "暂时无法读取社区数据"
    }));
  return true;
});
```

- [ ] **Step 5: Run syntax checks and commit**

Run:

```powershell
node --check content.js
node --check lib/data-adapter.js
```

Expected: both commands exit with code 0. Commit:

```powershell
git add content.js lib/data-adapter.js
git commit -m "feat: collect stats from signed-in community pages"
```

## Task 5: Implement the service worker bridge

**Files:**
- Modify: `background.js`
- Modify: `lib/storage.js`

- [ ] **Step 1: Add target-tab lookup**

Load `lib/storage.js` at the top of `background.js` with `importScripts("lib/storage.js")`, then create one storage instance from `globalThis.BaipiaoStorage.createStorage()`.

Implement `findCommunityTab()` with `chrome.tabs.query({ url: ["https://baipiao.org/bbs/*"] })`, preferring the active tab in the current window and then the most recently returned tab.

- [ ] **Step 2: Add controlled tab creation and message timeout**

Implement:

```js
async function getOrCreateCommunityTab() {}
async function requestFromContentScript(tabId, message, timeoutMs = 3000) {}
```

`getOrCreateCommunityTab` creates `https://baipiao.org/bbs/` with `active: false` only when no matching tab exists. `requestFromContentScript` calls `chrome.tabs.sendMessage` and resolves with `{ ok: false, code: "timeout" }` after 3000ms. Do not retry indefinitely.

- [ ] **Step 3: Route popup requests**

Register a runtime listener for:

- `GET_STATS`: find/create target tab, send `GET_BAIPIAO_STATS`, save successful normalized data, return `{ ok, data, cached, fetchedAt }`.
- `GET_CACHED_STATS`: return the normalized storage snapshot.
- `OPEN_URL`: allow only `https://baipiao.org/bbs/` URLs before calling `chrome.tabs.create`.

For a failed refresh with a cached snapshot, return `{ ok: false, cached: snapshot, message }` so the popup can preserve useful data.

- [ ] **Step 4: Add service-worker startup smoke checks**

Run:

```powershell
node --check background.js
node --check lib/storage.js
```

Expected: both commands exit with code 0. Commit:

```powershell
git add background.js lib/storage.js
git commit -m "feat: bridge popup requests to community tabs"
```

## Task 6: Build the popup UI

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`

- [ ] **Step 1: Add semantic popup sections**

The popup must render:

- `header` with logo, "白嫖社区", username/handle and icon-only refresh button.
- `section` for profile metadata and `打开个人主页`.
- `section` with a four-column stat grid for topics, replies, received likes and given likes.
- `section` with seven fixed trend bars and an empty state.
- `section` with the five most recent activities.
- `footer` with "打开社区" and last-updated text.
- `div[role="status"]` for loading and `div[role="alert"]` for errors.

Use no inline scripts and no external assets.

- [ ] **Step 2: Add the visual system**

Implement `popup.css` with:

```css
:root {
  color-scheme: light;
  --ink: #17201d;
  --muted: #6d7773;
  --line: #dfe7e3;
  --paper: #f7faf8;
  --surface: #ffffff;
  --mint: #25b79b;
  --mint-soft: #dff5ee;
  --orange: #ee8c3a;
  --orange-soft: #fff0df;
  --danger: #bd4d4d;
}
```

Keep the popup between 360px and 400px wide, use 8px or smaller radii, keep all text inside fixed rows, expose `:focus-visible`, and disable transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 3: Implement the popup state machine**

Implement `popup.js` states:

```js
const state = {
  status: "loading",
  data: null,
  cached: false,
  message: "",
  error: ""
};
```

On `DOMContentLoaded`:

1. Render loading.
2. Request `GET_CACHED_STATS` and render it immediately when present.
3. Request `GET_STATS`.
4. Render success, partial cached failure, not-logged-in, or generic error.

Rendering rules:

- Use `textContent`, never `innerHTML` for server-derived strings.
- Use `Intl.NumberFormat("zh-CN")` for finite numeric stats.
- Display unavailable values as `—`.
- Build activity links only after checking the normalized URL starts with `https://baipiao.org/bbs/`.
- Format relative dates in Chinese with a safe fallback to a locale date.
- Set `aria-busy` during loading and `aria-live` on status/error containers.

- [ ] **Step 4: Add user actions**

Wire:

- refresh button to request `GET_STATS`;
- profile button to `OPEN_URL` with `data.profile.profileUrl`;
- community button to `OPEN_URL` with `https://baipiao.org/bbs/`;
- activity links to normal browser navigation in a new tab.

Disable refresh while a request is active and prevent duplicate requests.

- [ ] **Step 5: Run syntax and static checks**

Run:

```powershell
npm run check
Get-ChildItem -Recurse -File | Select-String -Pattern 'document\.cookie|<all_urls>|http://|https?://(?!baipiao\.org)' 
```

Expected: syntax checks pass; the search finds no cookie access, broad host permission, or third-party endpoint.

Commit:

```powershell
git add popup.html popup.css popup.js
git commit -m "feat: add compact personal stats popup"
```

## Task 7: Add integration-safe error and cache behavior

**Files:**
- Modify: `popup.js`
- Modify: `background.js`
- Modify: `content.js`
- Modify: `README.md`

- [ ] **Step 1: Add explicit error codes**

Use only these user-facing state codes:

```js
const ERROR_COPY = {
  not_logged_in: ["请先登录白嫖社区", "打开社区并完成登录后再刷新。"],
  timeout: ["读取超时", "社区响应较慢，请稍后重试。"],
  collector_failed: ["暂时无法读取", "请确认当前页面仍可访问白嫖社区。"],
  no_profile: ["未找到个人资料", "打开个人主页后再试一次。"]
};
```

Keep error messages independent of raw server responses so the popup cannot expose HTML or internal headers.

- [ ] **Step 2: Preserve cached data on refresh failure**

When `GET_STATS` returns `{ ok: false, cached }`, render the cached profile/stats/activity with a small status line containing the translated error. The refresh button remains usable after the request settles.

- [ ] **Step 3: Verify permission and storage boundaries**

Run:

```powershell
rg -n "cookie|password|authorization|token|raw|document\.cookie|<all_urls>|webRequest|history" .
Get-Content -Raw .\manifest.json | ConvertFrom-Json | Select-Object permissions,host_permissions
```

Expected: only the documented storage allowlist and explanatory README mentions remain; manifest permissions are exactly `storage`, `tabs`, `scripting`, and the host permission is only `https://baipiao.org/bbs/*`.

- [ ] **Step 4: Commit the reliability pass**

```powershell
git add popup.js background.js content.js README.md
git commit -m "feat: handle login and refresh failures safely"
```

## Task 8: Browser smoke verification

**Files:**
- Modify only if verification exposes a defect: `manifest.json`, `popup.html`, `popup.css`, `popup.js`, `background.js`, `content.js`

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm test
npm run check
Get-Content -Raw .\manifest.json | ConvertFrom-Json | Out-Null
git status --short
```

Expected: all tests pass, all syntax checks pass, manifest parsing succeeds, and the only changed files are inside `baipiao-community-stats-extension`.

- [ ] **Step 2: Validate the popup at a fixed viewport**

Use Playwright or an equivalent browser smoke harness to load `popup.html` with a mocked `chrome.runtime.sendMessage` that returns:

- a complete successful snapshot;
- a not-logged-in error;
- a cached snapshot plus timeout.

Assert:

```js
await expect(page.locator("#displayName")).toHaveText("Demo User");
await expect(page.locator("#topicsValue")).toHaveText("4");
await expect(page.locator("#activityList a")).toHaveCount(2);
await expect(page.locator("#statePanel")).toBeVisible();
```

Capture a screenshot at 380x720 and inspect for:

- no horizontal overflow;
- no clipped Chinese text;
- refresh button remains visible;
- activity links are readable and keyboard focus is visible.

- [ ] **Step 3: Validate the extension manually in Edge/Chrome**

Load the unpacked directory from the browser extensions page. On a logged-out `baipiao.org/bbs/` page, click the extension and verify the login state. On a logged-in page, verify profile/stat/activity data and the refresh action. Do not submit forms, post content, like content, or grant unrelated permissions.

- [ ] **Step 4: Run final repository checks**

Run:

```powershell
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors, no changes in `newapi-checkin-edge-audit`, and recent commits describe the independent extension work.

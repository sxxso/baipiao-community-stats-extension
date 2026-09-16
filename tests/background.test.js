const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackground, isAllowedCommunityUrl } = require("../background");

function makeChrome(overrides = {}) {
  return {
    tabs: {
      query: async () => [],
      create: async (options) => ({ id: 99, ...options }),
      sendMessage: async () => ({ ok: true }),
      remove: async () => undefined,
      ...overrides.tabs,
    },
    runtime: {
      onMessage: { addListener() {} },
      getManifest: () => ({ version: "0.2.5" }),
      ...overrides.runtime,
    },
    scripting: {
      executeScript: async () => undefined,
      ...overrides.scripting,
    },
  };
}

test("allows only secure Baipiao community URLs", () => {
  assert.equal(isAllowedCommunityUrl("https://baipiao.org/bbs/"), true);
  assert.equal(isAllowedCommunityUrl("https://baipiao.org/bbs/u/demo"), true);
  assert.equal(isAllowedCommunityUrl("http://baipiao.org/bbs/"), false);
  assert.equal(isAllowedCommunityUrl("https://example.com/bbs/"), false);
  assert.equal(isAllowedCommunityUrl("javascript:alert(1)"), false);
});

test("prefers an active community tab before creating one", async () => {
  const calls = [];
  const chrome = makeChrome({
    tabs: {
      query: async (query) => {
        calls.push(query);
        if (query.active) return [{ id: 7, active: true, url: "https://baipiao.org/bbs/" }];
        return [];
      },
    },
  });
  const bridge = createBackground({ chrome, storage: null });

  const tab = await bridge.getOrCreateCommunityTab();
  assert.equal(tab.id, 7);
  assert.equal(calls[0].active, true);
});

test("returns cached data when a content request times out", async () => {
  const cached = {
    profile: { username: "demo" },
    stats: {},
    activity: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "dom",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => new Promise(() => {}),
    },
  });
  const storage = {
    loadSnapshot: async () => cached,
    saveSnapshot: async (value) => value,
  };
  const bridge = createBackground({ chrome, storage });

  const result = await bridge.handleMessage(
    { type: "GET_STATS" },
    { timeoutMs: 20 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
  assert.equal(result.cached.profile.username, "demo");
});

test("waits for one slow content response without starting duplicate collectors", async () => {
  let sendCount = 0;
  const data = {
    profile: { username: "demo" },
    stats: {},
    activity: [],
    moneyHistory: [{ id: 1 }],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => {
        sendCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { ok: true, data };
      },
    },
  });
  const bridge = createBackground({ chrome, storage: null });

  const result = await bridge.handleMessage(
    { type: "GET_STATS" },
    { timeoutMs: 600 },
  );

  assert.equal(result.ok, true);
  assert.equal(sendCount, 1);
});

test("injects the collector once when an existing tab has no content script", async () => {
  let sendCount = 0;
  let injectionCount = 0;
  const data = {
    profile: { username: "demo" },
    stats: {},
    activity: [],
    moneyHistory: [{ id: 1 }],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => {
        sendCount += 1;
        if (sendCount === 1) return undefined;
        return { ok: true, data };
      },
    },
    scripting: {
      executeScript: async () => {
        injectionCount += 1;
      },
    },
  });
  const bridge = createBackground({ chrome, storage: null });

  const result = await bridge.handleMessage(
    { type: "GET_STATS" },
    { timeoutMs: 500 },
  );

  assert.equal(result.ok, true);
  assert.equal(sendCount, 2);
  assert.equal(injectionCount, 1);
});

test("enriches a profile snapshot with finance history requested from the current tab", async () => {
  let statsMessageCount = 0;
  let createdTabs = 0;
  let historyMessage = null;
  const data = {
    profile: { username: "demo" },
    stats: { money: 13, communityLevel: -1, levelLabel: "白嫖预备" },
    activity: [],
    moneyHistory: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      query: async (query) =>
        query.url ? [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }] : [],
      create: async (options) => {
        createdTabs += 1;
        return { id: 99, ...options };
      },
      sendMessage: async (tabId, message) => {
        if (message.type === "GET_BAIPIAO_STATS") {
          statsMessageCount += 1;
          return { ok: true, data };
        }
        historyMessage = message;
        return {
          ok: true,
          data: [
            {
              type: "奖励",
              timestamp: "2026-09-10 10:00:00",
              id: 950,
              operator: "admin",
              amount: 10,
              balanceBefore: 4,
              balanceAfter: 14,
              purpose: "活动奖励",
            },
          ],
        };
      },
      remove: async () => undefined,
    },
  });
  const bridge = createBackground({ chrome, storage: null });

  const result = await bridge.handleMessage({ type: "GET_STATS" }, { timeoutMs: 500 });

  assert.equal(result.ok, true);
  assert.equal(statsMessageCount, 1);
  assert.equal(createdTabs, 0);
  assert.equal(historyMessage.waitMs, 6000);
  assert.equal(result.data.stats.money, 13);
  assert.equal(result.data.moneyHistory.length, 1);
});

test("keeps enriched finance history in both the returned and cached snapshot", async () => {
  let savedSnapshot = null;
  const data = {
    profile: { username: "demo" },
    stats: { money: 796, communityLevel: -1, levelLabel: "白嫖预备" },
    activity: [],
    moneyHistory: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const history = {
    type: "奖励",
    timestamp: "2026-09-10 10:00:00",
    id: 950,
    operator: "admin",
    amount: 10,
    balanceBefore: 4,
    balanceAfter: 14,
    purpose: "活动奖励",
  };
  const chrome = makeChrome({
    tabs: {
      query: async (query) =>
        query.url ? [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }] : [],
      create: async (options) => ({ id: options.url.includes("money/history") ? 88 : 99, ...options }),
      sendMessage: async (tabId, message) =>
        message.type === "GET_BAIPIAO_STATS"
          ? { ok: true, data }
          : { ok: true, data: [history] },
      remove: async () => undefined,
    },
  });
  const storage = {
    saveSnapshot: async (snapshot) => {
      savedSnapshot = snapshot;
      return snapshot;
    },
    loadSnapshot: async () => null,
  };
  const bridge = createBackground({ chrome, storage });

  const result = await bridge.handleMessage({ type: "GET_STATS" }, { timeoutMs: 500 });

  assert.equal(result.data.stats.money, 796);
  assert.equal(result.data.moneyHistory.length, 1);
  assert.equal(savedSnapshot.stats.money, 796);
  assert.equal(savedSnapshot.moneyHistory.length, 1);
});

test("keeps cached activities when a fresh read returns none", async () => {
  let savedSnapshot = null;
  const cached = {
    profile: { username: "demo" },
    stats: { money: 7 },
    activity: [
      {
        type: "reply",
        title: "Old activity",
        category: null,
        timestamp: "2026-09-09T10:00:00+00:00",
        url: "https://baipiao.org/bbs/d/551-other/4",
      },
    ],
    trend: [{ date: "2026-09-09", count: 1 }],
    moneyHistory: [],
    fetchedAt: "2026-09-09T10:00:00+00:00",
    source: "mixed",
  };
  const data = {
    profile: { username: "demo" },
    stats: { money: 13, communityLevel: -1, levelLabel: "白嫖预备" },
    activity: [],
    moneyHistory: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "mixed",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => ({ ok: true, data }),
    },
  });
  const storage = {
    saveSnapshot: async (snapshot) => {
      savedSnapshot = snapshot;
      return snapshot;
    },
    loadSnapshot: async () => cached,
  };
  const bridge = createBackground({ chrome, storage });

  const result = await bridge.handleMessage({ type: "GET_STATS" }, { timeoutMs: 500 });

  assert.equal(result.ok, true);
  assert.equal(result.data.stats.money, 13);
  assert.equal(result.data.activity.length, 1);
  assert.equal(result.data.activity[0].title, "Old activity");
  assert.deepEqual(result.data.trend, [{ date: "2026-09-09", count: 1 }]);
  assert.equal(savedSnapshot.activity.length, 1);
  assert.equal(result.data.fetchedAt, "2026-09-10T00:00:00Z");
});

test("keeps the cached leaderboard when a fresh read returns none", async () => {
  let savedSnapshot = null;
  const cachedLeaderboard = {
    top: [{ rank: 1, username: "admin", money: 2833, url: "https://baipiao.org/bbs/u/admin", isMe: false }],
    me: { rank: 20, money: 81, inTop: false },
    total: 503,
  };
  const cached = {
    profile: { username: "demo" },
    stats: { money: 81 },
    activity: [],
    moneyHistory: [],
    leaderboard: cachedLeaderboard,
    trend: [],
    fetchedAt: "2026-09-09T10:00:00+00:00",
    source: "mixed",
  };
  const data = {
    profile: { username: "demo" },
    stats: { money: 81 },
    activity: [{ type: "reply", title: "Fresh", category: null, timestamp: "2026-09-10T00:00:00Z", url: "https://baipiao.org/bbs/d/551/1" }],
    moneyHistory: [],
    leaderboard: null,
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => ({ ok: true, data }),
    },
  });
  const storage = {
    saveSnapshot: async (snapshot) => {
      savedSnapshot = snapshot;
      return snapshot;
    },
    loadSnapshot: async () => cached,
  };
  const bridge = createBackground({ chrome, storage });

  const result = await bridge.handleMessage({ type: "GET_STATS" }, { timeoutMs: 500 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.leaderboard, cachedLeaderboard);
  assert.deepEqual(savedSnapshot.leaderboard, cachedLeaderboard);
});

test("returns and caches a fresh leaderboard without touching the cache", async () => {
  let savedSnapshot = null;
  const freshLeaderboard = {
    top: [{ rank: 1, username: "admin", money: 3000, url: "https://baipiao.org/bbs/u/admin", isMe: false }],
    me: { rank: 2, money: 90, inTop: true },
    total: 510,
  };
  const data = {
    profile: { username: "demo" },
    stats: { money: 90 },
    activity: [{ type: "reply", title: "Fresh", category: null, timestamp: "2026-09-10T00:00:00Z", url: "https://baipiao.org/bbs/d/551/1" }],
    moneyHistory: [],
    leaderboard: freshLeaderboard,
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      query: async () => [{ id: 7, status: "complete", url: "https://baipiao.org/bbs/" }],
      sendMessage: async () => ({ ok: true, data }),
    },
  });
  const storage = {
    saveSnapshot: async (snapshot) => {
      savedSnapshot = snapshot;
      return snapshot;
    },
    loadSnapshot: async () => {
      throw new Error("cache must not be read when fresh leaderboard exists");
    },
  };
  const bridge = createBackground({ chrome, storage });

  const result = await bridge.handleMessage({ type: "GET_STATS" }, { timeoutMs: 500 });

  assert.equal(result.ok, true);
  assert.equal(result.data.leaderboard.total, 510);
  assert.equal(savedSnapshot.leaderboard.me.rank, 2);
});

test("serves an in-page widget request from the sender tab", async () => {
  const data = {
    profile: { username: "demo" },
    stats: { money: 796, communityLevel: -1, levelLabel: "白嫖预备" },
    activity: [],
    moneyHistory: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  };
  const chrome = makeChrome({
    tabs: {
      sendMessage: async (tabId, message) =>
        message.type === "GET_BAIPIAO_STATS"
          ? { ok: true, data }
          : {
              ok: true,
              data: [
                {
                  type: "奖励",
                  timestamp: "2026-09-10 10:00:00",
                  id: 950,
                  operator: "admin",
                  amount: 10,
                  balanceBefore: 4,
                  balanceAfter: 14,
                  purpose: "活动奖励",
                },
              ],
            },
      remove: async () => undefined,
    },
  });
  const bridge = createBackground({ chrome, storage: null });

  const result = await bridge.handleMessage(
    { type: "GET_WIDGET_STATS" },
    { senderTabId: 7, timeoutMs: 500 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.moneyHistory.length, 1);
});

test("compares release versions numerically", () => {
  const bridge = createBackground({ chrome: makeChrome(), storage: null });

  assert.equal(bridge.compareVersions("v0.2.6", "0.2.5"), 1);
  assert.equal(bridge.compareVersions("0.2.5", "v0.2.5"), 0);
  assert.equal(bridge.compareVersions("0.2.10", "0.2.9"), 1);
  assert.equal(bridge.compareVersions("0.3.0", "0.10.0"), -1);
  assert.equal(bridge.compareVersions("", "0.2.5"), -1);
});

test("detects a newer release from the GitHub update check", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v0.2.6",
      html_url:
        "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
    }),
  });
  const bridge = createBackground({ chrome: makeChrome(), storage: null });

  try {
    const result = await bridge.checkForUpdate({ force: true });
    assert.equal(result.ok, true);
    assert.equal(result.update.available, true);
    assert.equal(result.update.currentVersion, "0.2.5");
    assert.equal(result.update.latestVersion, "0.2.6");
    assert.equal(
      result.update.url,
      "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
    );
    assert.ok(result.update.checkedAt > 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reports no update when the running version is current", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ tag_name: "v0.2.5", html_url: "https://github.com/x" }),
  });
  const bridge = createBackground({ chrome: makeChrome(), storage: null });

  try {
    const result = await bridge.checkForUpdate({ force: true });
    assert.equal(result.update.available, false);
    assert.equal(result.update.latestVersion, "0.2.5");
  } finally {
    global.fetch = originalFetch;
  }
});

test("keeps the previous update info when the release check fails", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("offline");
  };
  const backend = new Map();
  const storage = {
    loadUpdateInfo: async () => backend.get("update") || null,
    saveUpdateInfo: async (info) => {
      backend.set("update", info);
      return info;
    },
  };
  const bridge = createBackground({ chrome: makeChrome(), storage });

  try {
    const first = await bridge.checkForUpdate({ force: true });
    assert.equal(first.update.available, false);
    assert.equal(first.update.latestVersion, null);
    assert.ok(first.update.checkedAt > 0);

    backend.set("update", {
      latestVersion: "0.2.9",
      url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.9",
      checkedAt: 1,
      dismissedVersion: null,
    });
    const second = await bridge.checkForUpdate({ force: true });
    assert.equal(second.update.available, true);
    assert.equal(second.update.latestVersion, "0.2.9");
    assert.ok(second.update.checkedAt > 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("skips the network check while the cached check is fresh", async () => {
  let fetchCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ tag_name: "v9.0.0" }) };
  };
  const storage = {
    loadUpdateInfo: async () => ({
      latestVersion: "0.2.5",
      url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/latest",
      checkedAt: Date.now(),
      dismissedVersion: null,
    }),
    saveUpdateInfo: async (info) => info,
  };
  const bridge = createBackground({ chrome: makeChrome(), storage });

  try {
    const result = await bridge.checkForUpdate({ force: false });
    assert.equal(fetchCount, 0);
    assert.equal(result.update.available, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("routes update info, dismissal, and release page messages", async () => {
  const { RELEASES_PAGE_URL } = require("../background");
  const backend = new Map();
  const openedUrls = [];
  const chrome = makeChrome({
    tabs: {
      query: async () => [],
      create: async (options) => {
        openedUrls.push(options.url);
        return { id: 5 };
      },
      sendMessage: async () => ({ ok: true }),
      remove: async () => undefined,
    },
  });
  const storage = {
    loadUpdateInfo: async () => backend.get("update") || null,
    saveUpdateInfo: async (info) => {
      backend.set("update", info);
      return info;
    },
  };
  const bridge = createBackground({ chrome, storage });
  backend.set("update", {
    latestVersion: "0.2.6",
    url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
    checkedAt: Date.now(),
    dismissedVersion: null,
  });

  const info = await bridge.handleMessage({ type: "GET_UPDATE_INFO" });
  assert.equal(info.ok, true);
  assert.equal(info.update.available, true);

  const opened = await bridge.handleMessage({ type: "OPEN_UPDATE_PAGE" });
  assert.equal(opened.ok, true);
  assert.deepEqual(openedUrls, [RELEASES_PAGE_URL]);

  await bridge.handleMessage({ type: "DISMISS_UPDATE" });
  assert.equal(backend.get("update").dismissedVersion, "0.2.6");
  const after = await bridge.handleMessage({ type: "GET_UPDATE_INFO" });
  assert.equal(after.update.available, false);
});

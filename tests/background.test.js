const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackground, isAllowedCommunityUrl } = require("../background");

function makeChrome(overrides = {}) {
  return {
    tabs: {
      query: async () => [],
      create: async (options) => ({ id: 99, ...options }),
      sendMessage: async () => ({ ok: true }),
      ...overrides.tabs,
    },
    runtime: {
      onMessage: { addListener() {} },
      ...overrides.runtime,
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

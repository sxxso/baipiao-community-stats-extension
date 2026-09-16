const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorage, sanitizeUpdateInfo } = require("../lib/storage");

test("cache strips credential-like and raw-response fields", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  await storage.saveSnapshot({
    profile: { username: "demo", password: "bad-data" },
    stats: { topics: 2, money: 13, communityLevel: -1, levelLabel: "白嫖预备", authorization: "bad-data" },
    activity: [],
    moneyHistory: [
      {
        type: "奖励",
        timestamp: "2026-09-10 10:00:00",
        id: 950,
        operator: "admin",
        amount: 792,
        balanceBefore: 4,
        balanceAfter: 796,
        purpose: "活动奖励",
        raw: "discard",
      },
    ],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    raw: "<html>bad-data</html>",
    cookie: "bad-data",
  });

  const saved = await storage.loadSnapshot();
  assert.equal(saved.profile.username, "demo");
  assert.equal(saved.stats.money, 13);
  assert.equal(saved.stats.communityLevel, -1);
  assert.equal(saved.stats.levelLabel, "白嫖预备");
  assert.equal(saved.moneyHistory.length, 1);
  assert.equal("raw" in saved.moneyHistory[0], false);
  assert.equal("password" in saved.profile, false);
  assert.equal("authorization" in saved.stats, false);
  assert.equal("raw" in saved, false);
  assert.equal("cookie" in saved, false);
});

test("sanitizes the leaderboard block and drops unsafe entries", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  const rows = [];
  for (let rank = 1; rank <= 15; rank += 1) {
    rows.push({
      rank,
      username: `user${rank}`,
      money: 1000 - rank,
      url: `https://baipiao.org/bbs/u/user${rank}`,
      isMe: rank === 1,
      raw: "discard",
    });
  }
  rows.push({ rank: 99, username: "bad", money: 5, url: "javascript:alert(1)" });

  await storage.saveSnapshot({
    profile: { username: "user1" },
    stats: { money: 900 },
    activity: [],
    moneyHistory: [],
    leaderboard: { top: rows, me: { rank: 1, money: 999, inTop: true, cookie: "x" }, total: 503 },
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  });

  const saved = await storage.loadSnapshot();
  assert.equal(saved.leaderboard.top.length, 10);
  assert.equal("raw" in saved.leaderboard.top[0], false);
  assert.equal(
    saved.leaderboard.top.some((entry) => entry.username === "bad"),
    false,
  );
  assert.equal(saved.leaderboard.me.rank, 1);
  assert.equal("cookie" in saved.leaderboard.me, false);
  assert.equal(saved.leaderboard.total, 503);
});

test("returns a null leaderboard when there is no usable data", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  await storage.saveSnapshot({
    profile: { username: "demo" },
    stats: { money: 1 },
    activity: [],
    moneyHistory: [],
    leaderboard: { top: [], me: null, total: null },
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "api",
  });

  const saved = await storage.loadSnapshot();
  assert.equal(saved.leaderboard, null);
});

test("returns null when no cached snapshot exists", async () => {
  const storage = createStorage({
    get: async () => undefined,
    set: async () => undefined,
  });

  assert.equal(await storage.loadSnapshot(), null);
});

test("accepts only supported theme values", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  await storage.saveTheme("dark");
  assert.equal(await storage.loadTheme(), "dark");
  await storage.saveTheme("neon");
  assert.equal(await storage.loadTheme(), "dark");
});

test("sanitizes update info and only accepts GitHub release pages", async () => {
  assert.equal(sanitizeUpdateInfo(null), null);
  assert.equal(sanitizeUpdateInfo({}), null);
  assert.deepEqual(sanitizeUpdateInfo({ latestVersion: "0.2.6", url: "https://evil.example/x" }), {
    latestVersion: "0.2.6",
    url: null,
    checkedAt: null,
    dismissedVersion: null,
  });
  assert.deepEqual(sanitizeUpdateInfo({ checkedAt: 5, url: "https://evil.example/x" }), {
    latestVersion: null,
    url: null,
    checkedAt: 5,
    dismissedVersion: null,
  });

  const safe = sanitizeUpdateInfo({
    latestVersion: " 0.2.6 ",
    url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
    checkedAt: 123,
    dismissedVersion: "0.2.5",
    raw: "discard",
  });
  assert.deepEqual(safe, {
    latestVersion: "0.2.6",
    url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
    checkedAt: 123,
    dismissedVersion: "0.2.5",
  });
});

test("persists and loads update info through the storage backend", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  await storage.saveUpdateInfo({
    latestVersion: "0.2.6",
    url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/latest",
    checkedAt: 456,
    dismissedVersion: null,
  });
  const loaded = await storage.loadUpdateInfo();
  assert.equal(loaded.latestVersion, "0.2.6");
  assert.equal(loaded.checkedAt, 456);
  assert.equal(loaded.dismissedVersion, null);
});

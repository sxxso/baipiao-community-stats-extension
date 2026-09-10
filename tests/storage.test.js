const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorage } = require("../lib/storage");

test("cache strips credential-like and raw-response fields", async () => {
  const backend = new Map();
  const storage = createStorage({
    get: async (key) => backend.get(key),
    set: async (key, value) => backend.set(key, value),
  });

  await storage.saveSnapshot({
    profile: { username: "demo", password: "bad-data" },
    stats: { topics: 2, authorization: "bad-data" },
    activity: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    raw: "<html>bad-data</html>",
    cookie: "bad-data",
  });

  const saved = await storage.loadSnapshot();
  assert.equal(saved.profile.username, "demo");
  assert.equal("password" in saved.profile, false);
  assert.equal("authorization" in saved.stats, false);
  assert.equal("raw" in saved, false);
  assert.equal("cookie" in saved, false);
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

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ERROR_COPY,
  formatCount,
  formatDate,
  formatRelative,
  isSafeCommunityUrl,
  load,
  refresh,
  state,
} = require("../popup");

test("formats counts without inventing unavailable values", () => {
  assert.equal(formatCount(null), "—");
  assert.equal(formatCount(undefined), "—");
  assert.equal(formatCount(1234), "1,234");
  assert.equal(formatCount("17"), "17");
});

test("formats dates and relative activity labels", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("2026-01-02T03:04:05Z"), "2026/01/02");
  assert.equal(
    formatRelative("2026-09-10T11:59:30Z", new Date("2026-09-10T12:00:00Z")),
    "刚刚",
  );
  assert.equal(
    formatRelative("2026-09-10T11:00:00Z", new Date("2026-09-10T12:00:00Z")),
    "1 小时前",
  );
});

test("keeps open actions inside the Baipiao community", () => {
  assert.equal(isSafeCommunityUrl("https://baipiao.org/bbs/u/demo"), true);
  assert.equal(isSafeCommunityUrl("https://baipiao.org/bbs/d/42-topic"), true);
  assert.equal(isSafeCommunityUrl("https://baipiao.org/free/api"), false);
  assert.equal(isSafeCommunityUrl("https://example.com/bbs/u/demo"), false);
});

test("shows balance and level while moving finance history out of the popup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");

  assert.match(html, /毛余额/);
  assert.match(html, /社区等级/);
  assert.match(html, /毛排行榜/);
  assert.doesNotMatch(html, /资金记录/);
  assert.doesNotMatch(html, /获赞|送赞/);
});

test("provides actionable copy for known failure states", () => {
  assert.deepEqual(ERROR_COPY.not_logged_in, [
    "请先登录白嫖社区",
    "打开社区并完成登录后再刷新。",
  ]);
  assert.equal(ERROR_COPY.timeout[0], "读取超时");
  assert.equal(ERROR_COPY.unknown[0], "暂时无法读取");
});

test("refresh replaces cached balance with the latest background snapshot", async () => {
  const originalChrome = global.chrome;
  const originalDocument = global.document;
  const fresh = {
    profile: { username: "demo" },
    stats: { money: 88 },
    activity: [],
    trend: [],
    fetchedAt: "2026-09-15T00:00:00Z",
    source: "api",
  };
  const requests = [];
  global.document = {
    getElementById: () => null,
  };
  global.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message.type);
        callback({ ok: true, data: fresh });
      },
    },
  };
  state.data = {
    profile: { username: "demo" },
    stats: { money: 13 },
  };
  state.cached = true;
  state.error = "stale";
  state.status = "success";
  state.requesting = false;

  try {
    await refresh();
    assert.deepEqual(requests, ["GET_STATS"]);
    assert.equal(state.data.stats.money, 88);
    assert.equal(state.cached, false);
    assert.equal(state.error, "");
    assert.equal(state.status, "success");
  } finally {
    global.chrome = originalChrome;
    global.document = originalDocument;
    state.data = null;
    state.cached = false;
    state.error = "";
    state.status = "loading";
    state.requesting = false;
  }
});

test("opening the popup reads cache without refreshing remote data", async () => {
  const originalChrome = global.chrome;
  const requests = [];
  const cached = {
    profile: { username: "demo" },
    stats: { money: 13 },
    activity: [],
    trend: [],
    fetchedAt: "2026-09-10T00:00:00Z",
    source: "dom",
  };
  global.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message.type);
        callback(message.type === "GET_CACHED_STATS" ? { ok: true, data: cached } : { ok: true });
      },
    },
  };
  state.data = null;
  state.cached = false;
  state.error = "";
  state.status = "loading";
  state.requesting = false;

  try {
    await load();
    assert.deepEqual(requests, ["GET_CACHED_STATS"]);
    assert.equal(state.data.profile.username, "demo");
    assert.equal(state.cached, true);
    assert.equal(state.requesting, false);
  } finally {
    global.chrome = originalChrome;
    state.data = null;
    state.cached = false;
    state.error = "";
    state.status = "loading";
    state.requesting = false;
  }
});

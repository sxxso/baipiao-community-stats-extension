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
  refreshUpdateInfo,
  dismissUpdate,
  renderCheckin,
  renderQuests,
  state,
} = require("../popup");

function makeElement() {
  const node = {
    children: [],
    dataset: {},
    style: {},
    hidden: false,
    textContent: "",
    className: "",
    classList: {
      add() {},
      toggle() {},
      contains: () => false,
    },
    append(...kids) {
      node.children.push(...kids);
    },
    appendChild(kid) {
      node.children.push(kid);
    },
    replaceChildren() {
      node.children.length = 0;
    },
    setAttribute() {},
    getAttribute: () => null,
  };
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, makeElement());
      return nodes.get(id);
    },
    createElement: () => makeElement(),
  };
}

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
  assert.match(html, /updateBanner/);
  assert.match(html, /每日签到/);
  assert.match(html, /每日任务/);
  assert.match(html, /checkinSection/);
  assert.match(html, /questsSection/);
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
    assert.deepEqual(requests, ["GET_STATS", "GET_UPDATE_INFO"]);
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

test("shows and dismisses the update banner from background update info", async () => {
  const originalChrome = global.chrome;
  const originalDocument = global.document;
  const nodes = {};
  const makeNode = (id) => (nodes[id] = nodes[id] || { hidden: true, textContent: "" });
  const requests = [];
  global.document = { getElementById: (id) => makeNode(id) };
  global.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message.type);
        if (message.type === "GET_UPDATE_INFO") {
          callback({
            ok: true,
            update: {
              available: true,
              currentVersion: "0.2.5",
              latestVersion: "0.2.6",
              url: "https://github.com/sxxso/baipiao-community-stats-extension/releases/tag/v0.2.6",
              checkedAt: 1,
            },
          });
        } else {
          callback({ ok: true });
        }
      },
    },
  };
  state.update = null;

  try {
    await refreshUpdateInfo();
    assert.deepEqual(requests, ["GET_UPDATE_INFO"]);
    assert.equal(makeNode("updateBanner").hidden, false);
    assert.equal(makeNode("updateVersion").textContent, "0.2.6");

    await dismissUpdate();
    assert.deepEqual(requests, ["GET_UPDATE_INFO", "DISMISS_UPDATE"]);
    assert.equal(makeNode("updateBanner").hidden, true);
  } finally {
    global.chrome = originalChrome;
    global.document = originalDocument;
    state.update = null;
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
    assert.deepEqual(requests, ["GET_CACHED_STATS", "GET_UPDATE_INFO"]);
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

test("renders the check-in card for today, the month total, and the next tier", () => {
  const originalDocument = global.document;
  global.document = makeDocument();

  try {
    renderCheckin({
      checkin: {
        month: "2026-09",
        checked: false,
        canCheckin: true,
        monthDays: 12,
        monthEarned: 26,
        todayReward: 3,
        maxDaily: 3,
        blockedReason: "",
        tier: { from: 16, to: null, amount: 3 },
        nextTier: { from: 6, to: 15, amount: 5, daysUntil: 4 },
        url: "https://baipiao.org/bbs/checkin",
      },
    });

    assert.equal(global.document.getElementById("checkinSection").hidden, false);
    assert.equal(global.document.getElementById("checkinState").textContent, "今日可签到");
    assert.equal(global.document.getElementById("checkinToday").textContent, "可得 +3 毛");
    assert.equal(
      global.document.getElementById("checkinMeta").textContent,
      "9 月已签 12 天 · 本月已得 26 毛",
    );
    assert.equal(
      global.document.getElementById("checkinNote").textContent,
      "当前 +3 毛/天 · 再签 4 天升到 +5 毛/天",
    );
    assert.equal(global.document.getElementById("checkinBlocked").hidden, true);
    assert.equal(
      global.document.getElementById("openCheckinButton").dataset.url,
      "https://baipiao.org/bbs/checkin",
    );
  } finally {
    global.document = originalDocument;
  }
});

test("reports an already completed check-in and a blocked reason", () => {
  const originalDocument = global.document;
  global.document = makeDocument();

  try {
    renderCheckin({
      checkin: {
        month: "2026-09",
        checked: true,
        canCheckin: false,
        monthDays: 5,
        monthEarned: 9,
        todayReward: 2,
        blockedReason: "今天已经签过了，明天再来",
      },
    });

    assert.equal(global.document.getElementById("checkinState").textContent, "今日已签到");
    assert.equal(global.document.getElementById("checkinToday").textContent, "+2 毛");
    assert.equal(global.document.getElementById("checkinBlocked").hidden, false);
    assert.equal(
      global.document.getElementById("checkinBlocked").textContent,
      "今天已经签过了，明天再来",
    );
  } finally {
    global.document = originalDocument;
  }
});

test("hides the check-in section when the site reports none", () => {
  const originalDocument = global.document;
  global.document = makeDocument();

  try {
    renderCheckin({ checkin: null });
    assert.equal(global.document.getElementById("checkinSection").hidden, true);
  } finally {
    global.document = originalDocument;
  }
});

test("renders unfinished daily quests first and hides the section when empty", () => {
  const originalDocument = global.document;
  global.document = makeDocument();

  try {
    renderQuests({
      quests: [
        { id: 1, name: "每日活跃", condition: "今天发布主题或回帖 1 次", reward: "+10 毛", done: false, daily: true, manual: false },
        { id: 2, name: "每日发主题", condition: "今天发布新主题 1 个", reward: "+10 毛", done: false, daily: true, manual: false },
        { id: 3, name: "首次发言见面礼", condition: "累计发布主题或回帖 1 次", reward: "+50 毛", done: true, daily: false, manual: false },
      ],
    });

    assert.equal(global.document.getElementById("questsSection").hidden, false);
    assert.equal(
      global.document.getElementById("questsNote").textContent,
      "待完成 2 / 3",
    );
    const list = global.document.getElementById("questsList");
    assert.equal(list.children.length, 3);
    assert.equal(list.children[0].children[1].children[0].textContent, "每日活跃");
    assert.equal(list.children[2].children[0].textContent, "已完成");
    assert.equal(global.document.getElementById("questsEmpty").hidden, true);

    renderQuests({ quests: [] });
    assert.equal(global.document.getElementById("questsSection").hidden, true);
    assert.equal(global.document.getElementById("questsList").children.length, 0);
  } finally {
    global.document = originalDocument;
  }
});

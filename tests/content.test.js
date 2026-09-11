const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectCommunityStats,
  collectMoneyHistory,
  extractFlarumActivityRecords,
  extractFlarumMoneyHistory,
  extractUserFromPath,
  isCommunityPath,
  normalizeDomActivity,
  parseFlarumPayload,
} = require("../content");

const flarumPayload = {
  resources: [
    {
      type: "users",
      id: "191",
      attributes: {
        username: "cjamrklll",
        displayName: "cjamrklll",
        avatarUrl: "https://baipiao.org/bbs/assets/avatars/demo.png",
        joinTime: "2026-08-01T07:00:30+00:00",
        lastSeenAt: "2026-09-10T15:18:09+00:00",
        discussionCount: 22,
        commentCount: 116,
        money: 13,
        titleBadge: { name: "幕后最终Boss" },
      },
    },
    {
      type: "forums",
      id: "1",
      attributes: {
        bpMyLevel: -1,
        bpLevelNames: ["白嫖入门", "白嫖高手", "白嫖大师"],
      },
    },
  ],
  session: { userId: 191 },
};

test("accepts only Baipiao community paths", () => {
  assert.equal(isCommunityPath("https://baipiao.org/bbs/"), true);
  assert.equal(isCommunityPath("https://baipiao.org/bbs/u/demo"), true);
  assert.equal(isCommunityPath("https://baipiao.org/free/api"), false);
  assert.equal(isCommunityPath("https://example.com/bbs/u/demo"), false);
  assert.equal(isCommunityPath("javascript:alert(1)"), false);
});

test("extracts a username only from a community profile path", () => {
  assert.equal(extractUserFromPath("/bbs/u/demo"), "demo");
  assert.equal(extractUserFromPath("/bbs/u/demo/activity"), "demo");
  assert.equal(extractUserFromPath("/bbs/d/42-topic"), null);
});

test("normalizes DOM activity links without allowing external destinations", () => {
  const activities = normalizeDomActivity([
    {
      href: "/bbs/d/42-topic",
      text: "分享一个主题",
      timestamp: "2026-09-10T01:00:00Z",
      category: "资源分享",
    },
    {
      href: "https://example.com/steal",
      text: "不应进入数据",
    },
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "topic");
  assert.equal(activities[0].title, "分享一个主题");
  assert.equal(activities[0].category, "资源分享");
  assert.equal(activities[0].url, "https://baipiao.org/bbs/d/42-topic");
});

test("reads the signed-in user and counters from the site's Flarum payload", () => {
  const result = parseFlarumPayload(flarumPayload);

  assert.equal(result.user.username, "cjamrklll");
  assert.equal(result.user.joinTime, "2026-08-01T07:00:30+00:00");
  assert.equal(result.summary.discussionCount, 22);
  assert.equal(result.summary.commentCount, 116);
  assert.equal(result.summary.money, 13);
  assert.equal(result.summary.levelLabel, "白嫖预备");
});

test("does not treat a public Flarum resource as the signed-in user", () => {
  const result = parseFlarumPayload({
    resources: [{ type: "users", id: "1", attributes: { username: "public-user" } }],
    session: {},
  });

  assert.equal(result.user, null);
});

test("returns a login error for a Flarum payload without a session user", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({
        resources: [{ type: "users", id: "1", attributes: { username: "public-user" } }],
        session: {},
      }),
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, false);
    assert.equal(result.code, "not_logged_in");
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
  }
});

test("extracts Flarum profile posts as topic and reply activities", () => {
  const makeLink = (href, text) => ({
    getAttribute: (name) => (name === "href" ? href : null),
    textContent: text,
  });
  const makeArticle = (datetime, postNumber, startUser = false) => ({
    classList: { contains: (name) => startUser && name === "Post--by-start-user" },
    querySelector: (selector) => {
      if (selector === "time[datetime]") {
        return { getAttribute: () => datetime };
      }
      if (selector === ".PostMeta-number") {
        return { textContent: `发布 #${postNumber}` };
      }
      return null;
    },
  });
  const groups = [
    {
      querySelector: () => makeLink("/bbs/d/552-demo/1", "Demo topic"),
      nextElementSibling: makeArticle("2026-09-10T01:00:00Z", 1, true),
    },
    {
      querySelector: () => makeLink("/bbs/d/551-other/4", "Other topic"),
      nextElementSibling: makeArticle("2026-09-09T01:00:00Z", 4),
    },
  ];

  const result = extractFlarumActivityRecords({
    querySelectorAll: () => groups,
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].type, "topic");
  assert.equal(result[0].title, "Demo topic");
  assert.equal(result[1].type, "reply");
  assert.equal(result[1].url, "/bbs/d/551-other/4");
});

test("extracts the site's finance history records without retaining raw HTML", () => {
  const makeContainer = () => ({
    querySelector: (selector) => {
      if (selector === ".moneyHistoryUser .username") return { textContent: "cjamrklll" };
      return null;
    },
    children: [
      { textContent: "类型: 扣费 | 时间: 2026-09-10 10:15:10" },
      {
        textContent:
          "ID: 961 | 操作人: cjamrklll | 金额: 30 | 余额变动: 30 → 0 | 资金用途: 称号熔炼",
      },
    ],
  });

  const result = extractFlarumMoneyHistory({
    querySelectorAll: () => [makeContainer()],
  });

  assert.deepEqual(result, [
    {
      type: "扣费",
      timestamp: "2026-09-10 10:15:10",
      id: 961,
      operator: "cjamrklll",
      amount: 30,
      balanceBefore: 30,
      balanceAfter: 0,
      purpose: "称号熔炼",
    },
  ]);
});

test("parses finance history when the page omits whitespace between fields", () => {
  const container = {
    textContent:
      "类型: 奖励\u00a0|\u00a0时间: 2026-09-10 10:00:05ID: 950\u00a0|\u00a0操作人:  cjamrklll\u00a0|\u00a0金额: 792\u00a0|\u00a0余额变动: 4\u00a0→\u00a0796\u00a0|\u00a0资金用途: antoinefr-money.forum.history.lottery-in",
    querySelector: () => ({ textContent: "cjamrklll" }),
  };

  const result = extractFlarumMoneyHistory({
    querySelectorAll: () => [container],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 950);
  assert.equal(result[0].balanceAfter, 796);
  assert.equal(result[0].purpose, "antoinefr-money.forum.history.lottery-in");
});

test("returns already-rendered finance records from the dedicated history page", async () => {
  const record = {
    textContent:
      "类型: 奖励 | 时间: 2026-09-10 10:00:00 ID: 950 | 操作人: admin | 金额: 10 | 余额变动: 4 → 14 | 资金用途: 活动奖励",
    querySelector: () => ({ textContent: "admin" }),
  };
  const originalDocument = global.document;
  global.document = {
    querySelectorAll: (selector) =>
      selector === ".transferHistoryContainer" ? [record] : [],
  };

  try {
    const result = await collectMoneyHistory({ waitMs: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].balanceAfter, 14);
  } finally {
    global.document = originalDocument;
  }
});

test("collects a Flarum profile page without probing guessed session endpoints", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const activityGroup = {
    querySelector: () => ({
      getAttribute: () => "/bbs/d/552-demo/1",
      textContent: "Demo topic",
    }),
    nextElementSibling: {
      classList: { contains: (name) => name === "Post--by-start-user" },
      querySelector: (selector) =>
        selector === "time[datetime]"
          ? { getAttribute: () => "2026-09-10T01:00:00Z" }
          : { textContent: "发布 #1" },
    },
  };
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === ".PostsUserPage-discussion" ? [activityGroup] : [],
  };
  global.location = { pathname: "/bbs/u/cjamrklll" };
  global.fetch = async () => {
    throw new Error("the current profile page should be sufficient");
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.profile.title, "幕后最终Boss");
    assert.equal(result.data.profile.joinedAt, "2026-08-01T07:00:30+00:00");
    assert.equal(result.data.stats.money, 13);
    assert.equal(result.data.stats.levelLabel, "白嫖预备");
    assert.equal(result.data.stats.topics, 22);
    assert.equal(result.data.stats.replies, 116);
    assert.equal(result.data.stats.money, 13);
    assert.equal(result.data.stats.levelLabel, "白嫖预备");
    assert.equal(result.data.activity.length, 1);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("loads the signed-in user's Flarum profile page when the current tab is the home page", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const originalDomParser = global.DOMParser;
  const moneyContainer = {
    textContent:
      "类型: 奖励 | 时间: 2026-09-10 10:00:00 ID: 950 | 操作人: admin | 金额: 792 | 余额变动: 4 → 796 | 资金用途: 活动奖励",
    querySelector: () => ({ textContent: "admin" }),
  };
  const profileDocument = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelectorAll: (selector) =>
      selector === ".PostsUserPage-discussion"
        ? [
            {
              querySelector: () => ({
                getAttribute: () => "/bbs/d/552-demo/1",
                textContent: "Demo topic",
              }),
              nextElementSibling: {
                classList: { contains: (name) => name === "Post--by-start-user" },
                querySelector: (selector) =>
                  selector === "time[datetime]"
                    ? { getAttribute: () => "2026-09-10T01:00:00Z" }
                    : { textContent: "发布 #1" },
              },
            },
          ]
        : [],
  };
  const moneyDocument = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelectorAll: (selector) =>
      selector === ".transferHistoryContainer" ? [moneyContainer] : [],
  };
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (path) => {
    if (path === "/bbs/u/cjamrklll") {
      return { ok: true, text: async () => "<html>profile</html>" };
    }
    assert.equal(path, "/bbs/u/cjamrklll/money/history");
    return {
      ok: true,
      text: async () => "<html>money history</html>",
    };
  };
  global.DOMParser = class {
    parseFromString(html) {
      return html.includes("money history") ? moneyDocument : profileDocument;
    }
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.activity.length, 1);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
    global.DOMParser = originalDomParser;
  }
});

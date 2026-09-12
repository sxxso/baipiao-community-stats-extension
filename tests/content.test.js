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
  parseFlarumMoneyHistoryDocument,
  parseFlarumPostsDocument,
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

const postsApiDocument = {
  data: [
    {
      type: "posts",
      id: "5521",
      attributes: { number: 1, createdAt: "2026-09-10T12:00:00+00:00", contentType: "comment" },
      relationships: {
        discussion: { data: { type: "discussions", id: "552" } },
        user: { data: { type: "users", id: "191" } },
      },
    },
    {
      type: "posts",
      id: "5509",
      attributes: { number: 4, createdAt: "2026-09-09T09:00:00+00:00", contentType: "comment" },
      relationships: {
        discussion: { data: { type: "discussions", id: "551" } },
        user: { data: { type: "users", id: "191" } },
      },
    },
  ],
  included: [
    { type: "discussions", id: "552", attributes: { title: "Demo topic", slug: "552-demo-topic" } },
    { type: "discussions", id: "551", attributes: { title: "Other topic", slug: "551-other-topic" } },
  ],
};

const moneyApiDocument = {
  data: [
    {
      type: "userMoneyHistory",
      id: "1234",
      attributes: {
        id: 1234,
        type: "D",
        money: 10,
        user_id: 191,
        source_desc: "打赏给 segmi 的帖子",
        balance_money: 13,
        last_money: 3,
        change_time: "2026-09-12 07:40:24",
      },
      relationships: {
        user: { data: { type: "users", id: "191" } },
        createUser: { data: { type: "users", id: "1" } },
      },
    },
    {
      type: "userMoneyHistory",
      id: "1235",
      attributes: {
        id: 1235,
        type: "C",
        money: 50,
        user_id: 191,
        source_desc: "活动奖励",
        balance_money: 3,
        last_money: 53,
        change_time: "2026-09-12 08:40:24",
      },
      relationships: {
        user: { data: { type: "users", id: "191" } },
        createUser: { data: { type: "users", id: "1" } },
      },
    },
  ],
  included: [
    { type: "users", id: "1", attributes: { username: "admin", displayName: "admin" } },
  ],
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

test("collects the signed-in user's activities through the Flarum posts API on any community page", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const requestedPaths = [];
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (path) => {
    requestedPaths.push(path);
    const url = new URL(path, "https://baipiao.org");
    if (url.pathname === "/bbs/api/posts") {
      assert.equal(url.searchParams.get("filter[author]"), "cjamrklll");
      assert.equal(url.searchParams.get("filter[type]"), "comment");
      assert.equal(url.searchParams.get("sort"), "-createdAt");
      return { ok: true, json: async () => postsApiDocument };
    }
    assert.equal(url.pathname, "/bbs/api/users/191/money/history");
    assert.equal(url.searchParams.get("filter[user]"), "191");
    return { ok: true, json: async () => moneyApiDocument };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.activity.length, 2);
    assert.equal(result.data.activity[0].type, "topic");
    assert.equal(result.data.activity[0].title, "Demo topic");
    assert.equal(result.data.activity[0].url, "https://baipiao.org/bbs/d/552-demo-topic");
    assert.equal(result.data.activity[1].type, "reply");
    assert.equal(result.data.activity[1].title, "Other topic");
    assert.equal(result.data.activity[1].url, "https://baipiao.org/bbs/d/551-other-topic/4");
    assert.equal(result.data.moneyHistory.length, 2);
    assert.equal(result.data.moneyHistory[0].balanceBefore, 13);
    assert.equal(result.data.moneyHistory[0].balanceAfter, 3);
    assert.deepEqual(
      requestedPaths.map((path) => new URL(path, "https://baipiao.org").pathname).sort(),
      ["/bbs/api/posts", "/bbs/api/users/191/money/history"],
    );
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("falls back to the rendered profile page when the posts API is unavailable", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const profileActivityGroup = {
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
  const pageHeaderUserLink = {
    getAttribute: () => "/bbs/u/cjamrklll",
  };
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({
        resources: [
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
      }),
    }),
    querySelector: (selector) =>
      selector === "header a[href*='/bbs/u/']" ? pageHeaderUserLink : null,
    querySelectorAll: (selector) =>
      selector === ".PostsUserPage-discussion" ? [profileActivityGroup] : [],
  };
  global.location = { pathname: "/bbs/u/cjamrklll" };
  global.fetch = async () => {
    throw new Error("posts api unavailable");
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.activity.length, 1);
    assert.equal(result.data.activity[0].title, "Demo topic");
    assert.equal(result.data.activity[0].url, "https://baipiao.org/bbs/d/552-demo/1");
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("does not attribute another member's profile posts to the signed-in user", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const profileActivityGroup = {
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
      selector === ".PostsUserPage-discussion" ? [profileActivityGroup] : [],
  };
  global.location = { pathname: "/bbs/u/someone-else" };
  global.fetch = async () => {
    throw new Error("posts api unavailable");
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.activity.length, 0);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("parses Flarum post documents into topic and reply activities", () => {
  const records = parseFlarumPostsDocument(postsApiDocument);

  assert.deepEqual(records, [
    {
      id: "5521",
      type: "topic",
      title: "Demo topic",
      url: "/bbs/d/552-demo-topic",
      timestamp: "2026-09-10T12:00:00+00:00",
      category: null,
    },
    {
      id: "5509",
      type: "reply",
      title: "Other topic",
      url: "/bbs/d/551-other-topic/4",
      timestamp: "2026-09-09T09:00:00+00:00",
      category: null,
    },
  ]);
});

test("ignores non-comment posts and posts without a usable discussion link", () => {
  const records = parseFlarumPostsDocument({
    data: [
      {
        type: "posts",
        id: "1",
        attributes: { number: 2, contentType: "discussionOpened" },
        relationships: { discussion: { data: { type: "discussions", id: "9" } } },
      },
      {
        type: "posts",
        id: "2",
        attributes: { number: 3, contentType: "comment" },
        relationships: { discussion: { data: { type: "discussions", id: "missing" } } },
      },
    ],
    included: [],
  });

  assert.equal(records.length, 0);
});

test("parses Flarum money history documents into normalized records", () => {
  const records = parseFlarumMoneyHistoryDocument(moneyApiDocument);

  assert.deepEqual(records, [
    {
      id: 1234,
      type: "支出",
      timestamp: "2026-09-12 07:40:24",
      operator: "admin",
      amount: 10,
      balanceBefore: 13,
      balanceAfter: 3,
      purpose: "打赏给 segmi 的帖子",
    },
    {
      id: 1235,
      type: "收入",
      timestamp: "2026-09-12 08:40:24",
      operator: "admin",
      amount: 50,
      balanceBefore: 3,
      balanceAfter: 53,
      purpose: "活动奖励",
    },
  ]);
});

test("collects finance history through the money history API from any page", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/d/552-demo/1" };
  global.fetch = async (path) => {
    const url = new URL(path, "https://baipiao.org");
    assert.equal(url.pathname, "/bbs/api/users/191/money/history");
    assert.equal(url.searchParams.get("filter[user]"), "191");
    return { ok: true, json: async () => moneyApiDocument };
  };

  try {
    const result = await collectMoneyHistory({ waitMs: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].purpose, "打赏给 segmi 的帖子");
    assert.equal(result.data[0].balanceBefore, 13);
    assert.equal(result.data[0].balanceAfter, 3);
    assert.equal(result.data[1].balanceBefore, 3);
    assert.equal(result.data[1].balanceAfter, 53);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

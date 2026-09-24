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
  parseFlarumCheckinDocument,
  parseFlarumPayload,
  parseFlarumMoneyHistoryDocument,
  parseFlarumMoneyRankDocument,
  parseFlarumPostsDocument,
  parseFlarumQuestsDocument,
  parseFlarumUserDocument,
  performCheckin,
  readCsrfToken,
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

const userApiDocument = {
  data: {
    type: "users",
    id: "191",
    attributes: {
      username: "cjamrklll",
      displayName: "cjamrklll",
      money: 88,
    },
  },
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

const leaderboardApiDocument = {
  data: {
    top: [
      {
        id: 1,
        username: "admin",
        money: 2833,
        rank: 1,
        avatarUrl: "https://baipiao.org/bbs/assets/avatars/1.png",
        isMe: false,
      },
      { id: 191, username: "cjamrklll", money: 88, rank: 2, isMe: true },
      { id: 158, username: "xiaoyi", money: 50, rank: 3, isMe: false },
    ],
    me: { rank: 2, money: 88, inTop: true },
    total: 503,
  },
};

const checkinApiDocument = {
  month: "2026-09",
  month_days: 12,
  month_earned: 26,
  today_checked: false,
  today_reward: 3,
  can_checkin: true,
  blocked_reason: "",
  tier: { from: 16, to: null, amount: 3 },
  next_tier: null,
  max_daily: 3,
};

const checkinNestedDocument = {
  data: {
    today_checked: true,
    today_reward: 2,
    month_days: 5,
    month_earned: 9,
    can_checkin: false,
  },
};

const questsApiDocument = {
  data: [
    {
      type: "quest-infos",
      id: "1",
      attributes: {
        id: 1,
        name: "每日活跃",
        description: "今天发布主题或回帖，额外领 10 毛，每天一次。",
        conditions:
          '[{"name":"post_count","operator":">=","value":1,"span":1,"alter_name":"今天发布主题或回帖 1 次"}]',
        rewards: '[{"name":"money","value":10,"alter_name":"+10 毛"}]',
        done: false,
        re_available: "day:1",
        icon: "fas fa-calendar-check",
        hidden: 0,
        manual: false,
      },
    },
    {
      type: "quest-infos",
      id: "2",
      attributes: {
        id: 2,
        name: "首次发言见面礼",
        description: "第一次发布主题或回帖，领 50 毛见面礼，仅一次。",
        conditions:
          '[{"name":"post_count","operator":">=","value":1,"alter_name":"累计发布主题或回帖 1 次"}]',
        rewards: '[{"name":"money","value":50,"alter_name":"+50 毛"}]',
        done: true,
        re_available: null,
        hidden: 0,
        manual: false,
      },
    },
    {
      type: "quest-infos",
      id: "3",
      attributes: { id: 3, name: "隐藏任务", done: false, hidden: 1 },
    },
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

test("parses the numeric user API resource and its authoritative balance", () => {
  const result = parseFlarumUserDocument(userApiDocument, 191);

  assert.equal(result.user.username, "cjamrklll");
  assert.equal(result.summary.money, 88);
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
    if (url.pathname === "/bbs/api/users/191") {
      return { ok: true, json: async () => userApiDocument };
    }
    if (url.pathname === "/bbs/api/money-rank") {
      return { ok: true, json: async () => leaderboardApiDocument };
    }
    if (url.pathname === "/bbs/api/bp/checkin") {
      return { ok: true, json: async () => checkinApiDocument };
    }
    if (url.pathname === "/bbs/api/quest-infos") {
      assert.equal(url.searchParams.get("page[limit]"), "20");
      return { ok: true, json: async () => questsApiDocument };
    }
    assert.equal(url.pathname, "/bbs/api/users/191/money/history");
    assert.equal(url.searchParams.get("filter[user]"), "191");
    return { ok: true, json: async () => moneyApiDocument };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "cjamrklll");
    assert.equal(result.data.stats.money, 88);
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
    assert.equal(result.data.leaderboard.total, 503);
    assert.equal(result.data.leaderboard.top.length, 3);
    assert.equal(result.data.leaderboard.top[0].username, "admin");
    assert.equal(result.data.leaderboard.top[0].url, "https://baipiao.org/bbs/u/admin");
    assert.equal(result.data.leaderboard.me.rank, 2);
    assert.equal(result.data.checkin.checked, false);
    assert.equal(result.data.checkin.todayReward, 3);
    assert.equal(result.data.checkin.monthDays, 12);
    assert.equal(result.data.checkin.url, "https://baipiao.org/bbs/checkin");
    assert.deepEqual(result.data.checkin.tier, { from: 16, to: null, amount: 3 });
    assert.equal(result.data.quests.length, 2);
    assert.equal(result.data.quests[0].name, "每日活跃");
    assert.equal(result.data.quests[0].reward, "+10 毛");
    assert.equal(result.data.quests[0].condition, "今天发布主题或回帖 1 次");
    assert.equal(result.data.quests[0].done, false);
    assert.equal(result.data.quests[0].daily, true);
    assert.equal(result.data.quests[1].name, "首次发言见面礼");
    assert.equal(result.data.quests[1].done, true);
    assert.equal(result.data.quests[1].daily, false);
    assert.deepEqual(
      requestedPaths.map((path) => new URL(path, "https://baipiao.org").pathname).sort(),
      [
        "/bbs/api/bp/checkin",
        "/bbs/api/money-rank",
        "/bbs/api/posts",
        "/bbs/api/quest-infos",
        "/bbs/api/users/191",
        "/bbs/api/users/191/money/history",
      ],
    );
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("keeps the bootstrap balance when the current-user API is unavailable", async () => {
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
    const url = new URL(path, "https://baipiao.org");
    requestedPaths.push(url.pathname);
    if (url.pathname === "/bbs/api/users/191") {
      return {
        ok: true,
        json: async () => ({ data: { type: "users", id: "999", attributes: { money: 999 } } }),
      };
    }
    if (url.pathname === "/bbs/api/posts") return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.stats.money, 13);
    assert.ok(requestedPaths.includes("/bbs/api/users/191"));
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

test("prefers fresh finance API data over already-rendered history rows", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const renderedRecord = {
    textContent:
      "类型: 奖励 | 时间: 2026-09-12 09:00:00 ID: 999 | 操作人: admin | 金额: 1 | 余额变动: 13 → 14 | 资金用途: 旧页面记录",
    querySelector: () => ({ textContent: "admin" }),
  };
  const requestedPaths = [];
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === ".transferHistoryContainer" ? [renderedRecord] : [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (path) => {
    const url = new URL(path, "https://baipiao.org");
    requestedPaths.push(url.pathname);
    if (url.pathname === "/bbs/api/posts") return { ok: true, json: async () => ({ data: [] }) };
    if (url.pathname === "/bbs/api/users/191") {
      return { ok: true, json: async () => userApiDocument };
    }
    return { ok: true, json: async () => moneyApiDocument };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.moneyHistory[0].id, 1234);
    assert.notEqual(result.data.moneyHistory[0].id, 999);
    assert.deepEqual(requestedPaths.sort(), [
      "/bbs/api/bp/checkin",
      "/bbs/api/money-rank",
      "/bbs/api/posts",
      "/bbs/api/quest-infos",
      "/bbs/api/users/191",
      "/bbs/api/users/191/money/history",
    ]);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
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

test("parses the money leaderboard document into ranked rows", () => {
  const result = parseFlarumMoneyRankDocument(leaderboardApiDocument);

  assert.equal(result.total, 503);
  assert.deepEqual(result.top, [
    {
      rank: 1,
      username: "admin",
      money: 2833,
      url: "/bbs/u/admin",
      isMe: false,
    },
    {
      rank: 2,
      username: "cjamrklll",
      money: 88,
      url: "/bbs/u/cjamrklll",
      isMe: true,
    },
    {
      rank: 3,
      username: "xiaoyi",
      money: 50,
      url: "/bbs/u/xiaoyi",
      isMe: false,
    },
  ]);
  assert.deepEqual(result.me, { rank: 2, money: 88, inTop: true });
});

test("returns null for a malformed leaderboard document", () => {
  assert.equal(parseFlarumMoneyRankDocument({ data: [] }), null);
  assert.equal(parseFlarumMoneyRankDocument({ data: { top: "nope" } }), null);
  assert.equal(parseFlarumMoneyRankDocument(null), null);
});

test("parses the check-in status document with snake_case keys", () => {
  const result = parseFlarumCheckinDocument(checkinApiDocument);

  assert.equal(result.checked, false);
  assert.equal(result.todayReward, 3);
  assert.equal(result.canCheckin, true);
  assert.equal(result.month, "2026-09");
  assert.equal(result.monthDays, 12);
  assert.equal(result.monthEarned, 26);
  assert.equal(result.maxDaily, 3);
  assert.deepEqual(result.tier, { from: 16, to: null, amount: 3 });
  assert.equal(result.nextTier, null);
  assert.equal(result.url, "/bbs/checkin");
});

test("reads a check-in status wrapped in a data envelope and camelCase keys", () => {
  const result = parseFlarumCheckinDocument({
    data: {
      todayChecked: true,
      todayReward: 2,
      monthDays: 5,
      monthEarned: 9,
      canCheckin: false,
      nextTier: { from: 6, to: 15, amount: 5, days_until: 4 },
    },
  });

  assert.equal(result.checked, true);
  assert.equal(result.todayReward, 2);
  assert.equal(result.monthDays, 5);
  assert.equal(result.canCheckin, false);
  assert.deepEqual(result.nextTier, { from: 6, to: 15, amount: 5, daysUntil: 4 });
});

test("returns null for a check-in document the extension cannot use", () => {
  assert.equal(parseFlarumCheckinDocument(null), null);
  assert.equal(parseFlarumCheckinDocument({}), null);
  assert.equal(
    parseFlarumCheckinDocument({ error_description: "登录后就能签到拿毛" }),
    null,
  );
});

test("parses daily quests and drops hidden or malformed entries", () => {
  const result = parseFlarumQuestsDocument(questsApiDocument);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    id: 1,
    name: "每日活跃",
    description: "今天发布主题或回帖，额外领 10 毛，每天一次。",
    condition: "今天发布主题或回帖 1 次",
    reward: "+10 毛",
    done: false,
    daily: true,
    manual: false,
  });
  assert.equal(result[1].name, "首次发言见面礼");
  assert.equal(result[1].daily, false);
  assert.equal(result[1].done, true);
});

test("orders unfinished quests first and caps the quest list", () => {
  const rows = [];
  for (let id = 1; id <= 25; id += 1) {
    rows.push({
      type: "quest-infos",
      id: String(id),
      attributes: { id, name: `任务 ${id}`, done: id % 2 === 0 },
    });
  }
  const result = parseFlarumQuestsDocument({ data: rows });

  assert.equal(result.length, 20);
  assert.equal(result[0].id, 1);
  assert.equal(result[1].id, 3);
});

test("returns null for an unusable quest document", () => {
  assert.equal(parseFlarumQuestsDocument(null), null);
  assert.equal(parseFlarumQuestsDocument({}), null);
  assert.equal(parseFlarumQuestsDocument({ data: { records: [] } }), null);
  assert.deepEqual(parseFlarumQuestsDocument({ data: [] }), []);
});

test("keeps other personal data when the check-in API refuses the request", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (path) => {
    const url = new URL(path, "https://baipiao.org");
    if (url.pathname === "/bbs/api/bp/checkin") {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    if (url.pathname === "/bbs/api/quest-infos") {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (url.pathname === "/bbs/api/posts") return { ok: true, json: async () => ({ data: [] }) };
    if (url.pathname === "/bbs/api/users/191") {
      return { ok: true, json: async () => userApiDocument };
    }
    if (url.pathname === "/bbs/api/money-rank") {
      return { ok: true, json: async () => leaderboardApiDocument };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.stats.money, 88);
    assert.equal(result.data.leaderboard.total, 503);
    assert.equal(result.data.checkin, null);
    assert.equal(result.data.quests.length, 0);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("keeps personal stats when the leaderboard API is unavailable", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({ textContent: JSON.stringify(flarumPayload) }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (path) => {
    const url = new URL(path, "https://baipiao.org");
    if (url.pathname === "/bbs/api/money-rank") {
      throw new Error("leaderboard unavailable");
    }
    if (url.pathname === "/bbs/api/posts") return { ok: true, json: async () => ({ data: [] }) };
    if (url.pathname === "/bbs/api/users/191") {
      return { ok: true, json: async () => userApiDocument };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.stats.money, 88);
    assert.equal(result.data.leaderboard, null);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("reads the CSRF token from the Flarum session payload", () => {
  const originalDocument = global.document;
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({
        resources: [],
        session: { userId: 191, csrfToken: "demo-token" },
      }),
    }),
  };

  try {
    assert.equal(readCsrfToken(), "demo-token");
  } finally {
    global.document = originalDocument;
  }
  assert.equal(readCsrfToken({ getElementById: () => null }), "");
  assert.equal(readCsrfToken(null), "");
});

test("submits the check-in as a POST with the session token", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const calls = [];
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({
        resources: [],
        session: { userId: 191, csrfToken: "demo-token" },
      }),
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async (input, init) => {
    calls.push({ path: input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        granted: 3,
        already: false,
        today_checked: true,
        today_reward: 3,
        month_days: 13,
        month_earned: 29,
        can_checkin: false,
      }),
    };
  };

  try {
    const result = await performCheckin();
    assert.equal(result.ok, true);
    assert.equal(result.granted, 3);
    assert.equal(result.already, false);
    assert.equal(result.message, "签到成功，+3 毛");
    assert.equal(result.status.checked, true);
    assert.equal(result.status.monthDays, 13);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/bbs/api/bp/checkin");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(calls[0].init.headers["X-CSRF-Token"], "demo-token");
    assert.equal(calls[0].init.headers["X-Requested-With"], "XMLHttpRequest");
    assert.equal(calls[0].init.body, "{}");
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("reports an already-completed check-in without pretending success", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({ resources: [], session: { userId: 191, csrfToken: "t" } }),
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      granted: 0,
      already: true,
      today_checked: true,
      today_reward: 0,
      month_days: 4,
      month_earned: 8,
      can_checkin: false,
    }),
  });

  try {
    const result = await performCheckin();
    assert.equal(result.ok, true);
    assert.equal(result.already, true);
    assert.equal(result.granted, null);
    assert.equal(result.message, "今天已经签过了，明天再来");
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("fails the check-in when the site refuses the POST", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({ resources: [], session: { userId: 191, csrfToken: "t" } }),
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error_description: "登录后就能签到拿毛" }),
  });

  try {
    const result = await performCheckin();
    assert.equal(result.ok, false);
    assert.equal(result.code, "checkin_failed");
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("refuses an unusable check-in response", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  global.document = {
    getElementById: () => ({
      textContent: JSON.stringify({ resources: [], session: { userId: 191, csrfToken: "t" } }),
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.location = { pathname: "/bbs/" };
  global.fetch = async () => ({ ok: true, json: async () => ({ granted: 1, already: false }) });

  try {
    const result = await performCheckin();
    assert.equal(result.ok, true);
    assert.equal(result.granted, 1);
    assert.equal(result.status, null);
  } finally {
    global.document = originalDocument;
    global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

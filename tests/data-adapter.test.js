const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeProfile,
  normalizeStats,
  normalizeActivity,
  normalizeMoneyHistory,
  normalizeLeaderboard,
  normalizeCheckin,
  normalizeQuests,
  aggregateSevenDayTrend,
  normalizePayload,
} = require("../lib/data-adapter");

test("normalizes common profile and stat aliases", () => {
  const result = normalizePayload(
    {
      user: {
        username: "demo",
        name: "Demo User",
        avatar_template: "/bbs/user_avatar/baipiao.org/demo/{size}/1.png",
        trust_level: 2,
        created_at: "2026-01-02T03:04:05Z",
      },
      summary: {
        topic_count: 4,
        post_count: 17,
        likes_received: 9,
        likes_given: 3,
      },
      activities: [],
    },
    "api",
  );

  assert.equal(result.profile.username, "demo");
  assert.equal(result.profile.displayName, "Demo User");
  assert.equal(result.stats.topics, 4);
  assert.equal(result.stats.replies, 13);
  assert.equal(result.stats.likesReceived, 9);
  assert.equal(result.stats.likesGiven, 3);
});

test("uses null for unavailable fields and removes duplicate activity records", () => {
  const result = normalizePayload(
    {
      user: { username: "demo" },
      activities: [
        {
          id: "a1",
          type: "reply",
          title: "Hello",
          url: "/bbs/t/1",
          timestamp: "2026-09-10T01:00:00Z",
        },
        {
          id: "a1",
          type: "reply",
          title: "Hello",
          url: "/bbs/t/1",
          timestamp: "2026-09-10T01:00:00Z",
        },
      ],
    },
    "dom",
  );

  assert.equal(result.stats.topics, null);
  assert.equal(result.stats.replies, null);
  assert.equal(result.activity.length, 1);
  assert.equal(result.source, "dom");
});

test("aggregates activity into seven local date buckets", () => {
  const trend = aggregateSevenDayTrend(
    [
      { timestamp: "2026-09-10T01:00:00Z" },
      { timestamp: "2026-09-10T04:00:00Z" },
      { timestamp: "2026-09-08T04:00:00Z" },
      { timestamp: "2026-08-01T04:00:00Z" },
    ],
    new Date("2026-09-10T12:00:00Z"),
  );

  assert.equal(trend.length, 7);
  assert.equal(trend.at(-1).date, "2026-09-10");
  assert.equal(trend.at(-1).count, 2);
  assert.equal(
    trend.find((entry) => entry.date === "2026-09-08").count,
    1,
  );
  assert.equal(
    trend.find((entry) => entry.date === "2026-09-09").count,
    0,
  );
});

test("normalizes activities and filters unsafe URLs", () => {
  const activity = normalizeActivity(
    [
      {
        type: "topic_created",
        title: "A topic",
        category_name: "资源分享",
        created_at: "2026-09-10T00:00:00Z",
        url: "/bbs/d/42-a-topic",
      },
      {
        type: "reply",
        title: "Unsafe",
        url: "javascript:alert(1)",
      },
    ],
    "https://baipiao.org",
  );

  assert.equal(activity.length, 1);
  assert.equal(activity[0].type, "topic");
  assert.equal(activity[0].category, "资源分享");
  assert.equal(activity[0].url, "https://baipiao.org/bbs/d/42-a-topic");
});

test("exposes null profile fields instead of invented defaults", () => {
  const profile = normalizeProfile({ username: "demo" });
  const stats = normalizeStats({});

  assert.equal(profile.username, "demo");
  assert.equal(profile.joinedAt, null);
  assert.equal(profile.profileUrl, "https://baipiao.org/bbs/u/demo");
  assert.equal(stats.views, null);
});

test("supports Baipiao Connect-style profile aliases", () => {
  const result = normalizePayload({
    preferred_username: "connect-demo",
    name: "Connect Demo",
    picture: "/bbs/assets/avatars/connect-demo.png",
    profile: "/bbs/u/connect-demo",
    trust_level: 2,
    created_at: "2026-06-20T08:12:30Z",
    post_count: 18,
    discussion_count: 3,
  });

  assert.equal(result.profile.username, "connect-demo");
  assert.equal(result.profile.avatarUrl, "https://baipiao.org/bbs/assets/avatars/connect-demo.png");
  assert.equal(result.profile.profileUrl, "https://baipiao.org/bbs/u/connect-demo");
  assert.equal(result.stats.topics, 3);
  assert.equal(result.stats.replies, 15);
});

test("normalizes the Flarum user resource fields used by the community page", () => {
  const result = normalizePayload({
    user: {
      username: "cjamrklll",
      displayName: "cjamrklll",
      avatarUrl: "https://baipiao.org/bbs/assets/avatars/demo.png",
      joinTime: "2026-08-01T07:00:30+00:00",
      discussionCount: 22,
      commentCount: 116,
      titleBadge: { name: "幕后最终Boss" },
    },
  });

  assert.equal(result.profile.joinedAt, "2026-08-01T07:00:30+00:00");
  assert.equal(result.profile.title, "幕后最终Boss");
  assert.equal(result.stats.topics, 22);
  assert.equal(result.stats.replies, 116);
});

test("normalizes balance, community level, and finance history fields", () => {
  const result = normalizePayload({
    user: { username: "demo", money: 13 },
    summary: {
      bpMyLevel: -1,
      levelLabel: "白嫖预备",
    },
    moneyHistory: [
      {
        type: "扣费",
        timestamp: "2026-09-10 10:15:10",
        id: 961,
        operator: "demo",
        amount: 30,
        balanceBefore: 30,
        balanceAfter: 0,
        purpose: "称号熔炼",
      },
    ],
  });

  assert.equal(result.stats.money, 13);
  assert.equal(result.stats.communityLevel, -1);
  assert.equal(result.stats.levelLabel, "白嫖预备");
  assert.equal(result.moneyHistory.length, 1);
  assert.equal(result.moneyHistory[0].purpose, "称号熔炼");
  assert.equal(normalizeMoneyHistory(null).length, 0);
});

test("normalizes the leaderboard and caps the visible rows", () => {
  const board = normalizeLeaderboard({
    top: [
      { rank: 2, username: "b", money: 50, url: "/bbs/u/b", isMe: true },
      { rank: 1, username: "a", money: 100, url: "https://evil.example/x" },
      { rank: 3, username: "c", money: 40, url: "/bbs/u/c" },
      { rank: 4, username: "", money: 1, url: "/bbs/u/" },
    ],
    me: { rank: 2, money: 50, inTop: true },
    total: 503,
  });

  assert.equal(board.top.length, 3);
  assert.deepEqual(
    board.top.map((entry) => entry.username),
    ["a", "b", "c"],
  );
  assert.equal(board.top[0].url, "https://baipiao.org/bbs/u/a");
  assert.equal(board.me.rank, 2);
  assert.equal(board.total, 503);
});

test("drops an empty leaderboard and keeps a my-rank-only board", () => {
  assert.equal(normalizeLeaderboard(null), null);
  assert.equal(normalizeLeaderboard({ top: [], me: null, total: 0 }), null);
  const meOnly = normalizeLeaderboard({ top: [], me: { rank: 88, money: 5, inTop: false } });
  assert.equal(meOnly.top.length, 0);
  assert.equal(meOnly.me.rank, 88);
});

test("normalizePayload carries the leaderboard section", () => {
  const result = normalizePayload({
    user: { username: "demo", money: 5 },
    leaderboard: { top: [{ rank: 1, username: "demo", money: 5, url: "/bbs/u/demo", isMe: true }], me: null, total: 1 },
  });

  assert.equal(result.leaderboard.top.length, 1);
  assert.equal(result.leaderboard.top[0].username, "demo");
});

test("normalizes the check-in status and its reward tiers", () => {
  const checkin = normalizeCheckin({
    month: "2026-09",
    checked: false,
    canCheckin: true,
    monthDays: 12,
    monthEarned: 26,
    todayReward: 3,
    maxDaily: 3,
    blockedReason: "  ",
    tier: { from: 16, to: null, amount: 3 },
    nextTier: { from: 6, to: 15, amount: 2, daysUntil: 4 },
  });

  assert.equal(checkin.checked, false);
  assert.equal(checkin.canCheckin, true);
  assert.equal(checkin.todayReward, 3);
  assert.equal(checkin.monthDays, 12);
  assert.equal(checkin.blockedReason, null);
  assert.deepEqual(checkin.tier, { from: 16, to: null, amount: 3 });
  assert.deepEqual(checkin.nextTier, { from: 6, to: 15, amount: 2, daysUntil: 4 });
  assert.equal(checkin.url, "https://baipiao.org/bbs/checkin");
});

test("keeps a blocked check-in state usable and drops an empty one", () => {
  const blocked = normalizeCheckin({ canCheckin: false, blockedReason: "账号异常" });
  assert.equal(blocked.canCheckin, false);
  assert.equal(blocked.blockedReason, "账号异常");

  assert.equal(normalizeCheckin(null), null);
  assert.equal(normalizeCheckin({}), null);
  assert.equal(normalizeCheckin({ tier: null, blockedReason: null }), null);
  const zeroed = normalizeCheckin({ monthDays: 0, monthEarned: 0 });
  assert.equal(zeroed.checked, false);
  assert.equal(zeroed.todayReward, null);
});

test("only accepts check-in links inside the community", () => {
  assert.equal(
    normalizeCheckin({ checked: true, url: "https://evil.example/checkin" }).url,
    "https://baipiao.org/bbs/checkin",
  );
});

test("normalizes daily quests, dropping invalid rows and capping the list", () => {
  const quests = [];
  for (let id = 1; id <= 12; id += 1) {
    quests.push({
      id,
      name: `任务 ${id}`,
      description: "描述",
      condition: "条件",
      reward: `+${id} 毛`,
      done: id % 2 === 0,
      daily: id % 3 === 0,
      manual: false,
    });
  }
  quests.push({ id: 99, name: "", done: false });
  quests.push({ id: null, name: "坏数据", done: false });

  const result = normalizeQuests(quests);

  assert.equal(result.length, 10);
  assert.equal(result[0].id, 1);
  assert.equal(result[0].done, false);
  assert.equal(result[1].id, 3);
  assert.equal(result[1].done, false);
  assert.equal(result[2].id, 5);
  assert.equal(result[1].daily, true);
  assert.equal(result[9].done, true);
  assert.deepEqual(normalizeQuests(null), []);
});

test("normalizePayload carries the check-in and quest sections", () => {
  const result = normalizePayload({
    user: { username: "demo", money: 88 },
    checkin: { checked: true, todayReward: 3, monthDays: 5, monthEarned: 9 },
    quests: [{ id: 1, name: "每日活跃", reward: "+10 毛", done: false }],
  });

  assert.equal(result.checkin.checked, true);
  assert.equal(result.checkin.todayReward, 3);
  assert.equal(result.quests.length, 1);
  assert.equal(result.quests[0].name, "每日活跃");
});

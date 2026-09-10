const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeProfile,
  normalizeStats,
  normalizeActivity,
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

const test = require("node:test");
const assert = require("node:assert/strict");
const { isCommunityPath, extractUserFromPath, normalizeDomActivity } = require("../content");
const { collectCommunityStats } = require("../content");
const { completeProfile } = require("./fixtures/profile-responses");

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

test("combines session, profile, and activity responses into one safe snapshot", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (path) => {
    if (path === "/bbs/session/current.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ current_user: completeProfile.user }),
      };
    }
    if (path === "/bbs/u/demo.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: completeProfile.user,
          summary: completeProfile.summary,
        }),
      };
    }
    if (path === "/bbs/u/demo/activity.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ activities: completeProfile.activities }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await collectCommunityStats();
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.username, "demo");
    assert.equal(result.data.stats.topics, 4);
    assert.equal(result.data.stats.replies, 13);
    assert.equal(result.data.activity.length, 2);
    assert.equal(result.data.source, "api");
  } finally {
    global.fetch = originalFetch;
  }
});

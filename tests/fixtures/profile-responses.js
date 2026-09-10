const completeProfile = {
  user: {
    id: 42,
    username: "demo",
    name: "Demo User",
    avatar_template: "/bbs/user_avatar/baipiao.org/demo/{size}/1.png",
    trust_level: 2,
    created_at: "2026-01-02T03:04:05Z",
    last_seen_at: "2026-09-10T08:00:00Z",
  },
  summary: {
    topic_count: 4,
    post_count: 17,
    likes_received: 9,
    likes_given: 3,
    days_visited: 28,
    posts_read_count: 64,
  },
  activities: [
    {
      id: "topic-1",
      type: "topic_created",
      title: "分享一个免费 API",
      category_name: "资源分享",
      created_at: "2026-09-10T07:30:00Z",
      url: "/bbs/d/100-share-api",
    },
    {
      id: "reply-1",
      type: "reply",
      title: "Re: 站点体验讨论",
      category_name: "中转讨论",
      created_at: "2026-09-09T07:30:00Z",
      url: "/bbs/d/101-relay-review",
    },
  ],
};

const activityResponse = {
  activities: completeProfile.activities,
};

const loggedOutResponse = {
  error: "not_logged_in",
};

const partialDomPayload = {
  user: {
    username: "demo",
  },
  activities: [
    {
      type: "reply",
      title: "社区讨论",
      timestamp: "2026-09-10T06:00:00Z",
      url: "/bbs/d/102-community",
    },
  ],
};

module.exports = {
  completeProfile,
  activityResponse,
  loggedOutResponse,
  partialDomPayload,
};

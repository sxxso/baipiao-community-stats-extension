(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BaipiaoData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ORIGIN = "https://baipiao.org";
  const BBS_PREFIX = "/bbs/";
  const PROFILE_KEYS = [
    "username",
    "preferred_username",
    "displayName",
    "title",
    "display_name",
    "name",
    "avatarUrl",
    "avatar_url",
    "avatar_template",
    "picture",
    "trustLevel",
    "trust_level",
    "trustLabel",
    "trust_label",
    "createdAt",
    "created_at",
    "joinTime",
    "join_time",
    "joinedAt",
    "joined_at",
    "lastSeenAt",
    "last_seen_at",
    "profileUrl",
    "profile_url",
    "profile",
    "url",
  ];
  const STAT_KEYS = [
    "topics",
    "topic_count",
    "topicCount",
    "topics_count",
    "discussion_count",
    "discussionCount",
    "replies",
    "reply_count",
    "replyCount",
    "replies_count",
    "post_count",
    "postCount",
    "likesReceived",
    "likes_received",
    "likes_received_count",
    "received_likes",
    "likesGiven",
    "likes_given",
    "likes_given_count",
    "given_likes",
    "daysVisited",
    "days_visited",
    "days_visited_count",
    "views",
    "view_count",
    "views_count",
    "profile_views",
    "posts_read_count",
    "money",
    "balance",
    "communityLevel",
    "bpMyLevel",
    "levelLabel",
  ];

  function isObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function objectOrEmpty(value) {
    return isObject(value) ? value : {};
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function nullableNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function nullableNonNegativeNumber(value) {
    const number = nullableNumber(value);
    return number !== null && number >= 0 ? number : null;
  }

  function dateValue(value) {
    const valueText = text(value);
    return valueText || null;
  }

  function sanitizeUrl(value, base = ORIGIN) {
    const raw = text(value);
    if (!raw) return null;

    let url;
    try {
      url = new URL(raw, base);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" || url.hostname !== "baipiao.org") return null;
    if (!url.pathname.startsWith(BBS_PREFIX)) return null;
    url.hash = "";
    return url.toString();
  }

  function normalizeAvatar(value) {
    const template = text(value);
    if (!template) return null;
    return sanitizeUrl(template.replace(/\{size\}/g, "128"));
  }

  function normalizeProfile(input, base = ORIGIN) {
    const profile = objectOrEmpty(input);
    const username = text(
      firstValue(
        profile.username,
        profile.preferred_username,
        profile.user_name,
        profile.handle,
        profile.login,
      ),
    ) || null;
    const profileUrl = sanitizeUrl(
      firstValue(profile.profileUrl, profile.profile_url, profile.url, profile.profile) ||
        (username ? `${BBS_PREFIX}u/${encodeURIComponent(username)}` : ""),
      base,
    );

    return {
      username,
      displayName:
        text(
          firstValue(
            profile.preferred_name,
            profile.displayName,
            profile.display_name,
            profile.name,
            profile.full_name,
          ),
        ) || null,
      title:
        text(
          firstValue(
            profile.title,
            profile.title_name,
            objectOrEmpty(profile.titleBadge).name,
            objectOrEmpty(profile.title_badge).name,
          ),
        ) || null,
      avatarUrl: normalizeAvatar(
        firstValue(
          profile.avatarUrl,
          profile.avatar_url,
          profile.avatar_template,
          profile.avatar,
          profile.picture,
        ),
      ),
      trustLevel: nullableNonNegativeNumber(
        firstValue(profile.trustLevel, profile.trust_level, profile.trust_level_id),
      ),
      trustLabel:
        text(
          firstValue(
            profile.trustLabel,
            profile.trust_label,
            profile.trust_level_name,
            profile.trustLevelName,
          ),
        ) || null,
      joinedAt: dateValue(
        firstValue(
          profile.joinedAt,
          profile.joined_at,
          profile.joinTime,
          profile.join_time,
          profile.createdAt,
          profile.created_at,
        ),
      ),
      lastSeenAt: dateValue(
        firstValue(
          profile.lastSeenAt,
          profile.last_seen_at,
          profile.lastActiveAt,
          profile.last_active_at,
          profile.updated_at,
        ),
      ),
      profileUrl,
    };
  }

  function normalizeStats(input) {
    const stats = objectOrEmpty(input);
    const topics = nullableNonNegativeNumber(
      firstValue(
        stats.topics,
        stats.topic_count,
        stats.topicCount,
        stats.topics_count,
        stats.discussion_count,
        stats.discussionCount,
        stats.number_of_topics,
      ),
    );
    const postCount = nullableNonNegativeNumber(firstValue(stats.post_count, stats.postCount));
    const directReplies = nullableNonNegativeNumber(
      firstValue(
        stats.replies,
        stats.reply_count,
        stats.replyCount,
        stats.replies_count,
        stats.comment_count,
        stats.commentCount,
        stats.number_of_replies,
      ),
    );
    const replies =
      directReplies !== null
        ? directReplies
        : topics !== null && postCount !== null && postCount >= topics
          ? postCount - topics
          : null;

    return {
      topics,
      replies,
      likesReceived: nullableNonNegativeNumber(
        firstValue(
          stats.likesReceived,
          stats.likes_received,
          stats.likes_received_count,
          stats.received_likes,
        ),
      ),
      likesGiven: nullableNonNegativeNumber(
        firstValue(stats.likesGiven, stats.likes_given, stats.likes_given_count, stats.given_likes),
      ),
      daysVisited: nullableNonNegativeNumber(
        firstValue(stats.daysVisited, stats.days_visited, stats.days_visited_count),
      ),
      views: nullableNonNegativeNumber(
        firstValue(
          stats.views,
          stats.view_count,
          stats.views_count,
          stats.profile_views,
          stats.posts_read_count,
        ),
      ),
      money: nullableNonNegativeNumber(
        firstValue(stats.money, stats.balance, stats.balance_amount),
      ),
      communityLevel: nullableNumber(firstValue(stats.communityLevel, stats.bpMyLevel)),
      levelLabel: text(firstValue(stats.levelLabel, stats.level_name, stats.levelName)) || null,
    };
  }

  function normalizeMoneyHistory(records) {
    const list = Array.isArray(records) ? records : [];
    const seen = new Set();
    return list
      .map((record) => {
        const item = objectOrEmpty(record);
        const amount = nullableNumber(item.amount);
        const balanceBefore = nullableNumber(item.balanceBefore);
        const balanceAfter = nullableNumber(item.balanceAfter);
        const id = nullableNonNegativeNumber(item.id);
        const type = text(item.type) || null;
        const timestamp = dateValue(item.timestamp);
        const operator = text(item.operator) || null;
        const purpose = text(item.purpose) || null;
        if (
          !type ||
          !timestamp ||
          id === null ||
          amount === null ||
          balanceBefore === null ||
          balanceAfter === null ||
          !purpose
        ) {
          return null;
        }
        return {
          type,
          timestamp,
          id,
          operator,
          amount,
          balanceBefore,
          balanceAfter,
          purpose,
        };
      })
      .filter(Boolean)
      .filter((record) => {
        const key = `id:${record.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }

  function normalizeLeaderboard(input) {
    const source = isObject(input) ? input : {};
    const rows = Array.isArray(source.top) ? source.top : [];
    const seen = new Set();
    const top = [];
    for (const row of rows) {
      const item = objectOrEmpty(row);
      const username = text(item.username);
      const rank = nullableNonNegativeNumber(item.rank);
      const money = nullableNumber(item.money);
      if (!username || rank === null || money === null) continue;
      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      top.push({
        rank,
        username,
        money,
        url:
          sanitizeUrl(item.url) ||
          sanitizeUrl(`${BBS_PREFIX}u/${encodeURIComponent(username)}`),
        isMe: item.isMe === true,
      });
    }
    top.sort((left, right) => left.rank - right.rank);
    const capped = top.slice(0, 10);
    let me = null;
    if (isObject(source.me)) {
      const myRank = nullableNonNegativeNumber(source.me.rank);
      const myMoney = nullableNumber(source.me.money);
      if (myRank !== null && myMoney !== null) {
        me = { rank: myRank, money: myMoney, inTop: source.me.inTop === true };
      }
    }
    const total = nullableNonNegativeNumber(source.total);
    if (!capped.length && !me) return null;
    return { top: capped, me, total };
  }

  function normalizeTier(value) {
    const tier = objectOrEmpty(value);
    const amount = nullableNumber(tier.amount);
    const from = nullableNonNegativeNumber(tier.from);
    const to = tier.to === null || tier.to === undefined ? null : nullableNonNegativeNumber(tier.to);
    if (amount === null && from === null && to === null) return null;
    return { from, to, amount };
  }

  function normalizeNextTier(value) {
    const tier = normalizeTier(value);
    if (!tier) return null;
    return { ...tier, daysUntil: nullableNonNegativeNumber(objectOrEmpty(value).daysUntil) };
  }

  function normalizeCheckin(input) {
    const source = objectOrEmpty(input);
    if (!Object.keys(source).length) return null;
    const month = text(source.month);
    const checked = source.checked === true;
    const canCheckin = source.canCheckin !== false;
    const monthDays = nullableNonNegativeNumber(source.monthDays);
    const monthEarned = nullableNonNegativeNumber(source.monthEarned);
    const todayReward = nullableNonNegativeNumber(source.todayReward);
    const maxDaily = nullableNonNegativeNumber(source.maxDaily);
    if (
      !month &&
      !checked &&
      canCheckin &&
      monthDays === null &&
      monthEarned === null &&
      todayReward === null &&
      maxDaily === null &&
      !source.blockedReason
    ) {
      return null;
    }
    return {
      month: month || null,
      checked,
      canCheckin,
      monthDays,
      monthEarned,
      todayReward,
      maxDaily,
      blockedReason: text(source.blockedReason) || null,
      tier: normalizeTier(source.tier),
      nextTier: normalizeNextTier(source.nextTier),
      url: sanitizeUrl(source.url) || sanitizeUrl(`${BBS_PREFIX}checkin`),
    };
  }

  function normalizeQuests(input) {
    const list = Array.isArray(input) ? input : [];
    const seen = new Set();
    const quests = [];
    for (const entry of list) {
      const item = objectOrEmpty(entry);
      const id = nullableNonNegativeNumber(item.id);
      const name = text(item.name);
      if (id === null || !name) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      quests.push({
        id,
        name,
        description: text(item.description) || null,
        condition: text(item.condition) || null,
        reward: text(item.reward) || null,
        done: item.done === true,
        daily: item.daily === true,
        manual: item.manual === true,
      });
    }
    quests.sort((left, right) => {
      if (left.done !== right.done) return left.done ? 1 : -1;
      return left.id - right.id;
    });
    return quests.slice(0, 10);
  }

  function activityType(record) {
    const value = text(
      firstValue(record.type, record.activity_type, record.action, record.kind),
    ).toLowerCase();
    if (
      value === "topic" ||
      value === "topic_created" ||
      value === "new_topic" ||
      value === "created_topic"
    ) {
      return "topic";
    }
    if (
      value === "reply" ||
      value === "post" ||
      value === "activity" ||
      value === "replied" ||
      record.is_reply === true
    ) {
      return "reply";
    }
    return null;
  }

  function activityUrl(record, base) {
    const topic = objectOrEmpty(record.topic);
    const post = objectOrEmpty(record.post);
    return sanitizeUrl(
      firstValue(
        record.url,
        record.topic_url,
        record.topicUrl,
        record.path,
        record.link,
        topic.url,
        topic.path,
        post.url,
      ),
      base,
    );
  }

  function normalizeActivity(records, base = ORIGIN) {
    const list = Array.isArray(records) ? records : [];
    const seen = new Set();
    const normalized = [];

    for (const record of list) {
      const item = objectOrEmpty(record);
      const type = activityType(item);
      const url = activityUrl(item, base);
      const topic = objectOrEmpty(item.topic);
      const post = objectOrEmpty(item.post);
      const title =
        text(
          firstValue(
            item.title,
            item.topic_title,
            item.topicTitle,
            item.subject,
            item.name,
            topic.title,
            post.topic_title,
          ),
        ) || null;
      if (!type || !url || !title) continue;

      const timestamp =
        dateValue(
          firstValue(
            item.timestamp,
            item.created_at,
            item.createdAt,
            item.updated_at,
            item.date,
            item.action_time,
            item.post_time,
          ),
        ) || null;
      const categoryValue = firstValue(
        item.category,
        item.category_name,
        item.categoryName,
        objectOrEmpty(item.category).name,
        topic.category_name,
        objectOrEmpty(topic.category).name,
      );
      const key = text(item.id)
        ? `id:${text(item.id)}`
        : [type, url, timestamp || "", title].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        type,
        title,
        category: text(categoryValue) || null,
        timestamp,
        url,
      });
    }

    normalized.sort((left, right) => {
      const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
      const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
    return normalized;
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function aggregateSevenDayTrend(activities, now = new Date()) {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    const buckets = [];
    const counts = new Map();

    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(end);
      date.setDate(end.getDate() - offset);
      const key = formatDate(date);
      buckets.push(key);
      counts.set(key, 0);
    }

    for (const activity of Array.isArray(activities) ? activities : []) {
      const timestamp = Date.parse(text(activity && activity.timestamp));
      if (!Number.isFinite(timestamp)) continue;
      const key = formatDate(new Date(timestamp));
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }

    return buckets.map((date) => ({ date, count: counts.get(date) }));
  }

  function arrayFrom(...values) {
    return values.find((value) => Array.isArray(value)) || [];
  }

  function normalizeTrend(value) {
    if (!Array.isArray(value)) return null;
    return value
      .map((entry) => {
        const item = objectOrEmpty(entry);
        const date = text(firstValue(item.date, item.day, item.label));
        const count = nullableNonNegativeNumber(firstValue(item.count, item.value, item.total));
        return date && count !== null ? { date, count } : null;
      })
      .filter(Boolean)
      .slice(-7);
  }

  function normalizePayload(payload, source = "api") {
    const body = objectOrEmpty(payload);
    const data = objectOrEmpty(body.data);
    const user = objectOrEmpty(
      [
        body.user,
        body.current_user,
        body.currentUser,
        data.user,
        data.profile,
        body.profile,
        body,
      ].find(isObject),
    );
    const summary = Object.assign(
      {},
      ...[
        user,
        body.summary,
        body.stats,
        body.user_summary,
        body.userSummary,
        user.summary,
        data.summary,
        data.stats,
      ].filter(isObject),
    );
    const activities = arrayFrom(
      body.activities,
      body.activity,
      body.items,
      body.posts,
      data.activities,
      data.activity,
      data.items,
    );
    const profile = normalizeProfile(user);
    const activity = normalizeActivity(activities);
    const directTrend = normalizeTrend(
      firstValue(body.trend, body.activity_trend, body.activityTrend, data.trend),
    );

    return {
      profile,
      stats: normalizeStats(summary),
      activity: activity.slice(0, 5),
      moneyHistory: normalizeMoneyHistory(body.moneyHistory),
      leaderboard: normalizeLeaderboard(body.leaderboard),
      checkin: normalizeCheckin(body.checkin),
      quests: normalizeQuests(body.quests),
      trend: directTrend && directTrend.length ? directTrend : aggregateSevenDayTrend(activity),
      fetchedAt: new Date().toISOString(),
      source: source === "dom" || source === "mixed" ? source : "api",
    };
  }

  const api = {
    normalizeProfile,
    normalizeStats,
    normalizeActivity,
    aggregateSevenDayTrend,
    normalizeMoneyHistory,
    normalizeLeaderboard,
    normalizeCheckin,
    normalizeQuests,
    normalizePayload,
    sanitizeUrl,
  };

  return api;
});

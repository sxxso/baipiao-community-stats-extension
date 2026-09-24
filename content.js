(function (root, factory) {
  let adapter = root.BaipiaoData;
  if (!adapter && typeof module === "object" && module.exports) {
    adapter = require("./lib/data-adapter");
  }
  const api = factory(root, adapter || {});
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BaipiaoCollector = api;
    api.installMessageListener();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, adapter) {
  "use strict";

  const ORIGIN = "https://baipiao.org";
  const BBS_PREFIX = "/bbs";
  const ENDPOINTS = {
    session: [
      "/bbs/session/current.json",
      "/bbs/session/current",
      "/bbs/api/session/current",
      "/bbs/api/session",
    ],
    user: (username) => {
      const encoded = encodeURIComponent(username);
      return [
        `/bbs/u/${encoded}.json`,
        `/bbs/u/${encoded}/summary.json`,
        `/bbs/api/users/${encoded}`,
        `/bbs/api/user/${encoded}`,
      ];
    },
    activity: (username) => {
      const encoded = encodeURIComponent(username);
      return [
        `/bbs/u/${encoded}/activity.json`,
        `/bbs/u/${encoded}/activity`,
        `/bbs/api/users/${encoded}/activity`,
        `/bbs/api/user/${encoded}/activity`,
      ];
    },
  };
  const POSTS_ENDPOINT = "/bbs/api/posts";
  const POSTS_PAGE_LIMIT = 20;
  const MONEY_RANK_ENDPOINT = "/bbs/api/money-rank";
  const MONEY_RANK_LIMIT = 50;
  const CHECKIN_ENDPOINT = "/bbs/api/bp/checkin";
  const QUESTS_ENDPOINT = "/bbs/api/quest-infos";
  const QUESTS_PAGE_LIMIT = 20;
  const PROFILE_ACTIVITIES_TIMEOUT_MS = 5000;
  const PROFILE_DOM_POLL_WAIT_MS = 3000;
  const PROFILE_DOM_POLL_INTERVAL_MS = 250;

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function isCommunityPath(value) {
    const raw = text(value);
    if (!raw) return false;
    let url;
    try {
      url = new URL(raw, ORIGIN);
    } catch {
      return false;
    }
    return (
      url.protocol === "https:" &&
      url.hostname === "baipiao.org" &&
      (url.pathname === BBS_PREFIX || url.pathname.startsWith(`${BBS_PREFIX}/`))
    );
  }

  function extractUserFromPath(pathname) {
    const match = text(pathname).match(/^\/bbs\/u\/([^/?#]+)/);
    if (!match) return null;
    try {
      const username = decodeURIComponent(match[1]).trim();
      return username || null;
    } catch {
      return null;
    }
  }

  function parseFlarumJson(value) {
    if (!value) return null;
    try {
      const payload = typeof value === "string" ? JSON.parse(value) : value;
      return isObject(payload) ? payload : null;
    } catch {
      return null;
    }
  }

  function resourcesFrom(payload) {
    return Array.isArray(payload && payload.resources) ? payload.resources : [];
  }

  function chooseFlarumUser(payload) {
    const resources = resourcesFrom(payload);
    const sessionUserId = payload && payload.session && payload.session.userId;
    if (sessionUserId === undefined || sessionUserId === null || sessionUserId === "") return null;
    const expectedId = String(sessionUserId);
    return resources.find(
      (resource) =>
        resource &&
        resource.type === "users" &&
        String(resource.id) === expectedId,
    ) || null;
  }

  function chooseFlarumForum(payload) {
    return resourcesFrom(payload).find((resource) => resource && resource.type === "forums") || null;
  }

  function flarumLevelLabel(level, levelNames) {
    const numericLevel = Number(level);
    if (!Number.isFinite(numericLevel)) return null;
    if (numericLevel < 0) return "白嫖预备";
    return text(Array.isArray(levelNames) ? levelNames[numericLevel] : "") || `白嫖等级 ${numericLevel + 1}`;
  }

  function parseFlarumPayload(value) {
    const payload = parseFlarumJson(value);
    const userResource = payload ? chooseFlarumUser(payload) : null;
    const forumResource = payload ? chooseFlarumForum(payload) : null;
    const attrs = isObject(userResource && userResource.attributes)
      ? userResource.attributes
      : {};
    const username = text(firstValue(attrs.username, attrs.slug));
    const user = username
      ? {
          username,
          displayName: firstValue(attrs.displayName, attrs.username),
          avatarUrl: attrs.avatarUrl,
          joinTime: attrs.joinTime,
          lastSeenAt: attrs.lastSeenAt,
          titleBadge: isObject(attrs.titleBadge) ? { name: attrs.titleBadge.name } : null,
          profileUrl: `/bbs/u/${encodeURIComponent(username)}`,
        }
      : null;
    const summary = {
      discussionCount: attrs.discussionCount,
      commentCount: attrs.commentCount,
      money: attrs.money,
      uploads: attrs["fof-upload-uploadCountAll"],
      communityLevel: forumResource && forumResource.attributes && forumResource.attributes.bpMyLevel,
      levelLabel: flarumLevelLabel(
        forumResource && forumResource.attributes && forumResource.attributes.bpMyLevel,
        forumResource && forumResource.attributes && forumResource.attributes.bpLevelNames,
      ),
    };
    const sessionUserId = Number(payload && payload.session && payload.session.userId);
    return {
      user,
      summary,
      activities: [],
      sessionUserId: Number.isFinite(sessionUserId) && sessionUserId > 0 ? sessionUserId : null,
    };
  }

  function parseFlarumUserDocument(value, expectedId = null) {
    const body = parseFlarumJson(value);
    if (!body) return null;
    const candidates = [
      ...(isObject(body.data) ? [body.data] : []),
      ...(Array.isArray(body.included) ? body.included : []),
      ...(Array.isArray(body.resources) ? body.resources : []),
    ];
    const expected = Number(expectedId);
    const userResource = candidates.find(
      (resource) =>
        resource &&
        resource.type === "users" &&
        (Number.isInteger(expected) && expected > 0 ? String(resource.id) === String(expected) : true),
    );
    if (!userResource) return null;
    const attrs = isObject(userResource.attributes) ? userResource.attributes : {};
    const username = text(firstValue(attrs.username, attrs.slug));
    const money = Number(attrs.money);
    const summary = {};
    if (attrs.discussionCount !== undefined) summary.discussionCount = attrs.discussionCount;
    if (attrs.commentCount !== undefined) summary.commentCount = attrs.commentCount;
    if (attrs["fof-upload-uploadCountAll"] !== undefined) {
      summary.uploads = attrs["fof-upload-uploadCountAll"];
    }
    if (Number.isFinite(money)) summary.money = money;
    const user = username ? { username, profileUrl: `/bbs/u/${encodeURIComponent(username)}` } : null;
    const displayName = firstValue(attrs.displayName, attrs.username);
    if (user && displayName !== undefined) user.displayName = displayName;
    if (user && attrs.avatarUrl !== undefined) user.avatarUrl = attrs.avatarUrl;
    if (user && attrs.joinTime !== undefined) user.joinTime = attrs.joinTime;
    if (user && attrs.lastSeenAt !== undefined) user.lastSeenAt = attrs.lastSeenAt;
    return { user, summary };
  }

  function readFlarumPayload(documentRef = root.document) {
    const node = documentRef && typeof documentRef.getElementById === "function"
      ? documentRef.getElementById("flarum-json-payload")
      : null;
    return node ? parseFlarumPayload(node.textContent) : null;
  }

  function parseFlarumPostsDocument(value) {
    const body = parseFlarumJson(value);
    if (!body) return [];
    const candidates = [
      ...(Array.isArray(body.data) ? body.data : []),
      ...(Array.isArray(body.included) ? body.included : []),
    ];
    const discussions = new Map();
    for (const resource of candidates) {
      if (resource && resource.type === "discussions" && resource.id !== undefined && resource.id !== null) {
        discussions.set(String(resource.id), resource);
      }
    }
    const records = [];
    const seen = new Set();
    for (const resource of candidates) {
      if (!resource || resource.type !== "posts" || resource.id === undefined || resource.id === null) continue;
      const id = String(resource.id);
      if (seen.has(id)) continue;
      const attrs = isObject(resource.attributes) ? resource.attributes : {};
      if (attrs.contentType && attrs.contentType !== "comment") continue;
      const relationships = isObject(resource.relationships) ? resource.relationships : {};
      const discussionRef =
        isObject(relationships.discussion) && isObject(relationships.discussion.data)
          ? relationships.discussion.data
          : null;
      const discussionId =
        discussionRef && discussionRef.id !== undefined && discussionRef.id !== null
          ? String(discussionRef.id)
          : null;
      const discussion = discussionId !== null ? discussions.get(discussionId) : null;
      const discussionAttrs = isObject(discussion && discussion.attributes)
        ? discussion.attributes
        : {};
      const title = text(firstValue(discussionAttrs.title, attrs.title));
      if (!title) continue;
      const slug = text(discussionAttrs.slug);
      const basePath = slug && slug.startsWith(`${discussionId}-`)
        ? `/bbs/d/${slug}`
        : discussionId && /^\d+$/.test(discussionId)
          ? `/bbs/d/${discussionId}`
          : null;
      if (!basePath) continue;
      const number = Number(attrs.number);
      seen.add(id);
      records.push({
        id,
        type: Number.isFinite(number) && number === 1 ? "topic" : "reply",
        title,
        url: Number.isFinite(number) && number > 1 ? `${basePath}/${number}` : basePath,
        timestamp: text(firstValue(attrs.createdAt, attrs.editedAt)) || null,
        category: null,
      });
    }
    return records;
  }

  async function fetchFlarumPostsActivities(username, timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    const encoded = encodeURIComponent(text(username));
    if (!encoded || typeof root.fetch !== "function") return [];
    const query =
      `filter[author]=${encoded}&filter[type]=comment&page[limit]=${POSTS_PAGE_LIMIT}&sort=-createdAt`;
    const result = await requestJson(`${POSTS_ENDPOINT}?${query}`, timeoutMs);
    if (!result.ok || !isObject(result.body)) return [];
    return parseFlarumPostsDocument(result.body);
  }

  async function pollProfileActivities(records, waitMs) {
    let data = Array.isArray(records) ? records : [];
    const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
    while (!data.length && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(PROFILE_DOM_POLL_INTERVAL_MS, deadline - Date.now())),
      );
      data = extractFlarumActivityRecords(root.document);
    }
    return data;
  }

  async function collectLatestActivities(username, domActivities) {
    const apiRecords = await fetchFlarumPostsActivities(username);
    if (apiRecords.length) return apiRecords;

    const pathUser = extractUserFromPath(root.location && root.location.pathname);
    if (pathUser && text(pathUser) !== username) return [];

    return pollProfileActivities(domActivities, pathUser ? PROFILE_DOM_POLL_WAIT_MS : 0);
  }

  function normalizeDomActivity(records) {
    const prepared = (Array.isArray(records) ? records : []).map((record) => {
      const item = isObject(record) ? record : {};
      const rawText = text(firstValue(item.title, item.text, item.label));
      const href = firstValue(item.url, item.href);
      const surrounding = text(item.context).toLowerCase();
      const type =
        item.type ||
        (/(回复|回应|reply|respond)/i.test(surrounding) ? "reply" : "topic");
      return {
        ...item,
        type,
        title: rawText,
        url: href,
        category: firstValue(item.category, item.category_name),
        timestamp: firstValue(item.timestamp, item.created_at, item.time),
      };
    });
    return typeof adapter.normalizeActivity === "function"
      ? adapter.normalizeActivity(prepared, ORIGIN)
      : [];
  }

  function discussionPostUrl(href, postNumber) {
    const raw = text(href);
    if (!raw) return null;
    let url;
    try {
      url = new URL(raw, ORIGIN);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.hostname !== "baipiao.org") return null;
    if (!url.pathname.startsWith(`${BBS_PREFIX}/d/`)) return null;
    const number = Number(postNumber);
    if (Number.isFinite(number) && number > 0) {
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (!/^\d+$/.test(last)) {
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/${number}`;
      }
    }
    return `${url.pathname}${url.search}`;
  }

  function extractPostNumber(article) {
    const meta = article && typeof article.querySelector === "function"
      ? article.querySelector(".PostMeta-number")
      : null;
    const match = text(meta && meta.textContent).match(/#(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function extractFlarumActivityRecords(documentRef = root.document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return [];
    return Array.from(documentRef.querySelectorAll(".PostsUserPage-discussion"))
      .map((group) => {
        const discussionLink = group.querySelector && group.querySelector("a[href*='/bbs/d/']");
        const article = group.nextElementSibling;
        if (!discussionLink || !article) return null;
        const postNumber = extractPostNumber(article);
        const timeElement = article.querySelector && article.querySelector("time[datetime]");
        const isStartUser = Boolean(
          article.classList &&
            typeof article.classList.contains === "function" &&
            article.classList.contains("Post--by-start-user"),
        );
        return {
          type: isStartUser && postNumber === 1 ? "topic" : "reply",
          title: text(discussionLink.textContent),
          url: discussionPostUrl(discussionLink.getAttribute("href"), postNumber),
          timestamp: timeElement ? timeElement.getAttribute("datetime") : null,
          category: null,
        };
      })
      .filter((record) => record && record.title && record.url);
  }

  function extractFlarumMoneyHistory(documentRef = root.document) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return [];
    return Array.from(documentRef.querySelectorAll(".transferHistoryContainer"))
      .map((container) => {
        const raw = text(
          firstValue(
            container.textContent,
            Array.from(container.children || [])
              .map((child) => child && child.textContent)
              .filter(Boolean)
              .join(" "),
          ),
        );
        const type = (raw.match(/类型\s*:\s*([^|]+?)(?=\s*\|\s*时间\s*:)/) || [])[1];
        const timestamp = (raw.match(/时间\s*:\s*([^|]+?)(?=\s*ID\s*:)/) || [])[1];
        const id = (raw.match(/ID\s*:\s*(\d+)/) || [])[1];
        const operatorNode =
          container.querySelector && container.querySelector(".moneyHistoryUser .username");
        const operator = operatorNode
          ? text(operatorNode.textContent)
          : (raw.match(/操作人\s*:\s*([^|]+?)(?=\s*\|\s*金额\s*:)/) || [])[1];
        const amount = (raw.match(/金额\s*:\s*(-?\d+(?:\.\d+)?)/) || [])[1];
        const balance = raw.match(
          /余额变动\s*:\s*(-?\d+(?:\.\d+)?)\s*→\s*(-?\d+(?:\.\d+)?)/,
        );
        const purpose = (raw.match(/资金用途\s*:\s*(.+)$/) || [])[1];
        if (!type || !timestamp || !id || !amount || !balance || !purpose) return null;
        return {
          type: text(type),
          timestamp: text(timestamp),
          id: Number(id),
          operator: text(operator),
          amount: Number(amount),
          balanceBefore: Number(balance[1]),
          balanceAfter: Number(balance[2]),
          purpose: text(purpose),
        };
      })
      .filter(Boolean);
  }

  function isMoneyHistoryPage(pathname = root.location && root.location.pathname) {
    return /\/bbs\/u\/[^/]+\/money\/history\/?$/i.test(text(pathname));
  }

  function parseFlarumMoneyHistoryDocument(value) {
    const body = parseFlarumJson(value);
    if (!body) return [];
    const candidates = [
      ...(Array.isArray(body.data) ? body.data : []),
      ...(Array.isArray(body.included) ? body.included : []),
    ];
    const users = new Map();
    for (const resource of candidates) {
      if (resource && resource.type === "users" && resource.id !== undefined && resource.id !== null) {
        users.set(String(resource.id), resource);
      }
    }
    const records = [];
    const seen = new Set();
    for (const resource of candidates) {
      if (!resource || resource.type !== "userMoneyHistory") continue;
      if (resource.id === undefined || resource.id === null) continue;
      const id = String(resource.id);
      if (seen.has(id)) continue;
      const attrs = isObject(resource.attributes) ? resource.attributes : {};
      const amount = Number(attrs.money);
      const balanceBefore = Number(attrs.balance_money);
      const balanceAfter = Number(attrs.last_money);
      const timestamp = text(attrs.change_time);
      const purpose = text(attrs.source_desc);
      if (!timestamp || !purpose) continue;
      if (!Number.isFinite(amount) || !Number.isFinite(balanceBefore) || !Number.isFinite(balanceAfter)) continue;
      const relationships = isObject(resource.relationships) ? resource.relationships : {};
      const operatorRef =
        isObject(relationships.createUser) && isObject(relationships.createUser.data)
          ? relationships.createUser.data
          : null;
      const operatorUser =
        operatorRef && operatorRef.id !== undefined && operatorRef.id !== null
          ? users.get(String(operatorRef.id))
          : null;
      const operatorAttrs = isObject(operatorUser && operatorUser.attributes)
        ? operatorUser.attributes
        : {};
      seen.add(id);
      records.push({
        id: Number.isFinite(Number(attrs.id)) ? Number(attrs.id) : Number(id),
        type: attrs.type === "D" ? "支出" : "收入",
        timestamp,
        operator: text(firstValue(operatorAttrs.username, operatorAttrs.displayName)) || null,
        amount,
        balanceBefore,
        balanceAfter,
        purpose,
      });
    }
    return records;
  }

  async function fetchFlarumUser(sessionUserId, timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    const userId = Number(sessionUserId);
    if (!Number.isInteger(userId) || userId <= 0 || typeof root.fetch !== "function") return null;
    const result = await requestJson(`/bbs/api/users/${userId}`, timeoutMs);
    if (!result.ok || !isObject(result.body)) return null;
    return parseFlarumUserDocument(result.body, userId);
  }

  function parseFlarumMoneyRankDocument(value) {
    const body = parseFlarumJson(value);
    if (!body) return null;
    const data = isObject(body.data) ? body.data : null;
    if (!data) return null;
    const rows = Array.isArray(data.top) ? data.top : null;
    if (!rows) return null;
    const top = [];
    const seen = new Set();
    for (const row of rows) {
      if (!isObject(row)) continue;
      const username = text(row.username);
      if (!username) continue;
      const rank = Number(row.rank);
      const money = Number(row.money);
      if (!Number.isFinite(rank) || !Number.isFinite(money)) continue;
      const key = username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      top.push({
        rank,
        username,
        money,
        url: `/bbs/u/${encodeURIComponent(username)}`,
        isMe: row.isMe === true,
      });
    }
    let me = null;
    if (isObject(data.me)) {
      const myRank = Number(data.me.rank);
      const myMoney = Number(data.me.money);
      if (Number.isFinite(myRank) && Number.isFinite(myMoney)) {
        me = { rank: myRank, money: myMoney, inTop: data.me.inTop === true };
      }
    }
    const total = Number(data.total);
    return {
      top: top.slice(0, MONEY_RANK_LIMIT),
      me,
      total: Number.isFinite(total) ? total : null,
    };
  }

  async function fetchFlarumMoneyRank(timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    if (typeof root.fetch !== "function") return null;
    const result = await requestJson(MONEY_RANK_ENDPOINT, timeoutMs);
    if (!result.ok || !isObject(result.body)) return null;
    return parseFlarumMoneyRankDocument(result.body);
  }

  function checkinField(source, snakeKey, camelKey, fallback = null) {
    if (!isObject(source)) return fallback;
    const value = source[snakeKey] !== undefined ? source[snakeKey] : source[camelKey];
    return value === undefined ? fallback : value;
  }

  function hasCheckinField(source, snakeKey, camelKey) {
    if (!isObject(source)) return false;
    return source[snakeKey] !== undefined || source[camelKey] !== undefined;
  }

  function checkinNumber(source, snakeKey, camelKey, fallback = null) {
    const value = checkinField(source, snakeKey, camelKey, null);
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeCheckinTier(value, withDays = false) {
    if (!isObject(value)) return null;
    const amount = Number(value.amount);
    const from = Number(value.from);
    const to = value.to === null || value.to === undefined ? null : Number(value.to);
    if (!Number.isFinite(amount) && !Number.isFinite(from)) return null;
    const tier = {
      from: Number.isFinite(from) ? from : null,
      to: Number.isFinite(to) ? to : null,
      amount: Number.isFinite(amount) ? amount : null,
    };
    if (withDays) {
      const days = Number(value.days_until !== undefined ? value.days_until : value.daysUntil);
      tier.daysUntil = Number.isFinite(days) && days >= 0 ? Math.floor(days) : null;
    }
    return tier;
  }

  function parseFlarumCheckinDocument(value) {
    const body = parseFlarumJson(value);
    if (!body) return null;
    const nested = isObject(body.data) && !Array.isArray(body.data) ? body.data : null;
    const hasCheckinKeys = (candidate) =>
      isObject(candidate) &&
      (hasCheckinField(candidate, "today_checked", "todayChecked") ||
        hasCheckinField(candidate, "can_checkin", "canCheckin") ||
        hasCheckinField(candidate, "month_days", "monthDays"));
    const source = [nested, body].find(hasCheckinKeys) || null;
    if (!source) return null;
    return {
      month: text(firstValue(checkinField(source, "month", "month"), "")) || null,
      checked: checkinField(source, "today_checked", "todayChecked") === true,
      todayReward: checkinNumber(source, "today_reward", "todayReward"),
      canCheckin: checkinField(source, "can_checkin", "canCheckin", true) !== false,
      monthDays: checkinNumber(source, "month_days", "monthDays", 0),
      monthEarned: checkinNumber(source, "month_earned", "monthEarned", 0),
      maxDaily: checkinNumber(source, "max_daily", "maxDaily"),
      tier: normalizeCheckinTier(checkinField(source, "tier", "tier")),
      nextTier: normalizeCheckinTier(checkinField(source, "next_tier", "nextTier"), true),
      blockedReason: text(firstValue(checkinField(source, "blocked_reason", "blockedReason"), "")) || null,
      url: "/bbs/checkin",
    };
  }

  function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    const raw = text(value);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function questAlterName(entries) {
    const item = Array.isArray(entries) ? entries[0] : null;
    return isObject(item) ? text(firstValue(item.alter_name, item.alterName, item.name)) || null : null;
  }

  function parseFlarumQuestsDocument(value) {
    const body = parseFlarumJson(value);
    if (!body) return null;
    const rows = Array.isArray(body)
      ? body
      : Array.isArray(body.data)
        ? body.data
        : Array.isArray(isObject(body.data) && body.data.data)
          ? body.data.data
          : null;
    if (!rows) return null;
    const quests = [];
    const seen = new Set();
    for (const resource of rows) {
      if (!isObject(resource)) continue;
      const attrs = isObject(resource.attributes) ? resource.attributes : resource;
      const id = Number(firstValue(attrs.id, resource.id));
      const name = text(attrs.name);
      if (!Number.isInteger(id) || id <= 0 || !name) continue;
      if (attrs.hidden === true || Number(attrs.hidden) === 1) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      quests.push({
        id,
        name,
        description: text(attrs.description) || null,
        condition: questAlterName(parseJsonArray(attrs.conditions)),
        reward: questAlterName(parseJsonArray(attrs.rewards)),
        done: attrs.done === true,
        daily: text(firstValue(attrs.re_available, attrs.reAvailable)) !== "",
        manual: attrs.manual === true,
      });
    }
    quests.sort((left, right) => {
      if (left.done !== right.done) return left.done ? 1 : -1;
      return left.id - right.id;
    });
    return quests.slice(0, QUESTS_PAGE_LIMIT);
  }

  async function fetchFlarumCheckin(timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    if (typeof root.fetch !== "function") return null;
    const result = await requestJson(CHECKIN_ENDPOINT, timeoutMs);
    if (!result.ok || result.body === null || result.body === undefined) return null;
    return parseFlarumCheckinDocument(result.body);
  }

  async function fetchFlarumQuests(timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    if (typeof root.fetch !== "function") return null;
    const result = await requestJson(
      `${QUESTS_ENDPOINT}?page[limit]=${QUESTS_PAGE_LIMIT}`,
      timeoutMs,
    );
    if (!result.ok || result.body === null || result.body === undefined) return null;
    return parseFlarumQuestsDocument(result.body);
  }

  async function fetchFlarumMoneyHistory(sessionUserId, timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    const userId = Number(sessionUserId);
    if (!Number.isInteger(userId) || userId <= 0 || typeof root.fetch !== "function") return [];
    const result = await requestJson(
      `/bbs/api/users/${userId}/money/history?filter[user]=${userId}&page[offset]=0`,
      timeoutMs,
    );
    if (!result.ok || !isObject(result.body)) return [];
    return parseFlarumMoneyHistoryDocument(result.body);
  }

  async function collectMoneyHistory(options = {}) {
    const payload = readFlarumPayload(root.document);
    if (payload && payload.sessionUserId) {
      const records = await fetchFlarumMoneyHistory(payload.sessionUserId);
      if (records.length) return { ok: true, data: records };
    }
    let data = extractFlarumMoneyHistory(root.document);
    if (!isMoneyHistoryPage()) return { ok: true, data };
    const waitMs = Math.max(0, Number(options.waitMs) || 0);
    const pollMs = Math.max(25, Number(options.pollMs) || 150);
    const deadline = Date.now() + waitMs;
    while (!data.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
      data = extractFlarumMoneyHistory(root.document);
    }
    return { ok: true, data };
  }

  function readCsrfToken(documentRef = root.document) {
    if (!documentRef || typeof documentRef.getElementById !== "function") return "";
    const node = documentRef.getElementById("flarum-json-payload");
    const payload = parseFlarumJson(node && node.textContent);
    const session = payload && isObject(payload.session) ? payload.session : {};
    return text(session.csrfToken) || "";
  }

  async function performCheckin(timeoutMs = PROFILE_ACTIVITIES_TIMEOUT_MS) {
    if (typeof root.fetch !== "function") {
      return { ok: false, code: "checkin_failed", message: "暂时无法签到" };
    }
    const result = await requestJson(CHECKIN_ENDPOINT, timeoutMs, {
      method: "POST",
      body: {},
      withCsrf: true,
    });
    if (!result.ok || result.body === null || result.body === undefined) {
      return { ok: false, code: "checkin_failed", message: "签到失败，请稍后重试" };
    }
    const body = isObject(result.body) ? result.body : {};
    const status = parseFlarumCheckinDocument(body);
    const granted = Number(body.granted);
    const already = body.already === true;
    const reward = Number.isFinite(granted) && granted > 0 ? granted : null;
    if (!status && !already && reward === null) {
      return { ok: false, code: "checkin_failed", message: "签到结果无法识别" };
    }
    return {
      ok: true,
      granted: reward,
      already,
      status,
      message: already
        ? "今天已经签过了，明天再来"
        : reward === null
          ? "签到成功"
          : `签到成功，+${reward} 毛`,
    };
  }

  async function requestJson(path, timeoutMs = 1800, options = {}) {
    if (!isCommunityPath(path)) {
      return { ok: false, status: 0, body: null };
    }

    const method = text(options.method).toUpperCase() === "POST" ? "POST" : "GET";
    const headers = { Accept: "application/json" };
    let body;
    if (method === "POST") {
      headers["X-Requested-With"] = "XMLHttpRequest";
      body = options.body === undefined ? "{}" : JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
      if (options.withCsrf) {
        const token = readCsrfToken();
        if (token) headers["X-CSRF-Token"] = token;
      }
    }

    const url = new URL(path, ORIGIN);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url.pathname}${url.search}`, {
        credentials: "include",
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        return { ok: false, status: response.status, body: null };
      }
      try {
        return { ok: true, status: response.status, body: await response.json() };
      } catch {
        return { ok: false, status: response.status, body: null };
      }
    } catch {
      return { ok: false, status: 0, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function firstJson(paths) {
    for (const path of paths) {
      const result = await requestJson(path);
      if (result.ok && result.body !== null) return result;
    }
    return null;
  }

  function findUser(body) {
    const data = isObject(body && body.data) ? body.data : {};
    const candidates = [
      body && body.current_user,
      body && body.currentUser,
      body && body.user,
      body && body.profile,
      data.current_user,
      data.currentUser,
      data.user,
      data.profile,
      body,
    ];
    return (
      candidates.find(
        (candidate) =>
          isObject(candidate) &&
          text(
            firstValue(
              candidate.username,
              candidate.preferred_username,
              candidate.user_name,
              candidate.handle,
            ),
          ),
      ) || null
    );
  }

  function findSummary(body) {
    const data = isObject(body && body.data) ? body.data : {};
    const candidates = [
      body && body.summary,
      body && body.stats,
      body && body.user_summary,
      body && body.userSummary,
      data.summary,
      data.stats,
      body,
    ];
    return candidates.find((candidate) => isObject(candidate)) || {};
  }

  function collectArrays(body) {
    const data = isObject(body && body.data) ? body.data : {};
    const topicList = isObject(body && body.topic_list) ? body.topic_list : {};
    const dataTopicList = isObject(data.topic_list) ? data.topic_list : {};
    return [
      body && body.activities,
      body && body.activity,
      body && body.user_actions,
      body && body.actions,
      body && body.items,
      body && body.posts,
      data.activities,
      data.activity,
      data.user_actions,
      data.actions,
      data.items,
      data.posts,
      topicList.topics,
      dataTopicList.topics,
    ].filter(Array.isArray);
  }

  function prepareActivityRecords(records) {
    return records.map((record) => {
      const item = isObject(record) ? record : {};
      const topic = isObject(item.topic) ? item.topic : {};
      const targetType = text(firstValue(item.target_type, item.targetType)).toLowerCase();
      const topicId = firstValue(
        item.topic_id,
        item.topicId,
        topic.id,
        targetType === "topic" ? item.target_id : null,
      );
      const slug = text(firstValue(item.slug, item.topic_slug, item.topicSlug, topic.slug));
      const generatedUrl =
        topicId !== undefined && topicId !== null
          ? `/bbs/d/${encodeURIComponent(String(topicId))}${slug ? `-${encodeURIComponent(slug)}` : ""}`
          : null;
      const actionText = text(
        firstValue(item.action, item.activity_type, item.kind),
      ).toLowerCase();
      const type =
        item.type ||
        (item.post_number === 1 ||
        /topic|created_topic|new_topic/.test(actionText) ||
        targetType === "topic"
          ? "topic"
          : "reply");
      return {
        ...item,
        type,
        title: firstValue(item.title, item.topic_title, item.topicTitle, topic.title, item.subject),
        url: firstValue(item.url, item.topic_url, item.topicUrl, topic.url, generatedUrl),
        timestamp: firstValue(
          item.timestamp,
          item.created_at,
          item.createdAt,
          item.updated_at,
          item.date,
        ),
        category: firstValue(
          item.category,
          item.category_name,
          item.categoryName,
          topic.category_name,
        ),
      };
    });
  }

  function detectHeaderUser() {
    if (!root.document) return null;
    const selectors = [
      "header a[href*='/bbs/u/']",
      "nav a[href*='/bbs/u/']",
      "[role='banner'] a[href*='/bbs/u/']",
      "[data-user-menu] a[href*='/bbs/u/']",
      ".user-menu a[href*='/bbs/u/']",
    ];
    for (const selector of selectors) {
      const link = root.document.querySelector(selector);
      if (!link) continue;
      const username = extractUserFromPath(link.getAttribute("href"));
      if (username) return username;
    }
    return null;
  }

  function collectDomFallback() {
    if (!root.document) return { user: null, activities: [] };
    const pathUser = extractUserFromPath(root.location && root.location.pathname);
    const username = pathUser || detectHeaderUser();
    const payload = {
      user: username
        ? {
            username,
            profileUrl: `/bbs/u/${encodeURIComponent(username)}`,
          }
        : null,
      activities: [],
    };

    const flarumPayload = readFlarumPayload(root.document);
    if (flarumPayload) {
      return mergePayloads({
        user: payload.user,
      }, flarumPayload, {
        activities: extractFlarumActivityRecords(root.document),
        moneyHistory: extractFlarumMoneyHistory(root.document),
      });
    }

    if (!username || !pathUser) return payload;

    const links = Array.from(root.document.querySelectorAll("a[href]")).filter((link) => {
      const href = link.getAttribute("href");
      return /^\/bbs\/d\/[^/]+/i.test(text(href));
    });
    const records = links.map((link) => {
      const container =
        link.closest("article, li, [data-topic-id], .topic-list-item, .activity-item") || link;
      const context = text(container.textContent);
      const timeElement = container.querySelector("time, [datetime]");
      return {
        href: link.getAttribute("href"),
        title: text(firstValue(link.getAttribute("title"), link.textContent)),
        category: text(
          firstValue(
            container.querySelector("[data-category]") &&
              container.querySelector("[data-category]").textContent,
            container.querySelector(".category-name") &&
              container.querySelector(".category-name").textContent,
          ),
        ),
        timestamp: timeElement
          ? firstValue(timeElement.getAttribute("datetime"), timeElement.textContent)
          : null,
        context,
      };
    });
    payload.activities = normalizeDomActivity(records);
    return payload;
  }

  function mergePayloads(...payloads) {
    const result = {
      user: {},
      summary: {},
      activities: [],
      moneyHistory: [],
      trend: null,
      leaderboard: null,
      checkin: null,
      quests: null,
    };
    for (const payload of payloads) {
      if (!isObject(payload)) continue;
      if (isObject(payload.user)) Object.assign(result.user, payload.user);
      if (isObject(payload.summary)) Object.assign(result.summary, payload.summary);
      if (Array.isArray(payload.activities)) result.activities.push(...payload.activities);
      if (Array.isArray(payload.moneyHistory)) result.moneyHistory.push(...payload.moneyHistory);
      if (Array.isArray(payload.trend)) result.trend = payload.trend;
      if (isObject(payload.leaderboard)) result.leaderboard = payload.leaderboard;
      if (isObject(payload.checkin)) result.checkin = payload.checkin;
      if (Array.isArray(payload.quests)) result.quests = payload.quests;
    }
    return result;
  }

  async function collectCommunityStats() {
    const bootstrap = readFlarumPayload(root.document);
    if (bootstrap && !bootstrap.user && !detectHeaderUser()) {
      return {
        ok: false,
        code: "not_logged_in",
        message: "请先登录白嫖社区",
      };
    }
    let domPayload = collectDomFallback();
    const username = text(domPayload.user && domPayload.user.username);
    const sessionUserId = bootstrap ? bootstrap.sessionUserId : null;
    if (username) {
      const [authoritativeUser, activities, apiMoneyHistory, apiMoneyRank, apiCheckin, apiQuests] =
        await Promise.all([
          fetchFlarumUser(sessionUserId),
          collectLatestActivities(username, domPayload.activities),
          fetchFlarumMoneyHistory(sessionUserId),
          fetchFlarumMoneyRank(),
          fetchFlarumCheckin(),
          fetchFlarumQuests(),
        ]);
      if (authoritativeUser) {
        if (isObject(authoritativeUser.user)) {
          domPayload.user = { ...domPayload.user, ...authoritativeUser.user };
        }
        if (isObject(authoritativeUser.summary)) {
          domPayload.summary = { ...domPayload.summary, ...authoritativeUser.summary };
        }
      }
      domPayload.activities = activities;
      if (apiMoneyHistory.length) domPayload.moneyHistory = apiMoneyHistory;
      if (apiMoneyRank && Array.isArray(apiMoneyRank.top) && apiMoneyRank.top.length) {
        domPayload.leaderboard = apiMoneyRank;
      }
      if (isObject(apiCheckin)) domPayload.checkin = apiCheckin;
      if (apiQuests !== null) domPayload.quests = apiQuests;
    }
    if (username) {
      const data =
        typeof adapter.normalizePayload === "function"
          ? adapter.normalizePayload(domPayload, domPayload.activities.length ? "mixed" : "api")
          : null;
      if (data && data.profile && data.profile.username) {
        return {
          ok: true,
          data,
          fetchedAt: data.fetchedAt,
        };
      }
    }

    const session = await firstJson(ENDPOINTS.session);
    const sessionUser = session ? findUser(session.body) : null;
    const sessionUsername = text(
      firstValue(
        sessionUser && sessionUser.username,
        sessionUser && sessionUser.preferred_username,
        sessionUser && sessionUser.user_name,
        username,
      ),
    );

    if (!sessionUsername) {
      return {
        ok: false,
        code: "not_logged_in",
        message: "请先登录白嫖社区",
      };
    }

    const userResult = await firstJson(ENDPOINTS.user(sessionUsername));
    const activityResult = await firstJson(ENDPOINTS.activity(sessionUsername));
    const apiPayloads = [
      sessionUser ? { user: sessionUser } : null,
      userResult
        ? {
            user: findUser(userResult.body),
            summary: findSummary(userResult.body),
            activities: prepareActivityRecords(collectArrays(userResult.body).flat()),
            trend: userResult.body && userResult.body.trend,
          }
        : null,
      activityResult
        ? {
            summary: findSummary(activityResult.body),
            activities: prepareActivityRecords(collectArrays(activityResult.body).flat()),
            trend: activityResult.body && activityResult.body.trend,
          }
        : null,
    ].filter(Boolean);
    const combined = mergePayloads(domPayload, ...apiPayloads);
    combined.user.username = sessionUsername;
    const source = apiPayloads.length && domPayload.user ? "mixed" : apiPayloads.length ? "api" : "dom";
    const data =
      typeof adapter.normalizePayload === "function"
        ? adapter.normalizePayload(combined, source)
        : null;

    if (!data || !data.profile || !data.profile.username) {
      return {
        ok: false,
        code: "no_profile",
        message: "未找到个人资料",
      };
    }
    return {
      ok: true,
      data,
      fetchedAt: data.fetchedAt,
    };
  }

  function installMessageListener() {
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.onMessage) return;
    if (root.__baipiaoCollectorInstalled) return;
    root.__baipiaoCollectorInstalled = true;
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === "GET_BAIPIAO_MONEY_HISTORY") {
        collectMoneyHistory({ waitMs: message.waitMs })
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, data: [] }));
        return true;
      }
      if (message && message.type === "GET_BAIPIAO_CHECKIN") {
        performCheckin()
          .then(sendResponse)
          .catch(() =>
            sendResponse({ ok: false, code: "checkin_failed", message: "签到失败，请稍后重试" }),
          );
        return true;
      }
      if (!message || message.type !== "GET_BAIPIAO_STATS") return undefined;
      collectCommunityStats()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            ok: false,
            code: "collector_failed",
            message: "暂时无法读取社区数据",
          }),
        );
      return true;
    });
  }

  return {
    ENDPOINTS,
    CHECKIN_ENDPOINT,
    QUESTS_ENDPOINT,
    collectCommunityStats,
    collectLatestActivities,
    collectMoneyHistory,
    collectDomFallback,
    extractFlarumActivityRecords,
    extractFlarumMoneyHistory,
    extractUserFromPath,
    fetchFlarumCheckin,
    fetchFlarumMoneyHistory,
    fetchFlarumMoneyRank,
    fetchFlarumPostsActivities,
    fetchFlarumQuests,
    fetchFlarumUser,
    parseFlarumCheckinDocument,
    parseFlarumMoneyRankDocument,
    parseFlarumQuestsDocument,
    parseFlarumUserDocument,
    installMessageListener,
    isCommunityPath,
    isMoneyHistoryPage,
    normalizeDomActivity,
    parseFlarumPayload,
    parseFlarumMoneyHistoryDocument,
    parseFlarumPostsDocument,
    performCheckin,
    pollProfileActivities,
    readCsrfToken,
    requestJson,
  };
});

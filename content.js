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

  async function requestJson(path, timeoutMs = 1800) {
    if (!isCommunityPath(path)) {
      return { ok: false, status: 0, body: null };
    }

    const url = new URL(path, ORIGIN);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url.pathname}${url.search}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
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
    const result = { user: {}, summary: {}, activities: [], trend: null };
    for (const payload of payloads) {
      if (!isObject(payload)) continue;
      if (isObject(payload.user)) Object.assign(result.user, payload.user);
      if (isObject(payload.summary)) Object.assign(result.summary, payload.summary);
      if (Array.isArray(payload.activities)) result.activities.push(...payload.activities);
      if (Array.isArray(payload.trend)) result.trend = payload.trend;
    }
    return result;
  }

  async function collectCommunityStats() {
    const domPayload = collectDomFallback();
    const session = await firstJson(ENDPOINTS.session);
    const sessionUser = session ? findUser(session.body) : null;
    const username = text(
      firstValue(
        sessionUser && sessionUser.username,
        sessionUser && sessionUser.preferred_username,
        sessionUser && sessionUser.user_name,
        domPayload.user && domPayload.user.username,
      ),
    );

    if (!username) {
      return {
        ok: false,
        code: "not_logged_in",
        message: "请先登录白嫖社区",
      };
    }

    const userResult = await firstJson(ENDPOINTS.user(username));
    const activityResult = await firstJson(ENDPOINTS.activity(username));
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
    combined.user.username = username;
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
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    collectCommunityStats,
    collectDomFallback,
    extractUserFromPath,
    installMessageListener,
    isCommunityPath,
    normalizeDomActivity,
    requestJson,
  };
});

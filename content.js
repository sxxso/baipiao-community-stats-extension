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
    return { user, summary, activities: [] };
  }

  function readFlarumPayload(documentRef = root.document) {
    const node = documentRef && typeof documentRef.getElementById === "function"
      ? documentRef.getElementById("flarum-json-payload")
      : null;
    return node ? parseFlarumPayload(node.textContent) : null;
  }

  function parseFlarumDocument(documentRef = root.document) {
    const payload = readFlarumPayload(documentRef);
    const activities = extractFlarumActivityRecords(documentRef);
    const moneyHistory = extractFlarumMoneyHistory(documentRef);
    return payload || activities.length || moneyHistory.length
      ? mergePayloads(payload, { activities, moneyHistory })
      : null;
  }

  function parseHtmlDocument(html) {
    if (!html || typeof root.DOMParser !== "function") return null;
    try {
      return new root.DOMParser().parseFromString(html, "text/html");
    } catch {
      return null;
    }
  }

  async function requestHtml(path, timeoutMs = 5000) {
    if (!isCommunityPath(path) || typeof root.fetch !== "function") return null;
    const url = new URL(path, ORIGIN);
    const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await root.fetch(`${url.pathname}${url.search}`, {
        credentials: "include",
        headers: { Accept: "text/html" },
        ...(controller ? { signal: controller.signal } : {}),
      });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchFlarumProfilePayload(username) {
    const encoded = encodeURIComponent(text(username));
    if (!encoded) return null;
    const html = await requestHtml(`/bbs/u/${encoded}`, 5000);
    return html ? parseFlarumDocument(parseHtmlDocument(html)) : null;
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

  async function collectMoneyHistory(options = {}) {
    const waitMs = Math.max(0, Number(options.waitMs) || 0);
    const pollMs = Math.max(25, Number(options.pollMs) || 150);
    const deadline = Date.now() + waitMs;
    let data = extractFlarumMoneyHistory(root.document);
    while (!data.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
      data = extractFlarumMoneyHistory(root.document);
    }
    return { ok: true, data };
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
    const result = { user: {}, summary: {}, activities: [], moneyHistory: [], trend: null };
    for (const payload of payloads) {
      if (!isObject(payload)) continue;
      if (isObject(payload.user)) Object.assign(result.user, payload.user);
      if (isObject(payload.summary)) Object.assign(result.summary, payload.summary);
      if (Array.isArray(payload.activities)) result.activities.push(...payload.activities);
      if (Array.isArray(payload.moneyHistory)) result.moneyHistory.push(...payload.moneyHistory);
      if (Array.isArray(payload.trend)) result.trend = payload.trend;
    }
    return result;
  }

  async function collectCommunityStats() {
    const bootstrap = readFlarumPayload(root.document);
    if (bootstrap && !bootstrap.user) {
      return {
        ok: false,
        code: "not_logged_in",
        message: "请先登录白嫖社区",
      };
    }
    let domPayload = collectDomFallback();
    if (domPayload.user && domPayload.user.username) {
      const profilePromise = domPayload.activities.length
        ? Promise.resolve(null)
        : fetchFlarumProfilePayload(domPayload.user.username);
      const profilePayload = await profilePromise;
      if (profilePayload) domPayload = mergePayloads(domPayload, profilePayload);
    }
    if (domPayload.user && domPayload.user.username) {
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
    if (root.__baipiaoCollectorInstalled) return;
    root.__baipiaoCollectorInstalled = true;
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === "GET_BAIPIAO_MONEY_HISTORY") {
        collectMoneyHistory({ waitMs: message.waitMs })
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, data: [] }));
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
    collectCommunityStats,
    collectMoneyHistory,
    collectDomFallback,
    extractFlarumActivityRecords,
    extractFlarumMoneyHistory,
    extractUserFromPath,
    installMessageListener,
    isCommunityPath,
    normalizeDomActivity,
    parseFlarumPayload,
    requestJson,
  };
});

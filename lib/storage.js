(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BaipiaoStorage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "baipiao.stats.snapshot";
  const THEME_KEY = "baipiao.stats.theme";
  const UPDATE_KEY = "baipiao.stats.update";
  const PROFILE_FIELDS = [
    "username",
    "displayName",
    "title",
    "avatarUrl",
    "trustLevel",
    "trustLabel",
    "joinedAt",
    "lastSeenAt",
    "profileUrl",
  ];
  const STAT_FIELDS = [
    "topics",
    "replies",
    "money",
    "communityLevel",
    "daysVisited",
    "views",
  ];
  const ACTIVITY_FIELDS = ["type", "title", "category", "timestamp", "url"];

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function valueOrNull(value) {
    return value === undefined ? null : value;
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function allowedUrl(value) {
    return typeof value === "string" && value.startsWith("https://baipiao.org/bbs/")
      ? value
      : null;
  }

  function copyFields(input, fields) {
    const source = isObject(input) ? input : {};
    return fields.reduce((result, field) => {
      result[field] = valueOrNull(source[field]);
      return result;
    }, {});
  }

  function sanitizeLeaderboard(input) {
    if (!isObject(input)) return null;
    const rows = Array.isArray(input.top) ? input.top : [];
    const seen = new Set();
    const top = rows
      .filter((entry) => isObject(entry))
      .map((entry) => ({
        rank: finiteOrNull(entry.rank),
        username: typeof entry.username === "string" ? entry.username.trim() : null,
        money: finiteOrNull(entry.money),
        url: allowedUrl(entry.url),
        isMe: entry.isMe === true,
      }))
      .filter(
        (entry) =>
          entry.rank !== null &&
          entry.rank >= 0 &&
          entry.username &&
          entry.money !== null &&
          entry.url,
      )
      .filter((entry) => {
        const key = entry.username.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
    let me = null;
    if (isObject(input.me)) {
      const rank = finiteOrNull(input.me.rank);
      const money = finiteOrNull(input.me.money);
      if (rank !== null && rank >= 0 && money !== null) {
        me = { rank, money, inTop: input.me.inTop === true };
      }
    }
    const total = finiteOrNull(input.total);
    if (!top.length && !me) return null;
    return { top, me, total: total !== null && total >= 0 ? total : null };
  }

  function allowedReleaseUrl(value) {
    return typeof value === "string" && value.startsWith("https://github.com/") ? value : null;
  }

  function sanitizeUpdateInfo(input) {
    if (!isObject(input)) return null;
    const info = {
      latestVersion:
        typeof input.latestVersion === "string" && input.latestVersion.trim()
          ? input.latestVersion.trim()
          : null,
      url: allowedReleaseUrl(input.url),
      checkedAt: finiteOrNull(input.checkedAt),
      dismissedVersion:
        typeof input.dismissedVersion === "string" && input.dismissedVersion.trim()
          ? input.dismissedVersion.trim()
          : null,
    };
    if (info.latestVersion === null && info.checkedAt === null) return null;
    return info;
  }

  function sanitizeSnapshot(input) {
    if (!isObject(input)) return null;
    const profile = copyFields(input.profile, PROFILE_FIELDS);
    const statsSource = isObject(input.stats) ? input.stats : {};
    const stats = STAT_FIELDS.reduce((result, field) => {
      result[field] = finiteOrNull(statsSource[field]);
      return result;
    }, {});
    stats.levelLabel =
      typeof statsSource.levelLabel === "string" && statsSource.levelLabel.trim()
        ? statsSource.levelLabel.trim()
        : null;
    const activity = Array.isArray(input.activity)
      ? input.activity
          .filter((entry) => isObject(entry))
          .map((entry) => ({
            type: entry.type === "topic" || entry.type === "reply" ? entry.type : null,
            title: typeof entry.title === "string" ? entry.title : null,
            category: typeof entry.category === "string" ? entry.category : null,
            timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
            url: allowedUrl(entry.url),
          }))
          .filter((entry) => entry.type && entry.title && entry.url)
      : [];
    const moneyHistory = Array.isArray(input.moneyHistory)
      ? input.moneyHistory
          .filter((entry) => isObject(entry))
          .map((entry) => ({
            type: typeof entry.type === "string" ? entry.type : null,
            timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
            id: finiteOrNull(entry.id),
            operator: typeof entry.operator === "string" ? entry.operator : null,
            amount: finiteOrNull(entry.amount),
            balanceBefore: finiteOrNull(entry.balanceBefore),
            balanceAfter: finiteOrNull(entry.balanceAfter),
            purpose: typeof entry.purpose === "string" ? entry.purpose : null,
          }))
          .filter(
            (entry) =>
              entry.type &&
              entry.timestamp &&
              entry.id !== null &&
              entry.amount !== null &&
              entry.balanceBefore !== null &&
              entry.balanceAfter !== null &&
              entry.purpose,
          )
          .slice(0, 5)
      : [];
    const trend = Array.isArray(input.trend)
      ? input.trend
          .filter((entry) => isObject(entry))
          .map((entry) => ({
            date: typeof entry.date === "string" ? entry.date : null,
            count: finiteOrNull(entry.count),
          }))
          .filter((entry) => entry.date && entry.count !== null && entry.count >= 0)
          .slice(-7)
      : [];
    const leaderboard = sanitizeLeaderboard(input.leaderboard);

    return {
      profile,
      stats,
      activity,
      moneyHistory,
      leaderboard,
      trend,
      fetchedAt:
        typeof input.fetchedAt === "string" && input.fetchedAt
          ? input.fetchedAt
          : new Date().toISOString(),
      source: ["api", "dom", "mixed"].includes(input.source) ? input.source : "mixed",
    };
  }

  function invokeChrome(method, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);

      try {
        const result = method(...args, resolveOnce);
        if (result && typeof result.then === "function") {
          result.then(resolveOnce, rejectOnce);
        }
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  function createStorage(backend) {
    const chromeMode = !backend;
    const target =
      backend ||
      (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
        ? chrome.storage.local
        : null);
    if (!target) throw new Error("storage backend unavailable");

    async function read(key) {
      const result = chromeMode
        ? await invokeChrome(target.get.bind(target), [key])
        : await target.get(key);
      return isObject(result) && Object.prototype.hasOwnProperty.call(result, key)
        ? result[key]
        : result;
    }

    async function write(key, value) {
      if (chromeMode) {
        await invokeChrome(target.set.bind(target), [{ [key]: value }]);
      } else {
        await target.set(key, value);
      }
    }

    return {
      async loadSnapshot() {
        return sanitizeSnapshot(await read(STORAGE_KEY));
      },
      async saveSnapshot(snapshot) {
        const safe = sanitizeSnapshot(snapshot);
        if (!safe) throw new Error("invalid stats snapshot");
        await write(STORAGE_KEY, safe);
        return safe;
      },
      async loadTheme() {
        const value = await read(THEME_KEY);
        return value === "dark" || value === "light" ? value : "light";
      },
      async saveTheme(theme) {
        if (theme !== "dark" && theme !== "light") return false;
        await write(THEME_KEY, theme);
        return true;
      },
      async loadUpdateInfo() {
        return sanitizeUpdateInfo(await read(UPDATE_KEY));
      },
      async saveUpdateInfo(info) {
        const safe = sanitizeUpdateInfo(info);
        if (!safe) throw new Error("invalid update info");
        await write(UPDATE_KEY, safe);
        return safe;
      },
    };
  }

  return {
    STORAGE_KEY,
    THEME_KEY,
    UPDATE_KEY,
    createStorage,
    sanitizeSnapshot,
    sanitizeUpdateInfo,
  };
});

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
  const PROFILE_FIELDS = [
    "username",
    "displayName",
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
    "likesReceived",
    "likesGiven",
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

  function sanitizeSnapshot(input) {
    if (!isObject(input)) return null;
    const profile = copyFields(input.profile, PROFILE_FIELDS);
    const statsSource = isObject(input.stats) ? input.stats : {};
    const stats = STAT_FIELDS.reduce((result, field) => {
      result[field] = finiteOrNull(statsSource[field]);
      return result;
    }, {});
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

    return {
      profile,
      stats,
      activity,
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
    };
  }

  return {
    STORAGE_KEY,
    THEME_KEY,
    createStorage,
    sanitizeSnapshot,
  };
});

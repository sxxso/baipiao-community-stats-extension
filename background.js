if (typeof importScripts === "function" && typeof BaipiaoStorage === "undefined") {
  importScripts("lib/storage.js");
}

(function (root, factory) {
  let storageLib = root.BaipiaoStorage;
  if (!storageLib && typeof module === "object" && module.exports) {
    storageLib = require("./lib/storage");
  }
  const api = factory(root, storageLib || {});
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    const bridge = api.createBackground();
    bridge.installMessageListener();
    void bridge.maybeCheckForUpdate();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, storageLib) {
  "use strict";

  const ORIGIN = "https://baipiao.org";
  const BBS_PREFIX = "/bbs";
  const COMMUNITY_URL = `${ORIGIN}/bbs/`;
  const TAB_PATTERN = `${ORIGIN}/bbs/*`;
  const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  const TAB_READY_TIMEOUT_MS = 5000;
  const MONEY_HISTORY_WAIT_MS = 6000;
  const MONEY_HISTORY_TIMEOUT_MS = 7000;
  const UPDATE_CHECK_URL =
    "https://api.github.com/repos/sxxso/baipiao-community-stats-extension/releases/latest";
  const RELEASES_PAGE_URL =
    "https://github.com/sxxso/baipiao-community-stats-extension/releases/latest";
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function isAllowedCommunityUrl(value) {
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

  function promiseCall(method, args) {
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

  function withTimeout(promise, timeoutMs, timeoutValue) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
    ]);
  }

  function createBackground(environment = {}) {
    const chromeApi = environment.chrome || root.chrome;
    const hasInjectedStorage = Object.prototype.hasOwnProperty.call(environment, "storage");
    const storage = hasInjectedStorage
      ? environment.storage
      : storageLib && typeof storageLib.createStorage === "function"
        ? storageLib.createStorage()
        : null;
    const autoCheckUpdates =
      !Object.prototype.hasOwnProperty.call(environment, "chrome") && !hasInjectedStorage;

    if (!chromeApi || !chromeApi.tabs) {
      throw new Error("chrome tabs API unavailable");
    }

    async function findCommunityTab() {
      const query = chromeApi.tabs.query.bind(chromeApi.tabs);
      try {
        const active = await promiseCall(query, [
          { active: true, lastFocusedWindow: true, url: [TAB_PATTERN] },
        ]);
        if (Array.isArray(active) && active[0]) return active[0];
      } catch {
        // Fall through to the broader query when the focused-window query is unavailable.
      }
      try {
        const tabs = await promiseCall(query, [{ url: [TAB_PATTERN] }]);
        return Array.isArray(tabs) && tabs[0] ? tabs[0] : null;
      } catch {
        return null;
      }
    }

    async function getOrCreateCommunityTab() {
      const existing = await findCommunityTab();
      if (existing) {
        await waitForTabReady(existing);
        return existing;
      }
      try {
        const created = await promiseCall(chromeApi.tabs.create.bind(chromeApi.tabs), [
          { url: COMMUNITY_URL, active: false },
        ]);
        if (created) await waitForTabReady(created);
        return created || null;
      } catch {
        return null;
      }
    }

    async function waitForTabReady(tab, timeoutMs = TAB_READY_TIMEOUT_MS) {
      if (!tab || tab.status === "complete") return true;
      const updated = chromeApi.tabs.onUpdated;
      if (!updated || typeof updated.addListener !== "function") return true;
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => finish(true), timeoutMs);
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (typeof updated.removeListener === "function") {
            updated.removeListener(listener);
          }
          resolve(value);
        };
        const listener = (id, changeInfo) => {
          if (id === tab.id && changeInfo && changeInfo.status === "complete") finish(true);
        };
        updated.addListener(listener);
      });
    }

    async function requestFromContentScript(tabId, message, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
      if (tabId === undefined || typeof chromeApi.tabs.sendMessage !== "function") {
        return { ok: false, code: "collector_failed", message: "暂时无法读取社区数据" };
      }
      const pending = promiseCall(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), [
        tabId,
        message,
        undefined,
      ])
        .then(
          (response) =>
            response || {
              ok: false,
              code: "content_unavailable",
              message: "暂时无法读取社区数据",
            },
        )
        .catch(() => ({
          ok: false,
          code: "content_unavailable",
          message: "暂时无法读取社区数据",
        }));
      return withTimeout(pending, timeoutMs, {
        ok: false,
        code: "timeout",
        message: "读取社区数据超时",
      });
    }

    async function injectCollector(tabId) {
      if (tabId === undefined || !chromeApi.scripting || typeof chromeApi.scripting.executeScript !== "function") {
        return false;
      }
      try {
        await promiseCall(chromeApi.scripting.executeScript.bind(chromeApi.scripting), [
          {
            target: { tabId },
            files: ["lib/data-adapter.js", "content.js"],
          },
        ]);
        return true;
      } catch {
        return false;
      }
    }

    async function collectMoneyHistoryFromTab(tab, timeoutMs = MONEY_HISTORY_TIMEOUT_MS) {
      let response =
        tab && tab.id !== undefined
          ? await requestFromContentScript(
              tab.id,
              { type: "GET_BAIPIAO_MONEY_HISTORY", waitMs: MONEY_HISTORY_WAIT_MS },
              timeoutMs,
            )
          : { ok: false, code: "no_tab", message: "无法读取资金记录" };
      if (
        response &&
        response.code === "content_unavailable" &&
        tab &&
        tab.id !== undefined &&
        (await injectCollector(tab.id))
      ) {
        response = await requestFromContentScript(
          tab.id,
          { type: "GET_BAIPIAO_MONEY_HISTORY", waitMs: MONEY_HISTORY_WAIT_MS },
          timeoutMs,
        );
      }
      return response && response.ok && Array.isArray(response.data) ? response.data : [];
    }

    async function collectStatsFromTab(tab, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
      let response = tab
        ? await requestFromContentScript(tab.id, { type: "GET_BAIPIAO_STATS" }, timeoutMs)
        : { ok: false, code: "no_tab", message: "无法打开社区页面" };
      if (tab && response && response.code === "content_unavailable") {
        if (await injectCollector(tab.id)) {
          response = await requestFromContentScript(
            tab.id,
            { type: "GET_BAIPIAO_STATS" },
            timeoutMs,
          );
        } else {
          response = {
            ok: false,
            code: "collector_failed",
            message: "暂时无法读取社区数据",
          };
        }
      }
      if (response && response.code === "content_unavailable") {
        response = {
          ok: false,
          code: "collector_failed",
          message: "暂时无法读取社区数据",
        };
      }
      if (response && response.ok && response.data) {
        let data = response.data;
        if (
          data.profile &&
          data.profile.username &&
          (!Array.isArray(data.moneyHistory) || !data.moneyHistory.length)
        ) {
          const moneyHistory = await collectMoneyHistoryFromTab(tab);
          if (moneyHistory.length) data = { ...data, moneyHistory };
        }
        if (!Array.isArray(data.activity) || !data.activity.length) {
          const cached = await readCache();
          const cachedActivity = cached && Array.isArray(cached.activity) ? cached.activity : [];
          if (cachedActivity.length) {
            data = {
              ...data,
              activity: cachedActivity,
              trend:
                Array.isArray(cached.trend) && cached.trend.length ? cached.trend : data.trend,
            };
          }
        }
        if (!data.leaderboard || !Array.isArray(data.leaderboard.top) || !data.leaderboard.top.length) {
          const cached = await readCache();
          const cachedBoard = cached && cached.leaderboard;
          if (cachedBoard && Array.isArray(cachedBoard.top) && cachedBoard.top.length) {
            data = { ...data, leaderboard: cachedBoard };
          }
        }
        try {
          if (storage && typeof storage.saveSnapshot === "function") {
            data = await storage.saveSnapshot(data);
          }
        } catch {
          // A fresh response is still useful when local cache writes are unavailable.
        }
        if (autoCheckUpdates) void maybeCheckForUpdate();
        return {
          ok: true,
          data,
          cached: false,
          fetchedAt: data.fetchedAt || response.fetchedAt || new Date().toISOString(),
        };
      }

      const cached = await readCache();
      return {
        ok: false,
        code: (response && response.code) || "collector_failed",
        cached,
        message: (response && response.message) || "暂时无法读取社区数据",
      };
    }

    async function readCache() {
      try {
        return storage && typeof storage.loadSnapshot === "function"
          ? await storage.loadSnapshot()
          : null;
      } catch {
        return null;
      }
    }

    function normalizeVersion(value) {
      return text(value).replace(/^v/i, "").trim();
    }

    function compareVersions(left, right) {
      const a = normalizeVersion(left)
        .split(".")
        .map((part) => Number(part) || 0);
      const b = normalizeVersion(right)
        .split(".")
        .map((part) => Number(part) || 0);
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        const diff = (a[index] || 0) - (b[index] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
      return 0;
    }

    function currentVersion() {
      try {
        const runtime = chromeApi.runtime;
        const manifest =
          runtime && typeof runtime.getManifest === "function" ? runtime.getManifest() : null;
        return normalizeVersion(manifest && manifest.version);
      } catch {
        return "";
      }
    }

    function buildUpdateStatus(info, current) {
      const latest = info && info.latestVersion ? info.latestVersion : null;
      const dismissed = info && info.dismissedVersion ? info.dismissedVersion : null;
      const checkedAt = info ? Number(info.checkedAt) : null;
      return {
        ok: true,
        update: {
          available: Boolean(latest && compareVersions(latest, current) > 0 && dismissed !== latest),
          currentVersion: current || null,
          latestVersion: latest,
          url: (info && info.url) || RELEASES_PAGE_URL,
          checkedAt: Number.isFinite(checkedAt) ? checkedAt : null,
        },
      };
    }

    async function readUpdateInfo() {
      try {
        return storage && typeof storage.loadUpdateInfo === "function"
          ? await storage.loadUpdateInfo()
          : null;
      } catch {
        return null;
      }
    }

    async function fetchLatestRelease() {
      if (typeof root.fetch !== "function") return null;
      try {
        const response = await fetch(UPDATE_CHECK_URL, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) return null;
        const body = await response.json();
        if (!body || typeof body !== "object") return null;
        const latestVersion = normalizeVersion(body.tag_name);
        if (!latestVersion) return null;
        const url =
          typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/")
            ? body.html_url
            : RELEASES_PAGE_URL;
        return { latestVersion, url };
      } catch {
        return null;
      }
    }

    async function checkForUpdate({ force = false } = {}) {
      const current = currentVersion();
      const cached = await readUpdateInfo();
      const lastCheck = cached ? Number(cached.checkedAt) : null;
      const recentlyChecked =
        Number.isFinite(lastCheck) && Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS;
      if (!force && recentlyChecked) {
        return buildUpdateStatus(cached, current);
      }
      let info = cached || {
        latestVersion: null,
        url: null,
        checkedAt: null,
        dismissedVersion: null,
      };
      const release = await fetchLatestRelease();
      if (release) {
        info = {
          latestVersion: release.latestVersion,
          url: release.url,
          dismissedVersion: info.dismissedVersion || null,
          checkedAt: Date.now(),
        };
      } else {
        info.checkedAt = Date.now();
      }
      if (storage && typeof storage.saveUpdateInfo === "function") {
        try {
          info = await storage.saveUpdateInfo(info);
        } catch {
          // The in-memory info is still useful when persistence is unavailable.
        }
      }
      return buildUpdateStatus(info, current);
    }

    async function maybeCheckForUpdate() {
      try {
        await checkForUpdate({ force: false });
      } catch {
        // Update checks must never break stats collection.
      }
    }

    async function handleMessage(message, options = {}) {
      if (!message || typeof message.type !== "string") {
        return { ok: false, code: "invalid_message", message: "请求格式不正确" };
      }
      if (message.type === "GET_CACHED_STATS") {
        return { ok: true, data: await readCache(), cached: true };
      }
      if (message.type === "OPEN_URL") {
        if (!isAllowedCommunityUrl(message.url)) {
          return { ok: false, code: "unsafe_url", message: "只允许打开白嫖社区页面" };
        }
        try {
          const tab = await promiseCall(chromeApi.tabs.create.bind(chromeApi.tabs), [
            { url: new URL(message.url, ORIGIN).toString(), active: true },
          ]);
          return { ok: true, tabId: tab && tab.id };
        } catch {
          return { ok: false, code: "open_failed", message: "无法打开社区页面" };
        }
      }
      if (message.type === "GET_UPDATE_INFO") {
        return buildUpdateStatus(await readUpdateInfo(), currentVersion());
      }
      if (message.type === "CHECK_UPDATE_NOW") {
        return checkForUpdate({ force: true });
      }
      if (message.type === "DISMISS_UPDATE") {
        const info = await readUpdateInfo();
        if (info && info.latestVersion && storage && typeof storage.saveUpdateInfo === "function") {
          try {
            await storage.saveUpdateInfo({ ...info, dismissedVersion: info.latestVersion });
          } catch {
            // Dismissing a notice is best-effort.
          }
        }
        return { ok: true };
      }
      if (message.type === "OPEN_UPDATE_PAGE") {
        try {
          const tab = await promiseCall(chromeApi.tabs.create.bind(chromeApi.tabs), [
            { url: RELEASES_PAGE_URL, active: true },
          ]);
          return { ok: true, tabId: tab && tab.id };
        } catch {
          return { ok: false, code: "open_failed", message: "无法打开发布页面" };
        }
      }
      if (message.type !== "GET_STATS" && message.type !== "GET_WIDGET_STATS") {
        return { ok: false, code: "unknown_message", message: "未知请求" };
      }

      const timeoutMs =
        Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;
      const tab =
        message.type === "GET_WIDGET_STATS" && options.senderTabId !== undefined
          ? { id: options.senderTabId }
          : await getOrCreateCommunityTab();
      return collectStatsFromTab(tab, timeoutMs);
    }

    function installMessageListener() {
      if (!chromeApi.runtime || !chromeApi.runtime.onMessage) return;
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleMessage(message, {
          senderTabId: sender && sender.tab ? sender.tab.id : undefined,
        })
          .then(sendResponse)
          .catch(() =>
            sendResponse({
              ok: false,
              code: "bridge_failed",
              message: "暂时无法读取社区数据",
            }),
          );
        return true;
      });
    }

    return {
      checkForUpdate,
      compareVersions,
      currentVersion,
      findCommunityTab,
      getOrCreateCommunityTab,
      handleMessage,
      injectCollector,
      collectMoneyHistoryFromTab,
      collectStatsFromTab,
      installMessageListener,
      maybeCheckForUpdate,
      requestFromContentScript,
      waitForTabReady,
    };
  }

  return {
    COMMUNITY_URL,
    RELEASES_PAGE_URL,
    UPDATE_CHECK_URL,
    createBackground,
    isAllowedCommunityUrl,
  };
});

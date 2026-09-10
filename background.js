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
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, storageLib) {
  "use strict";

  const ORIGIN = "https://baipiao.org";
  const BBS_PREFIX = "/bbs";
  const COMMUNITY_URL = `${ORIGIN}/bbs/`;
  const TAB_PATTERN = `${ORIGIN}/bbs/*`;

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

    async function waitForTabReady(tabId, timeoutMs = 3000) {
      const updated = chromeApi.tabs.onUpdated;
      if (!updated || typeof updated.addListener !== "function") return;
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (typeof updated.removeListener === "function") {
            updated.removeListener(listener);
          }
          resolve();
        };
        const listener = (id, changeInfo) => {
          if (id === tabId && changeInfo && changeInfo.status === "complete") finish();
        };
        updated.addListener(listener);
        setTimeout(finish, timeoutMs);
      });
    }

    async function getOrCreateCommunityTab() {
      const existing = await findCommunityTab();
      if (existing) return existing;
      try {
        const created = await promiseCall(chromeApi.tabs.create.bind(chromeApi.tabs), [
          { url: COMMUNITY_URL, active: false },
        ]);
        if (created && created.id !== undefined) {
          await waitForTabReady(created.id);
        }
        return created || null;
      } catch {
        return null;
      }
    }

    async function requestFromContentScript(tabId, message, timeoutMs = 3000) {
      if (tabId === undefined || typeof chromeApi.tabs.sendMessage !== "function") {
        return { ok: false, code: "collector_failed", message: "暂时无法读取社区数据" };
      }
      const pending = promiseCall(chromeApi.tabs.sendMessage.bind(chromeApi.tabs), [
        tabId,
        message,
      ]).catch(() => ({
        ok: false,
        code: "collector_failed",
        message: "暂时无法读取社区数据",
      }));
      return withTimeout(pending, timeoutMs, {
        ok: false,
        code: "timeout",
        message: "读取社区数据超时",
      });
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
      if (message.type !== "GET_STATS") {
        return { ok: false, code: "unknown_message", message: "未知请求" };
      }

      const tab = await getOrCreateCommunityTab();
      const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3000;
      const response = tab
        ? await requestFromContentScript(tab.id, { type: "GET_BAIPIAO_STATS" }, timeoutMs)
        : { ok: false, code: "no_tab", message: "无法打开社区页面" };
      if (response && response.ok && response.data) {
        let data = response.data;
        try {
          if (storage && typeof storage.saveSnapshot === "function") {
            data = await storage.saveSnapshot(response.data);
          }
        } catch {
          // A fresh response is still useful when local cache writes are unavailable.
        }
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

    function installMessageListener() {
      if (!chromeApi.runtime || !chromeApi.runtime.onMessage) return;
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleMessage(message)
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
      findCommunityTab,
      getOrCreateCommunityTab,
      handleMessage,
      installMessageListener,
      requestFromContentScript,
    };
  }

  return {
    COMMUNITY_URL,
    createBackground,
    isAllowedCommunityUrl,
  };
});

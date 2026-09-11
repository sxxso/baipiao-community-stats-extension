(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BaipiaoMoneyWidget = api;
    if (root.document) void api.init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const WIDGET_ID = "baipiao-money-widget";
  const COLLAPSED_KEY = "baipiao.moneyWidget.collapsed";
  const COMMUNITY_URL = "https://baipiao.org/bbs/";
  const state = {
    data: null,
    loading: false,
    error: "",
    collapsed: false,
  };

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
      : "—";
  }

  function isHistoryPage(pathname = root.location && root.location.pathname) {
    return /\/bbs\/u\/[^/]+\/money\/history\/?$/i.test(text(pathname));
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

  function sendMessage(message) {
    const runtime = root.chrome && root.chrome.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return Promise.resolve({ ok: false, code: "bridge_missing" });
    }
    return invokeChrome(runtime.sendMessage.bind(runtime), [message]).catch(() => ({
      ok: false,
      code: "bridge_failed",
    }));
  }

  async function loadCollapsedPreference() {
    const storage = root.chrome && root.chrome.storage && root.chrome.storage.local;
    if (!storage || typeof storage.get !== "function") return false;
    try {
      const result = await invokeChrome(storage.get.bind(storage), [COLLAPSED_KEY]);
      return Boolean(result && result[COLLAPSED_KEY]);
    } catch {
      return false;
    }
  }

  async function saveCollapsedPreference(value) {
    const storage = root.chrome && root.chrome.storage && root.chrome.storage.local;
    if (!storage || typeof storage.set !== "function") return;
    try {
      await invokeChrome(storage.set.bind(storage), [{ [COLLAPSED_KEY]: Boolean(value) }]);
    } catch {
      // The widget remains usable when preference storage is unavailable.
    }
  }

  function createNode(tag, className, value) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function buildWidget() {
    const widget = createNode("aside", "bp-money-widget");
    widget.id = WIDGET_ID;
    widget.setAttribute("aria-label", "白嫖社区资金记录");

    const header = createNode("header", "bp-money-widget__header");
    const heading = createNode("div", "bp-money-widget__heading");
    const title = createNode("strong", "bp-money-widget__title", "资金记录");
    title.id = "bp-money-widget-title";
    const subtitle = createNode("span", "bp-money-widget__subtitle", "正在读取…");
    subtitle.id = "bp-money-widget-subtitle";
    heading.append(title, subtitle);

    const actions = createNode("div", "bp-money-widget__actions");
    const refreshButton = createNode("button", "bp-money-widget__icon", "↻");
    refreshButton.id = "bp-money-widget-refresh";
    refreshButton.type = "button";
    refreshButton.title = "刷新资金记录";
    refreshButton.setAttribute("aria-label", "刷新资金记录");
    const toggleButton = createNode("button", "bp-money-widget__icon", "−");
    toggleButton.id = "bp-money-widget-toggle";
    toggleButton.type = "button";
    toggleButton.title = "收起资金窗口";
    toggleButton.setAttribute("aria-label", "收起资金窗口");
    toggleButton.setAttribute("aria-expanded", "true");
    actions.append(refreshButton, toggleButton);
    header.append(heading, actions);

    const body = createNode("div", "bp-money-widget__body");
    body.id = "bp-money-widget-body";
    const status = createNode("p", "bp-money-widget__status", "正在读取资金记录…");
    status.id = "bp-money-widget-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = createNode("ol", "bp-money-widget__list");
    list.id = "bp-money-widget-list";
    body.append(status, list);

    const footer = createNode("footer", "bp-money-widget__footer");
    const count = createNode("span", "", "最近 5 条");
    count.id = "bp-money-widget-count";
    const historyLink = createNode("a", "bp-money-widget__link", "查看全部 ↗");
    historyLink.id = "bp-money-widget-link";
    historyLink.target = "_blank";
    historyLink.rel = "noreferrer";
    historyLink.hidden = true;
    footer.append(count, historyLink);

    widget.append(header, body, footer);
    root.document.body.append(widget);

    refreshButton.addEventListener("click", () => void refresh());
    toggleButton.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      render();
      void saveCollapsedPreference(state.collapsed);
    });
    return widget;
  }

  function recordDelta(record) {
    const before = Number(record && record.balanceBefore);
    const after = Number(record && record.balanceAfter);
    if (Number.isFinite(before) && Number.isFinite(after) && before !== after) return after - before;
    const amount = Number(record && record.amount);
    if (!Number.isFinite(amount)) return null;
    return /奖励|收入|获得|转入/.test(text(record && record.type)) ? amount : -Math.abs(amount);
  }

  function shortTime(value) {
    const raw = text(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return match ? `${match[2]}/${match[3]} ${match[4]}:${match[5]}` : raw || "—";
  }

  function renderRecords(records) {
    const list = root.document.getElementById("bp-money-widget-list");
    if (!list) return;
    list.replaceChildren();
    for (const record of records) {
      const item = createNode("li", "bp-money-widget__record");
      const copy = createNode("span", "bp-money-widget__record-copy");
      const purpose = createNode("strong", "", text(record.purpose) || "资金变动");
      const time = createNode("time", "", shortTime(record.timestamp));
      if (record.timestamp) time.dateTime = record.timestamp;
      copy.append(purpose, time);
      const delta = recordDelta(record);
      const amount = createNode(
        "span",
        `bp-money-widget__amount${delta !== null && delta < 0 ? " is-charge" : ""}`,
        delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`,
      );
      item.append(copy, amount);
      list.append(item);
    }
  }

  function render() {
    const widget = root.document.getElementById(WIDGET_ID);
    if (!widget) return;
    const records = Array.isArray(state.data && state.data.moneyHistory)
      ? state.data.moneyHistory.slice(0, 5)
      : [];
    const money = state.data && state.data.stats ? state.data.stats.money : null;
    const username = text(state.data && state.data.profile && state.data.profile.username);
    const title = root.document.getElementById("bp-money-widget-title");
    const subtitle = root.document.getElementById("bp-money-widget-subtitle");
    const status = root.document.getElementById("bp-money-widget-status");
    const refreshButton = root.document.getElementById("bp-money-widget-refresh");
    const toggleButton = root.document.getElementById("bp-money-widget-toggle");
    const historyLink = root.document.getElementById("bp-money-widget-link");
    const count = root.document.getElementById("bp-money-widget-count");

    widget.classList.toggle("is-collapsed", state.collapsed);
    widget.setAttribute("aria-busy", state.loading ? "true" : "false");
    if (title) title.textContent = state.collapsed ? `毛余额 ${formatNumber(money)}` : "资金记录";
    if (subtitle) {
      subtitle.textContent = state.collapsed
        ? `${records.length} 条资金记录`
        : `毛余额 ${formatNumber(money)}`;
    }
    if (refreshButton) refreshButton.disabled = state.loading;
    if (toggleButton) {
      toggleButton.textContent = state.collapsed ? "+" : "−";
      toggleButton.title = state.collapsed ? "展开资金窗口" : "收起资金窗口";
      toggleButton.setAttribute("aria-label", toggleButton.title);
      toggleButton.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
    }
    if (count) count.textContent = `最近 ${records.length} 条`;
    if (historyLink) {
      historyLink.hidden = !username;
      historyLink.href = username
        ? `${COMMUNITY_URL}u/${encodeURIComponent(username)}/money/history`
        : "";
    }

    renderRecords(records);
    if (status) {
      status.hidden = records.length > 0;
      status.textContent = state.loading
        ? "正在读取资金记录…"
        : state.error
          ? "读取失败，点击刷新重试。"
          : "暂无资金记录";
      status.setAttribute("role", state.error ? "alert" : "status");
    }
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    state.error = "";
    render();
    const response = await sendMessage({ type: "GET_WIDGET_STATS" });
    state.loading = false;
    if (response && response.ok && response.data) {
      state.data = response.data;
    } else if (response && response.code !== "not_logged_in" && response.cached) {
      state.data = response.cached;
      state.error = response.code || "collector_failed";
    } else {
      state.data = null;
      state.error = (response && response.code) || "collector_failed";
    }
    render();
  }

  async function init() {
    if (!root.document || !root.document.body || isHistoryPage()) return;
    if (root.document.getElementById(WIDGET_ID)) return;
    buildWidget();
    state.collapsed = await loadCollapsedPreference();
    render();
    const cached = await sendMessage({ type: "GET_CACHED_STATS" });
    if (cached && cached.ok && cached.data) {
      state.data = cached.data;
      render();
    }
    await refresh();
  }

  return {
    COLLAPSED_KEY,
    WIDGET_ID,
    formatNumber,
    init,
    isHistoryPage,
    recordDelta,
    refresh,
    render,
    shortTime,
    state,
  };
});


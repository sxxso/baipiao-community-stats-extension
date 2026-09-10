(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BaipiaoPopup = api;
    if (root.document) api.init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const COMMUNITY_URL = "https://baipiao.org/bbs/";
  const ERROR_COPY = {
    not_logged_in: ["请先登录白嫖社区", "打开社区并完成登录后再刷新。"],
    timeout: ["读取超时", "社区响应较慢，请稍后重试。"],
    collector_failed: ["暂时无法读取", "请确认当前页面仍可访问白嫖社区。"],
    no_profile: ["未找到个人资料", "打开个人主页后再试一次。"],
    no_tab: ["无法打开社区", "请手动打开白嫖社区后重试。"],
    bridge_failed: ["暂时无法读取", "扩展后台没有返回有效数据。"],
    bridge_missing: ["请加载扩展", "当前页面不是在扩展弹窗中打开的。"],
    unknown: ["暂时无法读取", "请稍后重试。"],
  };
  const state = {
    status: "loading",
    data: null,
    cached: false,
    error: "",
    requesting: false,
  };

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function formatCount(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return "—";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  function formatRelative(value, now = new Date()) {
    const date = parseDate(value);
    if (!date) return "—";
    const diff = now.getTime() - date.getTime();
    if (diff < 90 * 1000) return "刚刚";
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 3600000))} 小时前`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 86400000))} 天前`;
    return formatDate(value);
  }

  function isSafeCommunityUrl(value) {
    const raw = text(value);
    if (!raw) return false;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    return (
      url.protocol === "https:" &&
      url.hostname === "baipiao.org" &&
      (url.pathname === "/bbs" || url.pathname.startsWith("/bbs/"))
    );
  }

  function sendMessage(message) {
    const runtime = root.chrome && root.chrome.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return Promise.resolve({ ok: false, code: "bridge_missing" });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || { ok: false, code: "bridge_failed" });
      };
      try {
        const result = runtime.sendMessage(message, finish);
        if (result && typeof result.then === "function") {
          result.then(finish, () => finish({ ok: false, code: "bridge_failed" }));
        }
      } catch {
        finish({ ok: false, code: "bridge_failed" });
      }
    });
  }

  function element(id) {
    return root.document && root.document.getElementById(id);
  }

  function stateCopy(code) {
    return ERROR_COPY[code] || ERROR_COPY.unknown;
  }

  function setText(id, value) {
    const node = element(id);
    if (node) node.textContent = value;
  }

  function renderState() {
    const panel = element("statePanel");
    const app = element("app");
    if (!panel || !app) return;
    const visible = state.status !== "success" || Boolean(state.error);
    panel.hidden = !visible;
    app.setAttribute("aria-busy", state.requesting ? "true" : "false");
    if (!visible) return;

    let title = "正在读取";
    let message = "正在读取社区数据…";
    let tone = "loading";
    if (state.status === "refreshing") {
      title = "正在更新";
      message = "正在读取最新的个人数据…";
    } else if (state.error) {
      [title, message] = stateCopy(state.error);
      if (state.data) message += " 已保留上次数据。";
      tone = "danger";
    }
    panel.dataset.tone = tone;
    setText("stateTitle", title);
    setText("stateMessage", message);
    panel.setAttribute("role", tone === "danger" ? "alert" : "status");
  }

  function renderProfile(data) {
    const profile = (data && data.profile) || {};
    const displayName = text(profile.displayName || profile.username) || "—";
    const username = text(profile.username);
    const avatar = element("avatar");
    const fallback = element("avatarFallback");
    setText("displayName", displayName);
    setText("handle", username ? `@${username}` : "未登录");
    setText(
      "trustLabel",
      profile.trustLabel
        ? profile.trustLevel === null || profile.trustLevel === undefined
          ? profile.trustLabel
          : `${profile.trustLabel} · ${profile.trustLevel}`
        : profile.trustLevel === null || profile.trustLevel === undefined
          ? "信任等级 —"
          : `信任等级 ${profile.trustLevel}`,
    );
    setText("joinedAt", formatDate(profile.joinedAt));

    if (fallback) fallback.textContent = displayName.slice(0, 1).toUpperCase() || "?";
    if (avatar) {
      const avatarUrl = isSafeCommunityUrl(profile.avatarUrl) ? profile.avatarUrl : "";
      avatar.hidden = !avatarUrl;
      avatar.alt = `${displayName} 的头像`;
      avatar.onerror = () => {
        avatar.hidden = true;
        if (fallback) fallback.hidden = false;
      };
      if (avatarUrl) {
        if (fallback) fallback.hidden = true;
        avatar.src = avatarUrl;
      } else if (fallback) {
        fallback.hidden = false;
      }
    }

    const profileButton = element("openProfileButton");
    if (profileButton) {
      const profileUrl = isSafeCommunityUrl(profile.profileUrl) ? profile.profileUrl : "";
      profileButton.disabled = !profileUrl;
      profileButton.dataset.url = profileUrl;
    }
  }

  function renderStats(data) {
    const stats = (data && data.stats) || {};
    setText("topicsValue", formatCount(stats.topics));
    setText("repliesValue", formatCount(stats.replies));
    setText("receivedValue", formatCount(stats.likesReceived));
    setText("givenValue", formatCount(stats.likesGiven));
    setText("updatedAt", data && data.fetchedAt ? `更新于 ${formatRelative(data.fetchedAt)}` : "—");
  }

  function renderTrend(data) {
    const container = element("trendBars");
    const empty = element("trendEmpty");
    if (!container || !empty) return;
    container.replaceChildren();
    const trend = Array.isArray(data && data.trend) ? data.trend : [];
    if (!trend.length) {
      container.hidden = true;
      empty.hidden = false;
      return;
    }
    container.hidden = false;
    empty.hidden = true;
    const max = Math.max(1, ...trend.map((entry) => Number(entry.count) || 0));
    for (const entry of trend.slice(-7)) {
      const column = root.document.createElement("div");
      column.className = "trend-column";
      const bar = root.document.createElement("span");
      bar.className = "trend-bar";
      const count = Math.max(0, Number(entry.count) || 0);
      bar.style.height = `${Math.max(6, (count / max) * 100)}%`;
      bar.title = `${entry.date || ""}：${formatCount(count)} 条活动`;
      const label = root.document.createElement("small");
      label.textContent = text(entry.date).slice(5) || "—";
      column.append(bar, label);
      container.append(column);
    }
  }

  function renderActivities(data) {
    const list = element("activityList");
    const empty = element("activityEmpty");
    if (!list || !empty) return;
    list.replaceChildren();
    const activities = Array.isArray(data && data.activity) ? data.activity.slice(0, 5) : [];
    empty.hidden = activities.length > 0;
    if (!activities.length) return;

    for (const activity of activities) {
      if (!isSafeCommunityUrl(activity.url) || !text(activity.title)) continue;
      const item = root.document.createElement("li");
      item.className = "activity-item";
      const link = root.document.createElement("a");
      link.className = "activity-link";
      link.href = activity.url;
      link.target = "_blank";
      link.rel = "noreferrer";

      const type = root.document.createElement("span");
      type.className = "activity-type";
      type.textContent = activity.type === "reply" ? "回复" : "主题";

      const copy = root.document.createElement("span");
      copy.className = "activity-copy";
      const title = root.document.createElement("span");
      title.className = "activity-title";
      title.textContent = activity.title;
      const meta = root.document.createElement("span");
      meta.className = "activity-meta";
      const category = root.document.createElement("span");
      category.textContent = text(activity.category) || "白嫖社区";
      meta.append(category);
      copy.append(title, meta);

      const time = root.document.createElement("time");
      time.className = "activity-time";
      time.textContent = formatRelative(activity.timestamp);
      if (activity.timestamp) time.dateTime = activity.timestamp;
      link.append(type, copy, time);
      item.append(link);
      list.append(item);
    }
    if (!list.children.length) empty.hidden = false;
  }

  function render() {
    renderState();
    renderProfile(state.data);
    renderStats(state.data);
    renderTrend(state.data);
    renderActivities(state.data);
  }

  async function openCommunityUrl(url) {
    if (!isSafeCommunityUrl(url)) return;
    const response = await sendMessage({ type: "OPEN_URL", url });
    if (!response || !response.ok) {
      state.error = response && response.code ? response.code : "unknown";
      renderState();
    }
  }

  async function refresh() {
    if (state.requesting) return;
    state.requesting = true;
    state.error = "";
    state.status = state.data ? "refreshing" : "loading";
    render();
    const response = await sendMessage({ type: "GET_STATS" });
    state.requesting = false;
    if (response && response.ok && response.data) {
      state.data = response.data;
      state.cached = false;
      state.error = "";
      state.status = "success";
    } else if (response && response.cached) {
      state.data = response.cached;
      state.cached = true;
      state.error = response.code || "unknown";
      state.status = "cached-error";
    } else {
      state.error = (response && response.code) || "unknown";
      state.status = "error";
    }
    render();
  }

  function bindEvents() {
    const refreshButton = element("refreshButton");
    const profileButton = element("openProfileButton");
    const communityButton = element("openCommunityButton");
    if (refreshButton) refreshButton.addEventListener("click", refresh);
    if (profileButton) {
      profileButton.addEventListener("click", () => openCommunityUrl(profileButton.dataset.url));
    }
    if (communityButton) {
      communityButton.addEventListener("click", () => openCommunityUrl(COMMUNITY_URL));
    }
  }

  function init() {
    bindEvents();
    void load();
  }

  async function load() {
    render();
    const cached = await sendMessage({ type: "GET_CACHED_STATS" });
    if (cached && cached.ok && cached.data) {
      state.data = cached.data;
      state.cached = true;
      state.status = "success";
      render();
    }
    await refresh();
  }

  return {
    COMMUNITY_URL,
    ERROR_COPY,
    formatCount,
    formatDate,
    formatRelative,
    init,
    isSafeCommunityUrl,
    load,
    refresh,
    render,
    state,
  };
});

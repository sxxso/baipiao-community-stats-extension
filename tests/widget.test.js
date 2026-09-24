const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isHistoryPage, recordDelta } = require("../widget");

test("calculates transaction direction from the actual balance change", () => {
  assert.equal(recordDelta({ balanceBefore: 4, balanceAfter: 796, amount: 792 }), 792);
  assert.equal(recordDelta({ balanceBefore: 30, balanceAfter: 0, amount: 30 }), -30);
  assert.equal(recordDelta({ type: "奖励", amount: 10 }), 10);
  assert.equal(recordDelta({ type: "扣费", amount: 10 }), -10);
});

test("does not place a second widget on the finance history page", () => {
  assert.equal(isHistoryPage("/bbs/u/demo/money/history"), true);
  assert.equal(isHistoryPage("/bbs/u/demo"), false);
});

test("ships the in-page finance widget and loads it on community pages", () => {
  const widget = fs.readFileSync(path.join(__dirname, "..", "widget.js"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"),
  );

  assert.match(widget, /baipiao-money-widget/);
  assert.match(widget, /GET_WIDGET_STATS/);
  assert.match(widget, /aria-expanded/);
  assert.match(widget, /renderRanks/);
  assert.match(widget, /bp-money-widget__ranks/);
  assert.match(widget, /COMMUNITY_URL}money/);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "lib/data-adapter.js",
    "content.js",
    "widget.js",
  ]);
});

test("ships the in-page check-in and daily quest panels", () => {
  const widget = fs.readFileSync(path.join(__dirname, "..", "widget.js"), "utf8");

  assert.match(widget, /renderCheckin/);
  assert.match(widget, /renderQuests/);
  assert.match(widget, /bp-money-widget__checkin-status/);
  assert.match(widget, /bp-money-widget__quests/);
  assert.match(widget, /COMMUNITY_URL}checkin/);
});

test("keeps a plain check-in list of unfinished quests first", () => {
  const checkinTone = (checkin) =>
    checkin.checked ? "done" : checkin.canCheckin ? "pending" : "blocked";

  assert.equal(checkinTone({ checked: true, canCheckin: false }), "done");
  assert.equal(checkinTone({ checked: false, canCheckin: true }), "pending");
  assert.equal(checkinTone({ checked: false, canCheckin: false }), "blocked");

  const quests = [
    { id: 1, name: "每日活跃", reward: "+10 毛", done: false },
    { id: 2, name: "每日发主题", reward: "+10 毛", done: false },
    { id: 3, name: "首次发言见面礼", reward: "+50 毛", done: true },
  ];
  const visible = quests.slice(0, 4).filter((quest) => quest.name);
  assert.equal(visible.length, 3);
  assert.equal(visible[0].name, "每日活跃");
  assert.equal(
    visible.map((quest) => (quest.done ? "已完成" : quest.reward)).join("/"),
    "+10 毛/+10 毛/已完成",
  );
});

test("exposes a one-tap check-in button for the current day", () => {
  const widget = fs.readFileSync(path.join(__dirname, "..", "widget.js"), "utf8");

  assert.match(widget, /async function checkin\(/);
  assert.match(widget, /\{ type: "CHECKIN" \}/);
  assert.match(widget, /checkinButton\.addEventListener\("click"/);
  assert.match(widget, /button\.hidden = !actionable/);
  assert.match(widget, /state\.checkingIn = true/);
});

test("only offers the check-in button while the day is still actionable", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "widget.js"), "utf8");
  const actionable = (checkin) => checkin.canCheckin && !checkin.checked;

  assert.equal(actionable({ canCheckin: true, checked: false }), true);
  assert.equal(actionable({ canCheckin: true, checked: true }), false);
  assert.equal(actionable({ canCheckin: false, checked: false }), false);
  assert.match(source, /checkin\.canCheckin && !checkin\.checked/);
});

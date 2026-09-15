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

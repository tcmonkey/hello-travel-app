import assert from "node:assert/strict";
import { test } from "node:test";
import { ContextBudget } from "../src/contextBudget.ts";

const serverBudget = {
  window: 20000,
  inputEstimate: 5000,
  outputReserve: 3000,
  safetyReserve: 2000,
  estimator: "utf8-upper-v1",
  compression: "IDLE",
};

test("未知或非法预算不能展示默认窗口或伪造占比", () => {
  for (const text of [
    undefined,
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...serverBudget, window: 0 }),
    JSON.stringify({ ...serverBudget, inputEstimate: "5000" }),
  ]) {
    const budget = ContextBudget.fromServer(text);
    assert.equal(budget.known, false);
    assert.equal(budget.percentage(), null);
    assert.equal(budget.display("window"), "—");
    assert.equal(budget.actualInputTokens, undefined);
  }
});

test("占比采用服务端配置的窗口和预留，实际用量缺失保持未知", () => {
  const budget = ContextBudget.fromServer(JSON.stringify(serverBudget));
  assert.equal(budget.known, true);
  assert.equal(budget.percentage(), 50);
  assert.equal(budget.display("outputReserve"), (3000).toLocaleString());
  assert.equal(budget.actualInputTokens, undefined);
  const actual = ContextBudget.fromServer(
    JSON.stringify({
      ...serverBudget,
      actualInputTokens: 0,
      actualOutputTokens: 123,
      compression: "COMPLETED",
    }),
  );
  assert.equal(actual.actualInputTokens, 0);
  assert.equal(actual.actualOutputTokens, 123);
  assert.equal(actual.compressionLabel(), "摘要压缩完成");
});

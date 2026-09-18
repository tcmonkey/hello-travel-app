import test from "node:test";
import assert from "node:assert/strict";
import { MessageHistory } from "../src/messageHistory.ts";
import type { Message } from "../src/types.ts";

const row = (
  id: string,
  seq: string,
  version: string,
  content: string,
): Message => ({
  id,
  seq,
  version,
  content,
  role: "ASSISTANT",
  status: "COMPLETED",
});

test("迟到草稿不覆盖新正文，大整数序号保持稳定顺序", () => {
  const history = MessageHistory.merge(
    [row("a", "9007199254740994", "3", "新正文")],
    [
      row("a", "9007199254740994", "2", "旧草稿"),
      row("b", "9007199254740993", "1", "前一条"),
    ],
    false,
  );
  assert.deepEqual(
    history.snapshot().map((message) => message.id),
    ["b", "a"],
  );
  assert.equal(history.snapshot()[1].content, "新正文");
});

test("全量恢复清除旧代次消息，外部修改不能改变历史对象", () => {
  const incoming = row("b", "2", "1", "新代次");
  const history = MessageHistory.merge(
    [row("a", "1", "1", "已删除")],
    [incoming],
    true,
  );
  incoming.content = "外部变更";
  const snapshot = history.snapshot();
  snapshot[0].content = "视图变更";
  snapshot.push(row("c", "3", "1", "额外消息"));
  assert.deepEqual(
    history.snapshot().map((message) => [message.id, message.content]),
    [["b", "新代次"]],
  );
});

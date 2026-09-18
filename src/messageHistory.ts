import type { Message } from "./types";

/** 消息历史值对象：集中控制版本合并与稳定顺序，界面只消费只读快照。 */
export class MessageHistory {
  private readonly values: readonly Message[];
  private constructor(values: readonly Message[]) {
    this.values = values.map((message) => Object.freeze({ ...message }));
  }

  static merge(
    previous: readonly Message[],
    incoming: readonly Message[],
    replace: boolean,
  ): MessageHistory {
    // 1. 全量恢复丢弃旧代次快照，增量恢复保留已显示的消息。
    const merged = new Map(
      (replace ? [] : previous).map((message) => [message.id, message]),
    );
    // 2. 同消息只接受不低于当前版本的正文，迟到事件不能覆盖新草稿。
    for (const message of incoming) {
      const prior = merged.get(message.id);
      if (!prior || BigInt(message.version) >= BigInt(prior.version)) {
        merged.set(message.id, message);
      }
    }
    // 3. 按数据库稳定序号排序，序号相等时保持比较器一致性。
    const values = [...merged.values()].sort((left, right) => {
      const a = BigInt(left.seq);
      const b = BigInt(right.seq);
      return a === b ? 0 : a < b ? -1 : 1;
    });
    return new MessageHistory(values);
  }

  snapshot(): Message[] {
    // 1. 交付独立列表，外部增删数组不会改变历史对象自身。
    return this.values.map((message) => ({ ...message }));
  }
}

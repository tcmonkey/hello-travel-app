import type { Budget } from "./types";

type BudgetField =
  "window" | "inputEstimate" | "outputReserve" | "safetyReserve";

/** 服务端预算的不可变视图；未知预算不使用前端猜测的模型上限。 */
export class ContextBudget {
  private readonly snapshot: Readonly<Budget> | null;

  private constructor(snapshot: Budget | null) {
    this.snapshot = snapshot === null ? null : Object.freeze({ ...snapshot });
  }

  static empty(): ContextBudget {
    return new ContextBudget(null);
  }

  static fromServer(text?: string): ContextBudget {
    // 1. 缺少服务端快照时保持未知，不伪造默认模型预算。
    if (!text) return ContextBudget.empty();
    // 2. 解析完整服务端预算，非法字段或JSON只产生未知视图。
    try {
      const parsed: unknown = JSON.parse(text);
      if (!ContextBudget.valid(parsed)) return ContextBudget.empty();
      // 3. 保存不可变快照，后续展示与占比使用同一份数据。
      return new ContextBudget(parsed);
    } catch {
      return ContextBudget.empty();
    }
  }

  private static valid(value: unknown): value is Budget {
    // 1. 拒绝空值、数组和非对象快照。
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    // 2. 核验完整预算与可选实际用量，防止NaN或类型错配污染展示。
    const row = value as Record<string, unknown>;
    const required = [
      "window",
      "inputEstimate",
      "outputReserve",
      "safetyReserve",
    ];
    const optional = ["actualInputTokens", "actualOutputTokens"];
    const count = (entry: unknown) =>
      typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0;
    return (
      required.every((key) => count(row[key])) &&
      (row.window as number) > 0 &&
      optional.every((key) => row[key] === undefined || count(row[key])) &&
      typeof row.estimator === "string" &&
      ["IDLE", "RUNNING", "COMPLETED"].includes(String(row.compression))
    );
  }

  get known(): boolean {
    return this.snapshot !== null;
  }

  percentage(): number | null {
    // 1. 未知窗口不计算占比，避免展示猜测或除零结果。
    const value = this.snapshot;
    if (value === null) return null;
    // 2. 使用服务端实际选择的模型限制计算保守预算占比。
    return Math.min(
      100,
      Math.round(
        ((value.inputEstimate + value.outputReserve + value.safetyReserve) /
          value.window) *
          100,
      ),
    );
  }

  display(field: BudgetField): string {
    return this.snapshot === null ? "—" : this.snapshot[field].toLocaleString();
  }

  compressionLabel(): string {
    // 1. 预算未加载时不宣称处于正常使用状态。
    if (this.snapshot === null) return "等待预算";
    // 2. 根据服务端压缩阶段提供用户可理解的状态。
    switch (this.snapshot.compression) {
      case "RUNNING":
        return "正在压缩记忆";
      case "COMPLETED":
        return "摘要压缩完成";
      default:
        return "正常使用";
    }
  }

  get actualInputTokens(): number | undefined {
    return this.snapshot?.actualInputTokens;
  }

  get actualOutputTokens(): number | undefined {
    return this.snapshot?.actualOutputTokens;
  }
}

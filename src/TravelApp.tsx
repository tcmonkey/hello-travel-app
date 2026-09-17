import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  App,
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Modal,
  Progress,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  SendOutlined,
  MoreOutlined,
  BookOutlined,
  MessageOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, ApiError, clearSession, recoverSession, stream } from "./api";
const AuthPanel = lazy(() =>
  import("./AuthPanel").then((module) => ({ default: module.AuthPanel })),
);
const KnowledgePanel = lazy(() =>
  import("./KnowledgePanel").then((module) => ({
    default: module.KnowledgePanel,
  })),
);
import type {
  Budget,
  ChatPage,
  Conversation,
  Message,
  Run,
  Session,
  SyncEvent,
  SyncPage,
} from "./types";
const zeroBudget: Budget = {
  window: 32768,
  inputEstimate: 0,
  outputReserve: 4096,
  safetyReserve: 4096,
  estimator: "utf8-upper-v1",
  compression: "IDLE",
};
function parseBudget(text?: string): Budget {
  try {
    return text ? { ...zeroBudget, ...JSON.parse(text) } : zeroBudget;
  } catch {
    return zeroBudget;
  }
}
const big = (value: string) => BigInt(value || "0");
export function TravelApp() {
  const { message, modal } = App.useApp();
  const [user, setUser] = useState<Session | null>(null);
  const [starting, setStarting] = useState(true);
  const [tabs, setTabs] = useState<Conversation[]>([]);
  const tabsRef = useRef<Conversation[]>([]);
  const [active, setActive] = useState("");
  const activeRef = useRef("");
  const [histories, setHistories] = useState<Record<string, Message[]>>({});
  const historiesRef = useRef<Record<string, Message[]>>({});
  const [menu, setMenu] = useState<"chat" | "knowledge">("chat");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState("正在连接");
  const [knowledgeRevision, setKnowledgeRevision] = useState(0);
  const [budget, setBudget] = useState<Budget>(zeroBudget);
  const [run, setRun] = useState<Run | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Conversation | null>(null);
  const [title, setTitle] = useState("");
  const cursor = useRef("0");
  const epoch = useRef(0);
  const queue = useRef(Promise.resolve());
  const bottom = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<{
    conversationId: string;
    text: string;
    requestKey: string;
  } | null>(null);
  function select(id: string) {
    activeRef.current = id;
    setActive(id);
    setSelected([]);
    setMenu("chat");
  }
  function publishTabs(values: Conversation[]) {
    values = [...new Map(values.map((value) => [value.id, value])).values()];
    tabsRef.current = values;
    setTabs(values);
    if (!values.some((tab) => tab.id === activeRef.current))
      select(values[0]?.id || "");
  }
  const loadHistory = useCallback(
    async (id: string, full: boolean, generation: number) => {
      for (let retry = 0; retry < 3; retry++) {
        const cached = historiesRef.current[id] || [];
        const prior = tabsRef.current.find((tab) => tab.id === id);
        let after =
          full || !cached.length
            ? "0"
            : String(
                big(cached[cached.length - 1].seq) > 2n
                  ? big(cached[cached.length - 1].seq) - 2n
                  : 0n,
              );
        let maxSeq: string | undefined;
        let historyEpoch = full ? undefined : prior?.historyEpoch;
        const rows: Message[] = [];
        let conversation: Conversation | undefined;
        try {
          do {
            const page = await api<ChatPage>("/chat/history", {
              conversationId: id,
              after,
              maxSeq,
              historyEpoch,
              limit: 200,
            });
            rows.push(...page.messages);
            maxSeq = page.maxSeq;
            historyEpoch = page.historyEpoch;
            conversation = page.conversations[0];
            if (!page.hasMore) break;
            if (page.nextCursor === after) throw new Error("消息分页未推进");
            after = page.nextCursor;
          } while (true);
          if (epoch.current !== generation) return;
          const merged = new Map(
            (full ? [] : cached).map((item) => [item.id, item]),
          );
          for (const row of rows) {
            const old = merged.get(row.id);
            if (!old || big(row.version) >= big(old.version))
              merged.set(row.id, row);
          }
          const values = Array.from(merged.values()).sort((a, b) =>
            big(a.seq) < big(b.seq) ? -1 : 1,
          );
          historiesRef.current = { ...historiesRef.current, [id]: values };
          setHistories(historiesRef.current);
          if (conversation) {
            const next = tabsRef.current.map((tab) =>
              tab.id === id ? conversation! : tab,
            );
            tabsRef.current = next;
            setTabs(next);
          }
          return;
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === "SYNC_RESET_REQUIRED"
          ) {
            full = true;
            continue;
          }
          throw error;
        }
      }
      throw new Error("消息正在被修改，请稍后重新加载");
    },
    [],
  );
  const loadTabs = useCallback(async (generation: number, maxSeq?: string) => {
    let after = "0";
    const all: Conversation[] = [];
    do {
      const page = await api<ChatPage>("/chat/list", {
        after,
        maxSeq,
        limit: 100,
      });
      all.push(...page.conversations);
      if (!page.hasMore) break;
      if (page.nextCursor === after) throw new Error("对话分页未推进");
      after = page.nextCursor;
    } while (true);
    if (epoch.current === generation) publishTabs(all);
    return all;
  }, []);
  const restore = useCallback(
    async (generation: number) => {
      setLoading(true);
      try {
        const manifest = await api<ChatPage>("/chat/bootstrap", {});
        const all = await loadTabs(generation, manifest.maxSeq);
        for (const tab of all) await loadHistory(tab.id, true, generation);
        if (epoch.current === generation) cursor.current = manifest.syncSeq;
      } finally {
        if (epoch.current === generation) setLoading(false);
      }
    },
    [loadTabs, loadHistory],
  );
  const loadContext = useCallback(async (id: string) => {
    if (!id) {
      setBudget(zeroBudget);
      setRun(undefined);
      return;
    }
    const page = await api<ChatPage>("/chat/context", { conversationId: id });
    if (activeRef.current === id) {
      setBudget(parseBudget(page.context));
      setRun(page.run);
    }
  }, []);
  const processEvent = useCallback(
    async (event: SyncEvent, generation: number) => {
      if (epoch.current !== generation || big(event.seq) <= big(cursor.current))
        return;
      if (
        event.targetSid === user?.sid &&
        ["session.replaced", "session.revoked"].includes(event.type)
      ) {
        clearSession();
        setUser(null);
        message.warning("当前页面登录已结束，请重新登录");
        return;
      }
      if (event.type.startsWith("knowledge."))
        setKnowledgeRevision((value) => value + 1);
      if (event.type.startsWith("conversation.")) await loadTabs(generation);
      const tab = tabsRef.current.find((item) => item.id === event.id);
      if (
        tab &&
        (event.type.startsWith("message") || event.type === "run.retried")
      )
        await loadHistory(tab.id, event.type.includes("deleted"), generation);
      if (event.type.startsWith("context.") || event.type.startsWith("run.")) {
        const page = await api<ChatPage>("/chat/run", { runId: event.id });
        if (page.run)
          await loadHistory(page.run.conversationId, false, generation);
      }
      if (
        activeRef.current &&
        (event.type.startsWith("context.") ||
          event.type.startsWith("run.") ||
          event.type.startsWith("message"))
      )
        await loadContext(activeRef.current);
      if (epoch.current === generation) cursor.current = event.seq;
    },
    [user?.sid, loadTabs, loadHistory, loadContext, message],
  );
  useEffect(() => {
    let alive = true;
    recoverSession().then((value) => {
      if (alive) {
        setUser(value);
        setStarting(false);
      }
    });
    const ended = () => {
      setUser(null);
      message.warning("登录已失效，请重新登录");
    };
    window.addEventListener("ht-session-ended", ended);
    return () => {
      alive = false;
      window.removeEventListener("ht-session-ended", ended);
    };
  }, [message]);
  useEffect(() => {
    if (!user) {
      epoch.current++;
      historiesRef.current = {};
      setHistories({});
      publishTabs([]);
      return;
    }
    const generation = ++epoch.current;
    const controller = new AbortController();
    queue.current = Promise.resolve();
    const receive = (event: SyncEvent) => {
      queue.current = queue.current.then(() => processEvent(event, generation));
    };
    async function connect() {
      try {
        await restore(generation);
      } catch (error) {
        message.error((error as Error).message);
      }
      while (!controller.signal.aborted && epoch.current === generation) {
        try {
          let more: boolean;
          do {
            const page = await api<SyncPage>("/sync?after=" + cursor.current);
            for (const event of page.items) receive(event);
            await queue.current;
            more = page.hasMore;
          } while (more && !controller.signal.aborted);
          setConnection("已同步");
          await stream(cursor.current, controller.signal, receive);
          await queue.current;
        } catch (error) {
          if (controller.signal.aborted) break;
          if (
            error instanceof ApiError &&
            error.code === "SYNC_RESET_REQUIRED"
          ) {
            await restore(generation).catch(() => undefined);
          } else {
            setConnection("重新连接中");
            queue.current = Promise.resolve();
          }
        }
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 1500);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      }
    }
    connect();
    return () => {
      controller.abort();
    };
  }, [user?.sid, processEvent, restore, message]);
  useEffect(() => {
    loadContext(active).catch((error) => message.error(error.message));
  }, [active, loadContext, message]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [active, histories[active]?.length]);
  async function create() {
    try {
      const page = await api<ChatPage>("/chat/create", { title: "新对话" });
      publishTabs([...tabsRef.current, ...page.conversations]);
      select(page.conversations[0].id);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function send() {
    if (!active || !draft.trim() || sending) return;
    const request =
      pending.current?.conversationId === active &&
      pending.current.text === draft
        ? pending.current
        : {
            conversationId: active,
            text: draft,
            requestKey: crypto.randomUUID(),
          };
    pending.current = request;
    setSending(true);
    try {
      const page = await api<ChatPage>("/chat/submit", request);
      setDraft("");
      pending.current = null;
      setRun(page.run);
      await loadHistory(active, false, epoch.current);
      await loadContext(active);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function removeMessages() {
    const conversation = tabsRef.current.find((tab) => tab.id === active);
    if (!conversation) return;
    try {
      await api("/chat/delete-messages", {
        conversationId: active,
        messageIds: selected,
        expectedVersion: conversation.version,
      });
      setSelected([]);
      await loadHistory(active, true, epoch.current);
      await loadContext(active);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  const messages = histories[active] || [];
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => messages[index].id,
  });
  if (starting)
    return (
      <div className="boot">
        <Spin size="large" />
        <p>正在恢复页面登录</p>
      </div>
    );
  if (!user)
    return (
      <Suspense fallback={<Spin />}>
        <AuthPanel onLogin={setUser} />
      </Suspense>
    );
  const conversation = tabs.find((tab) => tab.id === active);
  const occupied = ["ACCEPTED", "RUNNING"].includes(run?.status || "");
  const percent = Math.min(
    100,
    Math.round(
      ((budget.inputEstimate + budget.outputReserve + budget.safetyReserve) /
        budget.window) *
        100,
    ),
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">↗ Hello Travel</div>
        <span className="sidebar-label">你的旅行工作台</span>
        <button
          className={"nav-item " + (menu === "chat" ? "current" : "")}
          onClick={() => setMenu("chat")}
        >
          <MessageOutlined />
          对话管理
        </button>
        <button
          className={"nav-item " + (menu === "knowledge" ? "current" : "")}
          onClick={() => setMenu("knowledge")}
        >
          <BookOutlined />
          知识库管理
        </button>
        <div className="conversation-heading">
          <span>旅行对话 / {tabs.length}</span>
          <Tooltip title="新增对话">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={create}
            />
          </Tooltip>
        </div>
        <div className="tab-list">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                "tab-row " +
                (menu === "chat" && tab.id === active ? "active" : "")
              }
            >
              <button className="tab-title" onClick={() => select(tab.id)}>
                {tab.title}
              </button>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "rename", label: "重命名" },
                    { key: "delete", label: "删除对话", danger: true },
                  ],
                  onClick: ({ key }) => {
                    if (key === "rename") {
                      setEditing(tab);
                      setTitle(tab.title);
                    } else
                      modal.confirm({
                        title: "删除这个对话及其消息？",
                        content: "相关记忆将失效，其他设备会同步删除。",
                        okText: "删除",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await api("/chat/delete", {
                            conversationId: tab.id,
                            expectedVersion: tab.version,
                          });
                          await loadTabs(epoch.current);
                        },
                      });
                  },
                }}
              >
                <Button type="text" size="small" icon={<MoreOutlined />} />
              </Dropdown>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="avatar">{user.email[0].toUpperCase()}</div>
          <div className="account">
            <strong>{user.email}</strong>
            <small>{connection}</small>
          </div>
          <Tooltip title="退出当前设备">
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={async () => {
                try {
                  await api("/auth/logout", {});
                } finally {
                  clearSession();
                  setUser(null);
                }
              }}
            />
          </Tooltip>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {menu === "chat" ? "TRAVEL CONVERSATION" : "KNOWLEDGE LIBRARY"}
            </span>
            <strong>
              {menu === "chat"
                ? conversation?.title || "开始一段新旅程"
                : "知识库管理"}
            </strong>
          </div>
          <Tag color="green">一期 · 咨询与规划</Tag>
        </header>
        {menu === "knowledge" ? (
          <Suspense fallback={<Spin />}>
            <KnowledgePanel revision={knowledgeRevision} />
          </Suspense>
        ) : (
          <div className="chat-layout">
            <section className="chat-panel">
              <div className="message-list" ref={scroll}>
                {loading && (
                  <div className="restore-note">
                    <Spin size="small" /> 正在恢复全部对话与消息…
                  </div>
                )}
                {!active ? (
                  <div className="welcome">
                    <span className="compass">↗</span>
                    <h1>下一站，想去哪里？</h1>
                    <p>先开一个对话，再告诉我出发地、日期和你期待的旅行。</p>
                    <Button
                      type="primary"
                      size="large"
                      icon={<PlusOutlined />}
                      onClick={create}
                    >
                      开启旅行规划
                    </Button>
                    <div className="sample-cards">
                      <div>
                        景德镇周末
                        <br />
                        <small>瓷器、老街与慢生活</small>
                      </div>
                      <div>
                        亲子轻松游
                        <br />
                        <small>少赶路，多留白</small>
                      </div>
                      <div>
                        出行前核对
                        <br />
                        <small>天气、规则与退改条件</small>
                      </div>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <Empty description="把你的旅行想法发给旅伴" />
                ) : (
                  <div
                    style={{
                      height: virtual.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtual.getVirtualItems().map((row) => {
                      const item = messages[row.index];
                      return (
                        <div
                          key={item.id}
                          data-index={row.index}
                          ref={virtual.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${row.start}px)`,
                            paddingBottom: 24,
                          }}
                        >
                          <article
                            key={item.id}
                            className={"message " + item.role.toLowerCase()}
                          >
                            <div className="message-meta">
                              <strong>
                                {item.role === "USER" ? "你" : "Hello Travel"}
                              </strong>
                              <span>
                                {item.status === "STREAMING"
                                  ? "正在规划…"
                                  : item.status === "FAILED"
                                    ? "生成失败"
                                    : item.status === "INTERRUPTED"
                                      ? "生成已中断"
                                      : ""}
                              </span>
                              <Checkbox
                                checked={selected.includes(item.id)}
                                onChange={(event) =>
                                  setSelected((values) =>
                                    event.target.checked
                                      ? [...values, item.id]
                                      : values.filter((id) => id !== item.id),
                                  )
                                }
                              />
                            </div>
                            <div className="message-content">
                              {item.content ||
                                (item.status === "ACCEPTED"
                                  ? "规划任务已接收…"
                                  : "暂时没有回答内容")}
                            </div>
                            {item.citations && item.citations !== "[]" && (
                              <details>
                                <summary>参考资料</summary>
                                <pre>{item.citations}</pre>
                              </details>
                            )}
                          </article>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div ref={bottom} />
              </div>
              {selected.length > 0 && (
                <div className="selection-toolbar">
                  <span>已选择 {selected.length} 条消息</span>
                  <Button
                    danger
                    size="small"
                    disabled={selected.length > 100}
                    onClick={() =>
                      modal.confirm({
                        title: "删除选中消息？",
                        content: "对话记忆将重新建立。",
                        onOk: removeMessages,
                      })
                    }
                  >
                    删除选中
                  </Button>
                  <Button size="small" onClick={() => setSelected([])}>
                    取消选择
                  </Button>
                </div>
              )}
              <div className="composer-wrap">
                {run &&
                  ["FAILED", "CANCELLED", "INTERRUPTED"].includes(
                    run.status,
                  ) && (
                    <Alert
                      type="warning"
                      message={`本轮任务${run.status === "FAILED" ? "失败" : "已停止"}，原消息和草稿保留。`}
                      action={
                        <Button
                          size="small"
                          onClick={async () => {
                            try {
                              const page = await api<ChatPage>("/chat/retry", {
                                runId: run.id,
                              });
                              setRun(page.run);
                            } catch (error) {
                              message.error((error as Error).message);
                            }
                          }}
                        >
                          重试本轮
                        </Button>
                      }
                    />
                  )}
                <div className="composer">
                  <Input.TextArea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="例如：从杭州出发，周末去景德镇，两个人，预算2000元…"
                    autoSize={{ minRows: 2, maxRows: 7 }}
                    maxLength={8000}
                    disabled={!active}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        event.keyCode !== 229
                      ) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <span>Enter 发送 · Shift + Enter 换行</span>
                    {occupied ? (
                      <Button
                        onClick={async () => {
                          try {
                            const page = await api<ChatPage>("/chat/cancel", {
                              runId: run!.id,
                            });
                            setRun(page.run);
                          } catch (error) {
                            message.error((error as Error).message);
                          }
                        }}
                      >
                        停止生成
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        loading={sending}
                        disabled={!active || !draft.trim()}
                        onClick={send}
                      >
                        发送
                      </Button>
                    )}
                  </div>
                </div>
                <p className="composer-tip">
                  建议供规划参考。票价、营业时间与退改政策请在预订前核实官方信息。
                </p>
              </div>
            </section>
            <aside className="context-panel">
              <div className="eyebrow">CONTEXT / 会话上下文</div>
              <h3>记忆与使用情况</h3>
              <Progress
                type="circle"
                percent={percent}
                size={116}
                strokeColor="#236451"
              />
              <p>保守预算占比 · 含输出与安全预留</p>
              <div className="budget-line">
                <span>输入估算</span>
                <strong>{budget.inputEstimate.toLocaleString()}</strong>
              </div>
              <div className="budget-line">
                <span>输出预留</span>
                <strong>{budget.outputReserve.toLocaleString()}</strong>
              </div>
              <div className="budget-line">
                <span>安全预留</span>
                <strong>{budget.safetyReserve.toLocaleString()}</strong>
              </div>
              <div className="budget-line">
                <span>应用上下文上限</span>
                <strong>{budget.window.toLocaleString()}</strong>
              </div>
              <Tag>
                {budget.compression === "RUNNING"
                  ? "正在压缩记忆"
                  : budget.compression === "COMPLETED"
                    ? "摘要压缩完成"
                    : "正常使用"}
              </Tag>
              {budget.actualInputTokens !== undefined && (
                <div className="budget-line">
                  <span>本次回答实际输入</span>
                  <strong>{budget.actualInputTokens.toLocaleString()}</strong>
                </div>
              )}
              {budget.actualOutputTokens !== undefined && (
                <div className="budget-line">
                  <span>本次回答实际输出</span>
                  <strong>{budget.actualOutputTokens.toLocaleString()}</strong>
                </div>
              )}
              <p className="context-explainer">
                这是保守估算，不是供应商的实际 token
                计费量。完整历史由服务端保存，模型使用本对话的近期消息、摘要和明确记忆。
              </p>
              <div className="context-note">
                <strong>需要记住旅行偏好？</strong>
                <p>
                  可以说“请记住：我不喜欢紧凑行程”。记忆按账号与对话隔离，删除消息会使相关旧记忆失效。
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
      <Modal
        open={!!editing}
        title="重命名对话"
        okText="保存"
        onCancel={() => setEditing(null)}
        onOk={async () => {
          if (!editing || !title.trim()) return;
          try {
            await api("/chat/rename", {
              conversationId: editing.id,
              title: title.trim(),
              expectedVersion: editing.version,
            });
            setEditing(null);
            await loadTabs(epoch.current);
          } catch (error) {
            message.error((error as Error).message);
          }
        }}
      >
        <Input
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Modal>
    </div>
  );
}

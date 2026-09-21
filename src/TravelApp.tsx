import { ContextBudget } from "./contextBudget";
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
  CopyOutlined,
  DeleteOutlined,
  BookOutlined,
  MessageOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, ApiError, clearSession, recoverSession, stream } from "./api";
import { MessageHistory } from "./messageHistory";
const AuthPanel = lazy(() =>
  import("./AuthPanel").then((module) => ({ default: module.AuthPanel })),
);
const KnowledgePanel = lazy(() =>
  import("./KnowledgePanel").then((module) => ({
    default: module.KnowledgePanel,
  })),
);
import type {
  ChatPage,
  Conversation,
  Message,
  Run,
  Session,
  SyncEvent,
  SyncPage,
} from "./types";
const big = (value: string) => BigInt(value || "0");
export function TravelApp() {
  // 1. 固定{ message, modal }对应的本次操作状态，避免异步处理跨越页面生命周期。
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
  const [budget, setBudget] = useState<ContextBudget>(ContextBudget.empty());
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
  // 2. 定义对话切换行为，当前选择与发送目标使用同一标识。
  function select(id: string) {
    // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
    activeRef.current = id;
    // 2. 发布当前对话标识，后续恢复与发送绑定该对话。
    setActive(id);
    // 3. 更新当前选择项，操作对象与页面选择保持一致。
    setSelected([]);
    // 4. 切换侧栏功能，加载对应的聊天或知识界面。
    setMenu("chat");
  }
  // 3. 定义对话列表发布行为，统一处理去重与页面状态。
  function publishTabs(values: Conversation[]) {
    // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
    values = [...new Map(values.map((value) => [value.id, value])).values()];
    // 2. 发布当前状态或连接结果，后续页面操作使用最新快照。
    tabsRef.current = values;
    // 3. 发布服务端对话列表，界面与持久化结果保持同步。
    setTabs(values);
    // 4. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (!values.some((tab) => tab.id === activeRef.current))
      select(values[0]?.id || "");
  }
  // 4. 固定loadHistory对应的本次操作状态，避免异步处理跨越页面生命周期。
  const loadHistory = useCallback(
    async (id: string, full: boolean, generation: number) => {
      // 1. 逐页或逐项推进恢复，核对游标、停止与取消条件。
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
          // 1. 逐页或逐项推进恢复，核对游标、停止与取消条件。
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
          // 2. 核对登录恢复代次，丢弃旧页面或重复事件。
          if (epoch.current !== generation) return;
          // 历史对象统一处理全量替换、迟到版本和稳定排序。
          // 3. 取得按稳定序号合并的消息快照供界面发布。
          const values = MessageHistory.merge(cached, rows, full).snapshot();
          // 4. 发布当前状态或连接结果，后续页面操作使用最新快照。
          historiesRef.current = { ...historiesRef.current, [id]: values };
          // 5. 发布当前按对话隔离的消息历史，版本合并由历史对象完成。
          setHistories(historiesRef.current);
          // 6. 处理当前前置条件或恢复分支，失效状态不继续执行。
          if (conversation) {
            const next = tabsRef.current.map((tab) =>
              tab.id === id ? conversation! : tab,
            );
            tabsRef.current = next;
            setTabs(next);
          }
          // 7. 交付本段结果或清理函数，由调用方承接后续生命周期。
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
      // 2. 重载时版本持续变化则明确失败，避免展示混合代次历史。
      throw new Error("消息正在被修改，请稍后重新加载");
    },
    [],
  );
  const loadTabs = useCallback(async (generation: number, maxSeq?: string) => {
    // 1. 建立恢复游标，按服务端快照上界推进分页。
    let after = "0";
    const all: Conversation[] = [];
    // 2. 逐页或逐项推进恢复，核对游标、停止与取消条件。
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
    // 3. 核对登录恢复代次，丢弃旧页面或重复事件。
    if (epoch.current === generation) publishTabs(all);
    // 4. 交付本段结果或清理函数，由调用方承接后续生命周期。
    return all;
  }, []);
  const restore = useCallback(
    async (generation: number) => {
      // 1. 更新恢复状态，让界面展示当前加载进度。
      setLoading(true);
      // 2. 在失败反馈与资源清理边界内完成当前操作。
      try {
        // 1. 先读取恢复高水位，再完整加载会话及各自历史。
        const manifest = await api<ChatPage>("/chat/bootstrap", {});
        const all = await loadTabs(generation, manifest.maxSeq);
        // 2. 逐页或逐项推进恢复，核对游标、停止与取消条件。
        for (const tab of all) await loadHistory(tab.id, true, generation);
        // 3. 核对登录恢复代次，丢弃旧页面或重复事件。
        if (epoch.current === generation) cursor.current = manifest.syncSeq;
      } finally {
        if (epoch.current === generation) setLoading(false);
      }
    },
    [loadTabs, loadHistory],
  );
  const loadContext = useCallback(async (id: string) => {
    // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (!id) {
      setBudget(ContextBudget.empty());
      setRun(undefined);
      return;
    }
    // 2. 拉取当前接口数据窗口，分页游标必须可推进。
    const page = await api<ChatPage>("/chat/context", { conversationId: id });
    // 3. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (activeRef.current === id) {
      setBudget(ContextBudget.fromServer(page.context));
      setRun(page.run);
    }
  }, []);
  const processEvent = useCallback(
    async (event: SyncEvent, generation: number) => {
      // 1. 核对登录恢复代次，丢弃旧页面或重复事件。
      if (epoch.current !== generation || big(event.seq) <= big(cursor.current))
        return;
      // 2. 仅结束事件目标SID的旧页面，其他设备继续保持登录。
      if (
        event.targetSid === user?.sid &&
        ["session.replaced", "session.revoked"].includes(event.type)
      ) {
        clearSession();
        setUser(null);
        message.warning("当前页面登录已结束，请重新登录");
        return;
      }
      // 3. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (event.type.startsWith("knowledge."))
        setKnowledgeRevision((value) => value + 1);
      // 4. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (event.type.startsWith("conversation.")) await loadTabs(generation);
      // 5. 固定tab对应的本次操作状态，避免异步处理跨越页面生命周期。
      const tab = tabsRef.current.find((item) => item.id === event.id);
      // 6. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (
        tab &&
        (event.type.startsWith("message") || event.type === "run.retried")
      )
        await loadHistory(tab.id, event.type.includes("deleted"), generation);
      // 7. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (event.type.startsWith("context.") || event.type.startsWith("run.")) {
        const page = await api<ChatPage>("/chat/run", { runId: event.id });
        if (page.run)
          await loadHistory(page.run.conversationId, false, generation);
      }
      // 8. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (
        activeRef.current &&
        (event.type.startsWith("context.") ||
          event.type.startsWith("run.") ||
          event.type.startsWith("message"))
      )
        await loadContext(activeRef.current);
      // 9. 核对登录恢复代次，丢弃旧页面或重复事件。
      if (epoch.current === generation) cursor.current = event.seq;
    },
    [user?.sid, loadTabs, loadHistory, loadContext, message],
  );
  // 5. 管理当前组件的事件监听，生命周期结束及时解除。
  useEffect(() => {
    // 1. 记录组件生命周期，卸载后不回写登录态。
    let alive = true;
    // 2. 更新当前页面认证视图，凭据恢复与界面生命周期一致。
    recoverSession().then((value) => {
      if (alive) {
        setUser(value);
        setStarting(false);
      }
    });
    // 3. 固定ended对应的本次操作状态，避免异步处理跨越页面生命周期。
    const ended = () => {
      // 1. 更新当前页面认证视图，凭据恢复与界面生命周期一致。
      setUser(null);
      // 2. 提示当前业务前置条件或认证状态，避免无效提交。
      message.warning("登录已失效，请重新登录");
    };
    // 4. 管理当前组件的事件监听，生命周期结束及时解除。
    window.addEventListener("ht-session-ended", ended);
    // 5. 交付本段结果或清理函数，由调用方承接后续生命周期。
    return () => {
      // 1. 标记本页面已退出，异步恢复结果不能写回卸载的界面。
      alive = false;
      // 2. 管理当前组件的事件监听，生命周期结束及时解除。
      window.removeEventListener("ht-session-ended", ended);
    };
  }, [message]);
  // 6. 串行消费同步事件，保持同用户事件提交顺序。
  useEffect(() => {
    // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (!user) {
      epoch.current++;
      historiesRef.current = {};
      setHistories({});
      publishTabs([]);
      return;
    }
    // 2. 固定恢复代次，旧异步结果不能更新新登录界面。
    const generation = ++epoch.current;
    const controller = new AbortController();
    // 3. 串行消费同步事件，保持同用户事件提交顺序。
    queue.current = Promise.resolve();
    // 4. 固定receive对应的本次操作状态，避免异步处理跨越页面生命周期。
    const receive = (event: SyncEvent) => {
      queue.current = queue.current.then(() => processEvent(event, generation));
    };
    // 5. 串行消费同步事件，保持同用户事件提交顺序。
    async function connect() {
      // 1. 在失败反馈与资源清理边界内完成当前操作。
      try {
        await restore(generation);
      } catch (error) {
        message.error((error as Error).message);
      }
      // 2. 逐页或逐项推进恢复，核对游标、停止与取消条件。
      while (!controller.signal.aborted && epoch.current === generation) {
        try {
          // 1. 固定more: boolean对应的本次操作状态，避免异步处理跨越页面生命周期。
          let more: boolean;
          // 2. 逐页或逐项推进恢复，核对游标、停止与取消条件。
          do {
            const page = await api<SyncPage>("/sync?after=" + cursor.current);
            for (const event of page.items) receive(event);
            await queue.current;
            more = page.hasMore;
          } while (more && !controller.signal.aborted);
          // 3. 更新同步连接状态，断流恢复期间明确展示状态。
          setConnection("已同步");
          // 4. 从持久事件游标建立消息流，收到事件后再推进恢复位置。
          await stream(cursor.current, controller.signal, receive);
          // 5. 串行消费同步事件，保持同用户事件提交顺序。
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
            // 1. 固定timer对应的本次操作状态，避免异步处理跨越页面生命周期。
            const timer = window.setTimeout(resolve, 1500);
            // 2. 管理当前组件的事件监听，生命周期结束及时解除。
            controller.signal.addEventListener(
              "abort",
              () => {
                // 1. 清理重连计时器，页面退出后不保留恢复任务。
                clearTimeout(timer);
                // 2. 结束当前可取消的等待，使连接生命周期继续或退出。
                resolve();
              },
              { once: true },
            );
          });
      }
    }
    // 6. 启动当前页面代次的连接恢复，旧页面代次不得写回状态。
    connect();
    // 7. 交付本段结果或清理函数，由调用方承接后续生命周期。
    return () => {
      controller.abort();
    };
  }, [user?.sid, processEvent, restore, message]);
  // 7. 刷新当前对话的上下文占比与任务进度。
  useEffect(() => {
    loadContext(active).catch((error) => message.error(error.message));
  }, [active, loadContext, message]);
  // 8. 绑定页面连接与数据恢复的生命周期，卸载时执行清理。
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [active, histories[active]?.length]);
  // 9. 定义新建对话流程，提交后读取服务端确定的对话快照。
  async function create() {
    try {
      // 1. 拉取当前接口数据窗口，分页游标必须可推进。
      const page = await api<ChatPage>("/chat/create", { title: "新对话" });
      // 2. 合并并发布最新对话快照，稳定标识相同的记录只保留一份。
      publishTabs([...tabsRef.current, ...page.conversations]);
      // 3. 切换到新建对话，并清理上个对话的局部选择。
      select(page.conversations[0].id);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  // 10. 重读受影响会话的消息快照，推送不作为唯一正文来源。
  async function send() {
    // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (!active || !draft.trim() || sending) return;
    // 2. 固定消息幂等键与正文，网络失败重试复用同一请求。
    const request =
      pending.current?.conversationId === active &&
      pending.current.text === draft
        ? pending.current
        : {
            conversationId: active,
            text: draft,
            requestKey: crypto.randomUUID(),
          };
    // 3. 保留或清除本次幂等请求，避免网络重试创建重复用户消息。
    pending.current = request;
    // 4. 切换发送中状态，避免重复提交并在结束后恢复。
    setSending(true);
    // 5. 在失败反馈与资源清理边界内完成当前操作。
    try {
      // 1. 拉取当前接口数据窗口，分页游标必须可推进。
      const page = await api<ChatPage>("/chat/submit", request);
      // 2. 更新输入草稿，已提交文本不重复留在输入框。
      setDraft("");
      // 3. 保留或清除本次幂等请求，避免网络重试创建重复用户消息。
      pending.current = null;
      // 4. 保存本轮生成任务状态，重试与取消绑定同一任务。
      setRun(page.run);
      // 5. 重读受影响会话的消息快照，推送不作为唯一正文来源。
      await loadHistory(active, false, epoch.current);
      // 6. 刷新当前对话的上下文占比与任务进度。
      await loadContext(active);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  // 11. 重读受影响会话的消息快照，推送不作为唯一正文来源。
  async function removeMessages() {
    // 1. 固定conversation对应的本次操作状态，避免异步处理跨越页面生命周期。
    const conversation = tabsRef.current.find((tab) => tab.id === active);
    // 2. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (!conversation) return;
    // 3. 在失败反馈与资源清理边界内完成当前操作。
    try {
      // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
      await api("/chat/delete-messages", {
        conversationId: active,
        messageIds: selected,
        expectedVersion: conversation.version,
      });
      // 2. 更新当前选择项，操作对象与页面选择保持一致。
      setSelected([]);
      // 3. 重读受影响会话的消息快照，推送不作为唯一正文来源。
      await loadHistory(active, true, epoch.current);
      // 4. 刷新当前对话的上下文占比与任务进度。
      await loadContext(active);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  // 12. 复制单条消息正文，失败时只反馈本地剪贴板能力问题。
  async function copyMessage(content: string) {
    // 1. 空的流式占位不提供无意义复制，避免把等待状态当作回答正文。
    if (!content) return;
    // 2. 在受浏览器权限保护的剪贴板边界内完成复制并反馈结果。
    try {
      await navigator.clipboard.writeText(content);
      message.success("已复制");
    } catch {
      message.error("复制失败，请检查浏览器剪贴板权限");
    }
  }
  // 13. 删除入口默认选择同轮问答，选择态仍允许用户保留单条删除。
  function selectMessagePair(messageIndex: number) {
    // 1. 取得当前消息及相邻的问答消息；同一提交在历史中按用户、助手顺序持久化。
    const current = messages[messageIndex];
    const related =
      current?.role === "USER"
        ? messages[messageIndex + 1]
        : messages[messageIndex - 1];
    // 2. 仅将相邻的反向角色纳入默认选择，避免跨轮次误选。
    const ids = [current, related]
      .filter(
        (item): item is Message =>
          Boolean(item) && (item === current || item.role !== current.role),
      )
      .map((item) => item.id);
    // 3. 发布默认选择；随后由各消息复选框支持逐条取消或增加。
    setSelected([...new Set(ids)]);
  }
  // 14. 渲染消息操作，用户消息按悬停显示，助手回答始终展示在正文下方。
  function renderMessageActions(item: Message, messageIndex: number) {
    return (
      <div
        className={
          "message-actions " + (item.role === "USER" ? "on-hover" : "")
        }
      >
        <Tooltip title="复制">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            aria-label="复制消息"
            disabled={!item.content}
            onClick={() => copyMessage(item.content)}
          />
        </Tooltip>
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label="选择删除消息"
            onClick={() => selectMessagePair(messageIndex)}
          />
        </Tooltip>
      </div>
    );
  }
  // 15. 固定messages对应的本次操作状态，避免异步处理跨越页面生命周期。
  const messages = histories[active] || [];
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => messages[index].id,
  });
  // 13. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (starting)
    return (
      <div className="boot">
        <Spin size="large" />
        <p>正在恢复页面登录</p>
      </div>
    );
  // 14. 处理当前前置条件或恢复分支，失效状态不继续执行。
  if (!user)
    return (
      <Suspense fallback={<Spin />}>
        <AuthPanel onLogin={setUser} />
      </Suspense>
    );
  // 15. 固定conversation对应的本次操作状态，避免异步处理跨越页面生命周期。
  const conversation = tabs.find((tab) => tab.id === active);
  const occupied = ["ACCEPTED", "RUNNING"].includes(run?.status || "");
  const percent = budget.percentage();
  // 16. 渲染当前对话与同步状态，消息版本决策由历史对象负责。
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
                          // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
                          await api("/chat/delete", {
                            conversationId: tab.id,
                            expectedVersion: tab.version,
                          });
                          // 2. 重新读取完整对话列表，反映服务端实际变更。
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
                      开始对话
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
                      // 1. 固定item对应的本次操作状态，避免异步处理跨越页面生命周期。
                      const item = messages[row.index];
                      // 2. 选择态显示复选框，正常阅读时不暴露批量管理控件。
                      const selecting = selected.length > 0;
                      const hasStatus =
                        item.status === "ACCEPTED"
                        || item.status === "STREAMING"
                        || item.status === "FAILED"
                        || item.status === "INTERRUPTED";
                      // 2. 渲染当前对话与同步状态，消息版本决策由历史对象负责。
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
                            {hasStatus && (
                              <div className="message-meta">
                                <span>
                                  {item.status === "ACCEPTED"
                                          || item.status === "STREAMING"
                                    ? "正在回答"
                                    : item.status === "FAILED"
                                      ? "生成失败"
                                      : "生成已中断"}
                                </span>
                              </div>
                            )}
                            {selecting && (
                              <Checkbox
                                className="message-select"
                                checked={selected.includes(item.id)}
                                aria-label="选择消息"
                                onChange={(event) =>
                                  setSelected((values) =>
                                    event.target.checked
                                      ? [...values, item.id]
                                      : values.filter((id) => id !== item.id),
                                  )
                                }
                              />
                            )}
                            <div className="message-content">
                              {item.content ||
                                (item.status === "ACCEPTED"
                                        || item.status === "STREAMING"
                                  ? <span className="thinking-indicator" role="status" aria-live="polite">
                                      正在准备回答
                                      <span className="thinking-dots" aria-hidden="true">
                                        <i>·</i><i>·</i><i>·</i>
                                      </span>
                                    </span>
                                  : item.status === "FAILED"
                                    ? "本轮回答生成失败，请使用下方按钮重试。"
                                    : "暂无回答内容")}
                            </div>
                            {item.citations && item.citations !== "[]" && (
                              <details>
                                <summary>参考资料</summary>
                                <pre>{item.citations}</pre>
                              </details>
                            )}
                            {renderMessageActions(item, row.index)}
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
                  <span>已选择 {selected.length} 条消息，可单独取消勾选</span>
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
                              // 1. 拉取当前接口数据窗口，分页游标必须可推进。
                              const page = await api<ChatPage>("/chat/retry", {
                                runId: run.id,
                              });
                              // 2. 保存本轮生成任务状态，重试与取消绑定同一任务。
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
                    placeholder="例如：杭州今天的天气如何？或帮我安排周末景德镇两日游…"
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
                            // 1. 拉取当前接口数据窗口，分页游标必须可推进。
                            const page = await api<ChatPage>("/chat/cancel", {
                              runId: run!.id,
                            });
                            // 2. 保存本轮生成任务状态，重试与取消绑定同一任务。
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
                percent={percent ?? 0}
                format={() => (percent === null ? "—" : `${percent}%`)}
                size={116}
                strokeColor="#236451"
              />
              <p>保守预算占比 · 含输出与安全预留</p>
              <div className="budget-line">
                <span>输入估算</span>
                <strong>{budget.display("inputEstimate")}</strong>
              </div>
              <div className="budget-line">
                <span>输出预留</span>
                <strong>{budget.display("outputReserve")}</strong>
              </div>
              <div className="budget-line">
                <span>安全预留</span>
                <strong>{budget.display("safetyReserve")}</strong>
              </div>
              <div className="budget-line">
                <span>应用上下文上限</span>
                <strong>{budget.display("window")}</strong>
              </div>
              <Tag>{budget.compressionLabel()}</Tag>
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
          // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
          if (!editing || !title.trim()) return;
          // 2. 在失败反馈与资源清理边界内完成当前操作。
          try {
            // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
            await api("/chat/rename", {
              conversationId: editing.id,
              title: title.trim(),
              expectedVersion: editing.version,
            });
            // 2. 关闭已完成的编辑状态，后续刷新持久化标题。
            setEditing(null);
            // 3. 重新读取完整对话列表，反映服务端实际变更。
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

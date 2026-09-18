import { useCallback, useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Space,
  Tag,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { api } from "./api";
import type { Document, KnowledgePage } from "./types";
export function KnowledgePanel({ revision }: { revision: number }) {
  // 1. 固定[documents, setDocuments]对应的本次操作状态，避免异步处理跨越页面生命周期。
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState<Document | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const reload = useCallback(async () => {
    // 1. 固定cursor对应的本次操作状态，避免异步处理跨越页面生命周期。
    let cursor = "0";
    const items: Document[] = [];
    // 2. 逐页或逐项推进恢复，核对游标、停止与取消条件。
    do {
      const page = await api<KnowledgePage>("/knowledge/list", {
        after: cursor,
        limit: 100,
      });
      items.push(...page.items);
      if (!page.hasMore) break;
      if (page.nextCursor === cursor) throw new Error("资料分页未推进");
      cursor = page.nextCursor;
    } while (true);
    // 3. 发布完整文档列表，状态来自服务端持久化快照。
    setDocuments(items);
  }, []);
  // 2. 绑定页面连接与数据恢复的生命周期，卸载时执行清理。
  useEffect(() => {
    reload().catch((error) => message.error(error.message));
  }, [revision, reload, message]);
  // 3. 定义知识状态变更流程，显式提交文档版本并刷新服务端结果。
  async function mutate(document: Document, action: string) {
    try {
      // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
      await api("/knowledge/" + action, {
        documentId: document.id,
        expectedVersion: document.version,
      });
      // 2. 重新读取服务端文档状态，不以本地修改猜测索引结果。
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  }
  // 4. 渲染文档列表、上传入口与明文预览，索引状态以服务端结果为准。
  return (
    <section className="knowledge-page">
      <div className="eyebrow">KNOWLEDGE / 私有旅行资料</div>
      <h1>让每一条建议都有出处</h1>
      <p className="muted">
        上传景区规则、酒店说明或退改政策。资料只用于当前账号的对话，原文与处理状态可随时查看。
      </p>
      <Alert
        type="info"
        showIcon
        message="来源链接用于引用，不代表已经独立核验。政策可能变化，出行和售后处理前请联系官方。"
      />
      <Input
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="可选：资料原文的 HTTPS 来源链接"
        className="source-input"
      />
      <Upload.Dragger
        accept=".txt,.md,.pdf"
        multiple={false}
        showUploadList={false}
        disabled={busy}
        beforeUpload={async (file) => {
          // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
          if (file.size > 10 * 1024 * 1024) {
            message.error("文件不能超过10MB");
            return Upload.LIST_IGNORE;
          }
          // 2. 更新提交状态，避免按钮重复触发当前操作。
          setBusy(true);
          // 3. 固定data对应的本次操作状态，避免异步处理跨越页面生命周期。
          const data = new FormData();
          // 4. 发布当前状态或连接结果，后续页面操作使用最新快照。
          data.append("file", file);
          // 5. 处理当前前置条件或恢复分支，失效状态不继续执行。
          if (source.trim()) data.append("sourceUrl", source.trim());
          // 6. 在失败反馈与资源清理边界内完成当前操作。
          try {
            // 1. 发布当前状态或连接结果，后续页面操作使用最新快照。
            await api("/knowledge/upload", data);
            // 2. 显示服务端已接受操作的反馈，后台任务结果由后续查询确认。
            message.success("资料已接收，正在建立索引");
            // 3. 重新读取服务端文档状态，不以本地修改猜测索引结果。
            await reload();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
          } finally {
            setBusy(false);
          }
          // 7. 交付本段结果或清理函数，由调用方承接后续生命周期。
          return Upload.LIST_IGNORE;
        }}
      >
        <UploadOutlined style={{ fontSize: 32 }} />
        <h3>{busy ? "正在上传…" : "点击选择，或拖放旅行资料"}</h3>
        <p>TXT / Markdown / PDF · 最多10MB · PDF最多50页</p>
      </Upload.Dragger>
      <List
        className="document-list"
        dataSource={documents}
        locale={{ emptyText: <Empty description="还没有旅行资料" /> }}
        renderItem={(document) => (
          <List.Item
            actions={[
              <Button
                key="read"
                type="link"
                onClick={async () => {
                  try {
                    // 1. 拉取当前接口数据窗口，分页游标必须可推进。
                    const page = await api<KnowledgePage>("/knowledge/read", {
                      documentId: document.id,
                    });
                    // 2. 更新当前选择项，操作对象与页面选择保持一致。
                    setSelected(page.items[0]);
                  } catch (error) {
                    message.error((error as Error).message);
                  }
                }}
              >
                查看明文
              </Button>,
              document.status === "FAILED" ? (
                <Button
                  key="retry"
                  type="link"
                  onClick={() => mutate(document, "retry")}
                >
                  重新索引
                </Button>
              ) : null,
              <Popconfirm
                key="delete"
                title="删除资料并移除检索索引？"
                onConfirm={() => mutate(document, "delete")}
              >
                <Button type="text" danger>
                  删除
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  {document.title}
                  <Tag>{document.status}</Tag>
                </Space>
              }
              description={
                <>
                  <div>
                    {document.error
                      ? `处理失败：${document.error}`
                      : document.sourceUrl || "用户上传资料"}
                  </div>
                  <div>{document.text || "尚无提取明文"}</div>
                </>
              }
            />
          </List.Item>
        )}
      />
      <Drawer
        open={!!selected}
        title={selected?.title}
        width={680}
        onClose={() => setSelected(null)}
      >
        <pre className="document-text">
          {selected?.text || "尚无可展示的提取明文"}
        </pre>
      </Drawer>
    </section>
  );
}

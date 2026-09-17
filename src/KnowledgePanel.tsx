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
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState<Document | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const reload = useCallback(async () => {
    let cursor = "0";
    const items: Document[] = [];
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
    setDocuments(items);
  }, []);
  useEffect(() => {
    reload().catch((error) => message.error(error.message));
  }, [revision, reload, message]);
  async function mutate(document: Document, action: string) {
    try {
      await api("/knowledge/" + action, {
        documentId: document.id,
        expectedVersion: document.version,
      });
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  }
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
          if (file.size > 10 * 1024 * 1024) {
            message.error("文件不能超过10MB");
            return Upload.LIST_IGNORE;
          }
          setBusy(true);
          const data = new FormData();
          data.append("file", file);
          if (source.trim()) data.append("sourceUrl", source.trim());
          try {
            await api("/knowledge/upload", data);
            message.success("资料已接收，正在建立索引");
            await reload();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
          } finally {
            setBusy(false);
          }
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
                    const page = await api<KnowledgePage>("/knowledge/read", {
                      documentId: document.id,
                    });
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

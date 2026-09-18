import { useState } from "react";
import { Alert, Button, Form, Input, Segmented, Typography, App } from "antd";
import { api, adoptSession } from "./api";
import type { Session } from "./types";
export function AuthPanel({
  onLogin,
}: {
  onLogin: (session: Session) => void;
}) {
  // 1. 固定[mode, setMode]对应的本次操作状态，避免异步处理跨越页面生命周期。
  const [mode, setMode] = useState("登录");
  const [otpLogin, setOtpLogin] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const purpose =
    mode === "注册"
      ? "REGISTER"
      : mode === "重置密码"
        ? "RESET_PASSWORD"
        : "LOGIN";
  const needsCode = mode !== "登录" || otpLogin;
  // 2. 校验邮箱字段后才申请证明，避免无效投递请求。
  async function issue() {
    try {
      // 1. 校验邮箱字段后才申请证明，避免无效投递请求。
      await form.validateFields(["email"]);
      // 2. 更新提交状态，避免按钮重复触发当前操作。
      setBusy(true);
      // 3. 固定result对应的本次操作状态，避免异步处理跨越页面生命周期。
      const result = await api<{ challengeId: string }>("/auth/challenge", {
        email: form.getFieldValue("email"),
        purpose,
      });
      // 4. 更新当前用途的邮箱证明标识，旧用途证明不能复用。
      setChallenge(result.challengeId);
      // 5. 显示服务端已接受操作的反馈，后台任务结果由后续查询确认。
      message.success("验证码已进入邮件投递流程，请查看邮箱");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }
  // 3. 定义认证提交流程，区分登录、注册与密码重置后的页面状态。
  async function submit(value: {
    email: string;
    password?: string;
    code?: string;
  }) {
    // 1. 处理当前前置条件或恢复分支，失效状态不继续执行。
    if (needsCode && !challenge) {
      message.warning("请先获取邮箱验证码");
      return;
    }
    // 2. 更新提交状态，避免按钮重复触发当前操作。
    setBusy(true);
    // 3. 在失败反馈与资源清理边界内完成当前操作。
    try {
      // 1. 固定path对应的本次操作状态，避免异步处理跨越页面生命周期。
      const path =
        mode === "注册" ? "register" : mode === "重置密码" ? "reset" : "login";
      const result = await api<Session>("/auth/" + path, {
        ...value,
        password: mode === "登录" && otpLogin ? undefined : value.password,
        challengeId: challenge,
        purpose,
      });
      // 2. 处理当前前置条件或恢复分支，失效状态不继续执行。
      if (mode === "登录") {
        adoptSession(result);
        onLogin(result);
      } else {
        message.success(
          mode === "注册" ? "注册成功，请登录" : "密码已重置，请重新登录",
        );
        setMode("登录");
        setChallenge("");
        form.resetFields(["password", "code"]);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  // 4. 渲染当前认证状态与表单，提交行为由认证流程负责。
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand large">↗ Hello Travel</div>
        <span className="eyebrow">一期 · 旅行咨询与规划</span>
        <h1>
          从一句想去哪里，
          <br />
          到一段值得出发的旅程。
        </h1>
        <p>
          把目的地、时间和预算交给旅伴。一起梳理路线、出行优先级与需要核实的事项。
        </p>
        <div className="story-note">景德镇 / 在瓷与山水之间，慢一点</div>
      </section>
      <section className="auth-card">
        <Typography.Title level={3}>开启你的旅行对话</Typography.Title>
        <Segmented
          block
          options={["登录", "注册", "重置密码"]}
          value={mode}
          onChange={(value) => {
            // 1. 切换认证操作模式，后续请求使用对应接口。
            setMode(String(value));
            // 2. 更新当前用途的邮箱证明标识，旧用途证明不能复用。
            setChallenge("");
          }}
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          requiredMark={false}
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, type: "email", message: "请输入有效邮箱" },
            ]}
          >
            <Input autoComplete="email" placeholder="you@example.com" />
          </Form.Item>
          {mode === "登录" && (
            <Segmented
              options={["密码登录", "验证码登录"]}
              value={otpLogin ? "验证码登录" : "密码登录"}
              onChange={(value) => {
                // 1. 切换验证码登录方式，与密码登录使用不同证明。
                setOtpLogin(value === "验证码登录");
                // 2. 更新当前用途的邮箱证明标识，旧用途证明不能复用。
                setChallenge("");
              }}
            />
          )}
          {(!otpLogin || mode !== "登录") && (
            <Form.Item
              name="password"
              label={mode === "重置密码" ? "新密码" : "密码"}
              rules={[
                {
                  required: true,
                  min: 12,
                  max: 128,
                  message: "密码需为12至128个字符",
                },
              ]}
            >
              <Input.Password
                autoComplete={
                  mode === "登录" ? "current-password" : "new-password"
                }
              />
            </Form.Item>
          )}
          {needsCode && (
            <Form.Item
              name="code"
              label="邮箱验证码"
              rules={[
                {
                  required: true,
                  pattern: /^\d{6}$/,
                  message: "请输入6位验证码",
                },
              ]}
            >
              <Input
                maxLength={6}
                addonAfter={
                  <Button
                    type="text"
                    size="small"
                    onClick={issue}
                    loading={busy}
                  >
                    获取验证码
                  </Button>
                }
              />
            </Form.Item>
          )}
          <Button
            block
            size="large"
            type="primary"
            htmlType="submit"
            loading={busy}
          >
            {mode}
          </Button>
        </Form>
        <Alert
          type="info"
          showIcon
          message="同一浏览器重新登录会结束旧页面的登录；其他设备可继续使用。"
        />
      </section>
    </main>
  );
}

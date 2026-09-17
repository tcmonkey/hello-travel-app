import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { TravelApp } from "./TravelApp";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#236451",
          borderRadius: 12,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
          colorBgLayout: "#f6f7f3",
          colorText: "#253a33",
        },
      }}
    >
      <AntApp>
        <TravelApp />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);

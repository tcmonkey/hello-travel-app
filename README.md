# Hello Travel App

独立Node24/React/Ant Design前端项目，与同级hello-travel Java服务端分别构建和运行。

```sh
npm ci --no-fund --no-audit
npm run dev
npm run build
```

开发地址http://127.0.0.1:5173，/api代理到http://127.0.0.1:8080。后端配置和运行见[hello-travel](../hello-travel/README.md)。百炼、高德、数据库与SMTP密钥只放服务端，不能配置为VITE_变量暴露给浏览器。AI交付文档由后端AI/output统一维护，不在应用根生成docs/database目录。

# FlowPacket

~~比较在意审美的的~~游戏服务器可视化调试工具。

## 解决什么问题

游戏服务器测试中，协议交互往往是多步骤、有序、有状态的，传统的单次请求工具（如 Postman）无法高效处理这类场景。

开发者不得不反复编写一次性的测试客户端代码来验证服务端逻辑。

## 预览

<video src="preview.mp4" controls width="100%"></video>

## 快速开始

安装包正在努力构建的路上 (･ㅂ･)

## 从源码构建

```bash
# 前置依赖：Node.js 18+, Go 1.21+

# 安装前端依赖
cd apps/renderer && npm install

# 开发模式
npm run dev

# 运行后端
cd apps/server/cmd/flow-packet/main.go
```

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React + TypeScript + Tailwind CSS + Zustand |
| 画布 | React Flow |
| 桌面 | Electron |
| 后端 | Go（TCP/WebSocket 客户端、Protobuf 动态编解码） |
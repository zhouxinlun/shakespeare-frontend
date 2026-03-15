# Shakespeare Frontend

AI 短剧生成平台前端 —— 状态机驱动的创作流水线界面。

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 + TypeScript | UI 框架 |
| Vite | 构建工具 |
| Tailwind CSS v3 + shadcn/ui 风格 | 样式系统（暗色主题） |
| Zustand | 客户端状态管理（pipeline 实时状态） |
| TanStack Query v5 | 服务端状态管理 |
| TanStack Router | 类型安全路由 |
| SSE（EventSource） | 实时进度接收 |
| Axios | HTTP 客户端 |

## 快速开始

```bash
# 安装依赖
npm install   # 或 yarn / pnpm

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

访问 `http://localhost:5173`，默认账号 `admin / admin123`。

> 后端服务需在 `http://localhost:8000` 运行，开发环境已配置 `/api` 代理。

## 项目结构

```
src/
├── App.tsx                  # 路由配置 + QueryClient
├── main.tsx                 # 应用入口
├── index.css                # 全局样式（Tailwind + CSS 变量）
│
├── types/
│   ├── pipeline.ts          # 状态机类型：StageStatus、PipelineState、SSEEvent
│   └── api.ts               # API 响应类型
│
├── lib/
│   ├── api.ts               # Axios 实例 + 所有 API 方法封装
│   └── utils.ts             # cn() 工具函数
│
├── stores/
│   ├── pipeline.ts          # Zustand：管理各项目 pipeline 实时状态
│   └── auth.ts              # Zustand：用户认证状态（持久化）
│
├── hooks/
│   ├── useSSE.ts            # SSE 连接 hook（EventSource 封装）
│   └── usePipeline.ts       # Pipeline 操作：runStage / confirmStage / resetStage
│
├── components/
│   ├── pipeline/
│   │   ├── PipelinePanel.tsx   # 完整流水线面板（6个阶段）
│   │   └── StageCard.tsx       # 单阶段卡片（5种状态 × 不同操作按钮）
│   ├── chat/
│   │   └── ChatSheet.tsx       # 右侧 Chat 抽屉（流式响应）
│   └── layout/
│       └── AppLayout.tsx       # 顶部导航 + 页面布局
│
└── routes/
    ├── index.tsx                     # 项目列表页
    └── projects/$projectId/
        ├── index.tsx                 # 项目 Pipeline 主页
        ├── outline.tsx               # 大纲查看 + Chat 优化
        ├── script.tsx                # 剧本查看 + Chat 优化（待补充）
        └── storyboard.tsx            # 分镜查看 + Chat 优化（待补充）
```

## 核心设计

### 状态机 UI

流水线的每个阶段根据状态渲染不同 UI：

```
PENDING  → [生成 XXX] 按钮（前置未完成则置灰）
RUNNING  → 进度条 + 实时消息流（SSE 驱动）
PAUSED   → [确认通过] + [Chat 修改] 按钮
DONE     → [查看] + [Chat 优化] + [重新生成] 按钮
FAILED   → 错误信息 + [重试] 按钮
```

重置某个阶段会连带重置后续所有依赖阶段。

### SSE 实时更新

```
用户点击「生成大纲」
    ↓
usePipeline.runStage("outline")
    ↓
useSSE 建立 EventSource 连接
    ↓
后端推送 SSE 事件
    ↓
usePipelineStore 实时更新状态 → StageCard 重渲染
```

### Chat 优化

点击「Chat 优化」或「修改」按钮打开右侧 `ChatSheet` 抽屉，使用 `fetch` + `ReadableStream` 实现流式对话，支持的阶段：

- **大纲**：修改集数、调整剧情走向
- **剧本**：修改场景、对白、情绪节奏
- **分镜**：调整镜头类型、修改图片 prompt

### 状态管理分层

```
服务端状态（TanStack Query）
  → 项目列表、大纲列表、剧本列表等持久化数据

客户端状态（Zustand pipeline store）
  → 当前 pipeline 实时进度（SSE 推送更新）
  → 流式内容缓冲区（streaming content）
  → 不持久化到 localStorage
```

## 页面说明

### 项目列表页 `/`

- 项目卡片：显示名称、整体进度条（done/total）、6 阶段状态色块
- 新建项目弹窗：输入名称和简介

### 项目 Pipeline 页 `/projects/:id`

- 左侧：项目信息 + 导航菜单
- 右侧：`PipelinePanel`（6 个 `StageCard`）

### 大纲页 `/projects/:id/outline`

- 左侧：集数列表
- 右侧：选中集的完整大纲内容（核心矛盾、剧情主干、关键事件、情绪曲线等）
- 右侧抽屉：Chat 优化大纲

## 环境变量

```env
# .env.local
VITE_API_BASE_URL=http://localhost:8000  # 可选，默认走 vite proxy
```

开发环境通过 Vite proxy 自动将 `/api/*` 转发到 `http://localhost:8000`，无需额外配置。

## 代码规范

- 状态机相关类型统一在 `src/types/pipeline.ts` 定义
- 所有 API 调用通过 `src/lib/api.ts` 中的封装方法，不直接使用 axios
- 组件不直接修改 pipeline 状态，通过 `usePipeline` hook 操作
- SSE 事件处理统一在 `usePipeline.handleSSEEvent` 中集中处理

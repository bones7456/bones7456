# reader-printer

一个类似浏览器 Reader Mode 的网页阅读/打印工具，输入 URL 即可提取正文内容并以 A4 格式预览、打印或导出 PDF。

## 架构

Electron 桌面应用，分为三个文件：

- **`main.js`** — Electron 主进程。启动 Express 服务器后创建窗口，加载 `index.html`。防止多实例。
- **`server.js`** — Express 后端，监听 3000 端口。提供唯一接口 `GET /api/read?url=...`，返回 `{ title, content, byline }`。
- **`index.html`** — 单文件前端，包含全部 HTML / CSS / JS（内联）。

## 核心流程（server.js）

1. axios 抓取目标页面 HTML
2. JSDOM 构建虚拟 DOM
3. **预处理**（在 Readability 之前）：
   - 解析 `<style>` 中的 CSS 类，将 `font-style:italic` / `font-weight:bold` 的元素包成 `<em>` / `<strong>`
   - 处理内联 `style` 属性的同类情形
   - `<blockquote>` 自动包 `<em>`
   - 懒加载图片修复：`data-src`、`srcset`、Substack 专项（从 `data-attrs` 提取 S3 URL、修复损坏的 substackcdn URL）
   - `<picture>` 元素：提取最高清的 `srcset` URL
   - `<video>` 替换为 poster 图；YouTube iframe 替换为占位文字
   - 子标题保护：将被 `div` 包裹的 `h1-h4` 复制插入到相邻段落前，防止 Readability 丢弃
   - 图片锚定到相邻段落，保持位置
4. `@mozilla/readability` 提取正文
5. 对比提取前后图片数量，追加遗漏的图片

## 前端功能（index.html）

- **URL 输入 → 提取并预览**：调用 `GET /api/read?url=...`，结果渲染到 `#reader-content`
- **清理模式**（🧹）：点击任意元素将其删除；支持检测相似元素并批量清理
- **打印 / PDF**：直接调用 `window.print()`，打印样式隐藏输入栏，`#reader-content` 以 A4 宽度（210mm）渲染
- **亮色/暗色主题**切换

## 开发与构建

```bash
npm start          # 启动 Electron（开发模式）
npm run build      # electron-builder 打包（Mac，x64 + arm64 DMG）
```

构建产物在 `dist/`，已有 `Reader Printer-1.0.0.dmg`（x64）和 `Reader Printer-1.0.0-arm64.dmg`。

`server.js` 被设置为 `asarUnpack`，可直接在打包后的 app 中用 `require` 加载。

## 依赖

| 包 | 用途 |
|---|---|
| `@mozilla/readability` | 正文提取 |
| `jsdom` | 服务端 DOM 操作 |
| `axios` | 抓取网页 |
| `express` | HTTP 服务 |
| `cors` | 前端跨域（开发时有用） |
| `electron` | 桌面壳 |
| `electron-builder` | 打包 |

## 注意事项

- 前端 JS 全部内联在 `index.html`，没有独立的 JS 文件和构建步骤
- 后端不做持久化，无数据库
- 适配过的特殊站点：Substack、BBC（懒加载）、newsletter.semianalysis.com

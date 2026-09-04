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
   - 移除正文周边的附属区块（术语表、相关阅读、推荐轮播、分享、订阅、评论、侧栏）：先用 `meta description` 或最长段落定位「正文锚点」，含锚点的元素一律不删
   - 解析 `<style>` 中的 CSS 类，将 `font-style:italic` / `font-weight:bold` 的元素包成 `<em>` / `<strong>`
   - 处理内联 `style` 属性的同类情形
   - `<blockquote>` 自动包 `<em>`
   - 懒加载图片修复：`data-src`、`srcset`、Substack 专项（从 `data-attrs` 提取 S3 URL、修复损坏的 substackcdn URL）
   - `<picture>` 元素：提取最高清的 `srcset` URL
   - `<video>` 替换为 poster 图；YouTube iframe 替换为占位文字
   - 子标题保护：将被 `div` 包裹的 `h1-h4` 复制插入到相邻段落前，防止 Readability 丢弃
   - 图片锚定到相邻段落，保持位置
4. `@mozilla/readability` 提取正文
5. 兜底：拿一份未经预处理的副本再提一次，预处理版明显更短就改用原始结果
6. 对比提取前后图片数量，追加遗漏的图片（文章头图放正文开头，其余放末尾）
7. 输出清理：去重，并去掉占位图、图片来源署名、作者/时间戳块和空壳元素

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
- 站点专项逻辑集中在预处理阶段，遇到新站点提取不对时先看那里

## 适配过的特殊站点

| 站点 | 症状 | 对应处理 |
|---|---|---|
| Substack（含 newsletter.semianalysis.com） | 图片是懒加载占位图，substackcdn URL 损坏 | 从 `data-attrs` 提取 S3 原图 URL；修复 `<picture>` 里损坏的 `srcset` |
| BBC | 正文整段丢失——11 个推荐卡片标题被子标题保护逻辑挤进同一个容器，反而把它撑成了 Readability 眼里的最佳候选 | 子标题保护跳过链接标题和导航/推荐区块里的标题，且一个段落只接收一个标题；灰色占位图在去重之前先删掉 |
| snexplores.org | 提出来的是一整页名词解释——文末的 Power Words 术语表约 7900 字符，比 5500 字符的正文还长，被 Readability 当成了正文；它的 class `article-footer__power-words` 里带着 "article"，正好命中 Readability 的豁免规则，自带的 `unlikelyCandidates` 拦不住 | 预处理第一步就移除附属区块；文章 `<header>` 里的头图不再被当成导航图标滤掉 |
| newsfilecorp.com（通稿分发页） | 正文配图跑到了文章最后——图片包在"点击查看大图"的 `<a>` 链接里，所在段落链接密度过高被 Readability 当噪音整段删掉；同时文末的 1x1 埋点图（`class="tracker"`, `src` 是 `api.*` 域名）被当成正文图片保留了下来 | 图片虽已在 `<p>` 内，但该段落链接密度过高时仍额外补一个锚点兜底，保住原始位置；`isValidContentImage` 与输出清理阶段都排除 `class` 含 track/pixel/beacon 或 `src` 以 `https://api.` 开头的埋点图 |

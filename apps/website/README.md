# ji.dev 网站

JI 的产品页（`/`）、文档（`/docs`）和品牌资源页（`/brand`）。用 TanStack Start 在构建时把每个页面预渲染成纯静态 HTML，产物可以放到任意静态托管，**不需要运行 Node 服务**。

```bash
pnpm website                                  # 开发：https://ji.localhost（经 portless 代理）
pnpm --filter @ji.dev/website build           # 预渲染到 apps/website/dist/client/
pnpm --filter @ji.dev/website preview         # https://preview.ji.localhost，纯静态服务器托管构建产物
pnpm --filter @ji.dev/website typecheck       # 页面代码 + 页面上展示的代码示例
```

- 本地域名由 [portless](https://portless.sh/) 提供，名称写在 `portless.json`。首次运行会生成并信任本地 CA、监听 443 端口，需要 sudo。
- 部署：构建命令 `pnpm --filter @ji.dev/website build`，发布目录 `apps/website/dist/client`。`dist/server` 只在构建时用来预渲染，不需要部署。
- 预渲染只爬取页面路由，跳过带扩展名的下载链接（避免覆盖 `public/` 里原样复制的文件）和 `#锚点` 链接。每篇文档和 `/404` 也在 `vite.config.ts` 里显式列出，没有页面链接到它们也会生成。

## Docker

镜像是纯静态站点：Node 只在构建阶段用，最终镜像是 nginx 托管 `dist/client`。文档来自仓库根目录的 `docs/`，所以要在**仓库根目录**构建：

```bash
docker build -f apps/website/Dockerfile -t ji-website .
docker run --rm -p 8080:80 ji-website        # http://localhost:8080
```

- `Dockerfile.dockerignore` 用白名单，只把 workspace 的 `package.json`、`docs/` 和 `apps/website` 放进构建上下文（`apps/replay` 里有几 GB 未提交的数据）。
- `nginx.conf`：每个页面都是文件（`/docs/plugins` → `docs/plugins/index.html`），没有 SPA 回退；不存在的路径返回 `404.html` 和 404 状态码。`/assets/` 带哈希，长期缓存。

## 文档

`/docs` 由仓库的 `docs/*.md` 在构建时生成（`vite-plugins/docs.ts`），浏览器端不解析 Markdown：

- `README.md` 是 `/docs`，其他文件是 `/docs/<文件名>`。侧边栏顺序写在 `vite.config.ts` 的 `order` 里，没列出的文件按字母排在后面。
- 标题 id 用 GitHub 的规则生成，所以 GitHub 上的锚点链接（如 `plugins.md#ordering`）在网站上同样有效。
- 文档之间的链接改成站内链接（`/docs/plugins#ordering`），其他相对链接指向 GitHub 上的文件。
- 每篇开头的语言切换行和 `<br>` 间隔是给 GitHub 页面用的，网站上会去掉。
- 代码块和首页共用 Shiki 墨色主题；`before` / `after` / `intercept` 同样标成青绿。
- 中文文档（`docs/zh-CN/`）暂未上站，链接指向 GitHub。
- `exclude` 里的文件（目前是 `kernel.md`）只留在 GitHub，网站只放入门到插件这几页，站内指向它们的链接自动变成 GitHub 链接。

## 代码示例

页面上的代码都在 `src/snippets/`，构建时由 [Shiki](https://shiki.style/) 高亮（`vite-plugins/highlight.ts`，`import html from './x.ts?highlight'`），高亮器不进客户端包。

示例按真实的 `@ji.dev/llm` 和 `@ji.dev/plugin-compaction` 做类型检查（`src/snippets/tsconfig.json`，沿用仓库的 `tsconfig.base.json`），API 改名或签名变化时 `typecheck` 会失败，不会把过时的代码发到网站上。

- 示例里没有在页面上定义的名字（`model`、`session`、其他示例里的插件）来自 `src/snippets/context.ts`，只有类型声明，不会运行。
- 文件开头到 `// @snippet` 这一行是给类型检查用的前置导入，页面不显示。
- 示例按展示需要手工排版（首屏示例每行不超过 60 个字符），所以 oxfmt 和 ESLint 都跳过 `src/snippets/`。

## 资源

`public/` 原样复制到站点根路径：`public/logos/indigo.webp` 对应 `/logos/indigo.webp`。这里只放网站实际用到的成品：

- `logos/`：七种配色的 SVG 与无损 WebP（`/brand` 的下载文件），页脚用的 `paper-288.webp` 缩略图，以及三份清单。
- `qinglv-silk/`：青绿绢本的 SVG、1024px WebP 和绢纹底图，以及清单。
- `seal.svg`：「极」字朱砂印章（白文），深浅两种主题共用一张，同时用作 favicon。

这些文件由 ji.dev 资源仓库的生成脚本产出（矢量化、换色、像素校验），原图和脚本都留在那边。更新资源时在那边重新生成，再把成品复制到这里。清单（`*.json`）在构建时由 Zod 校验，缺项或格式不对时构建会失败。

## 设计

设计语境见 [PRODUCT.md](PRODUCT.md)（用户、品牌、反面参考）和 [DESIGN.md](DESIGN.md)（墨阶、矿物色、字体、组件规则）。`.impeccable/design.json` 是 DESIGN.md 的补充数据，供 impeccable 使用。

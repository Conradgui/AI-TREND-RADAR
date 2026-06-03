# 新手启用指南

这份指南按从易到难的顺序走：先本地生成报告，再让 GitHub Actions 自动生成，最后开启 GitHub Pages、RSS、Telegram 和飞书通知。

## 第 0 步：准备环境

你需要：

- Node.js 22
- pnpm
- GitHub 仓库：`Conradgui/AI-TREND-RADAR`
- DeepSeek API key

检查 Node 和 pnpm：

```bash
node -v
pnpm -v
```

成功标志：

- `node -v` 输出 `v22.x.x`
- `pnpm -v` 能正常输出版本号

常见失败：

- `pnpm: command not found`：先运行 `corepack enable`，或安装 pnpm。
- Node 版本过低：切换到 Node 22。

## 第 1 步：本地生成第一份 HTML 报告

安装依赖：

```bash
pnpm install --frozen-lockfile
```

配置 DeepSeek key。命令会等待你粘贴 key，不会把 key 写进仓库：

```bash
export LLM_PROVIDER=deepseek
printf "DeepSeek API key: "
read -r -s DEEPSEEK_API_KEY
printf "\n"
export DEEPSEEK_API_KEY
```

生成日报：

```bash
pnpm digest
```

成功标志：

- 终端最后看到 `Done!`
- 出现 `digests/YYYY-MM-DD/ai-topic-radar.html`
- 出现 `manifest.json`
- 出现 `digests/search-index.json`
- 出现 `feed.xml`

打开报告：

```text
digests/YYYY-MM-DD/ai-topic-radar.html
```

常见失败：

- `Missing DEEPSEEK_API_KEY`：当前终端没有成功 export key，重新执行上面的 `read -r -s` 命令。
- GitHub API 403：说明匿名 GitHub API 限流。可以先忽略，也可以配置 `GITHUB_TOKEN`。
- Product Hunt skipped：没有配置 `PRODUCTHUNT_TOKEN`，不影响主报告。
- 数据源显示 `empty`：表示来源成功访问但本轮没有新内容，不等同于失败。

## 第 2 步：启用 GitHub Actions 自动日报

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

至少添加：

```text
DEEPSEEK_API_KEY
```

建议添加：

```text
PRODUCTHUNT_TOKEN
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
FEISHU_WEBHOOK_URLS
```

手动触发：

```text
Actions -> Daily AI Topic Radar -> Run workflow
```

成功标志：

- workflow 绿色通过
- 仓库出现新的 `digests/YYYY-MM-DD/`
- `manifest.json` 和 `feed.xml` 被更新
- `digests/search-index.json` 被更新，并从每日 `topic-pool.json` 的 `candidates` 生成历史搜索数据
- 如果配置了通知 token，Telegram / 飞书收到消息

常见失败：

- `Missing DEEPSEEK_API_KEY`：GitHub Secrets 没有配置或名字拼错。
- workflow 没有提交文件：当天没有新变化，或 workflow 没有写权限。检查 `Settings -> Actions -> General -> Workflow permissions` 是否允许 read and write。
- 通知没有发送：检查对应 token 是否配置，或聊天 ID / webhook 是否正确。

## 第 3 步：开启 GitHub Pages 分享报告

进入：

```text
Settings -> Pages
```

推荐配置：

```text
Source: GitHub Actions
```

访问历史 Web UI：

```text
https://conradgui.github.io/AI-TREND-RADAR
```

访问单日主报告：

```text
https://conradgui.github.io/AI-TREND-RADAR/digests/YYYY-MM-DD/ai-topic-radar.html
```

RSS：

```text
https://conradgui.github.io/AI-TREND-RADAR/feed.xml
```

成功标志：

- Pages 页面能打开 `index.html`
- 单日 HTML 能打开
- `feed.xml` 能在浏览器中显示 XML

常见失败：

- 404：Pages 还没部署完成，等 1-3 分钟；或仓库路径大小写写错。
- Web UI 空白：确认 `manifest.json` 已提交，且 `digests/YYYY-MM-DD/ai-topic-radar.md` 存在。
- 搜索没有结果：确认 `digests/search-index.json` 已提交，且对应日期的 `topic-pool.json` 里有 `candidates`。
- 观察项暂无条目：表示当天没有 50-64 分候选；不代表数据源采集失败。
- 通知里的链接打不开：确认 workflow 的 `PAGES_URL` 使用 `https://conradgui.github.io/AI-TREND-RADAR`。

## 第 4 步：配置 Telegram 和飞书通知

### Telegram

本地测试：

```bash
printf "Telegram bot token: "
read -r -s TELEGRAM_BOT_TOKEN
printf "\n"
export TELEGRAM_BOT_TOKEN

printf "Telegram chat id: "
read -r TELEGRAM_CHAT_ID
export TELEGRAM_CHAT_ID

export PAGES_URL=https://conradgui.github.io/AI-TREND-RADAR
pnpm notify
```

成功标志：

- Telegram 收到 AI Topic Radar 消息
- 消息里包含主报告、Web UI、RSS 链接

### 飞书

本地测试：

```bash
printf "Feishu webhook url: "
read -r -s FEISHU_WEBHOOK_URLS
printf "\n"
export FEISHU_WEBHOOK_URLS

export PAGES_URL=https://conradgui.github.io/AI-TREND-RADAR
pnpm notify:feishu
```

成功标志：

- 飞书群收到卡片消息
- 卡片里包含主报告、Web UI、RSS 链接

## 第 5 步：理解高级开关

默认只生成中文主报告：

```bash
pnpm digest
```

开启源级报告：

```bash
SAVE_SOURCE_REPORTS=1 pnpm digest
```

开启中英文源级报告：

```bash
REPORT_LANGS=zh,en SAVE_SOURCE_REPORTS=1 pnpm digest
```

这些源级报告适合排查数据和做深度追溯；日常阅读建议只看 `ai-topic-radar.html`。

## 排错顺序

遇到问题时按这个顺序检查：

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm manifest`
4. 打开 `digests/YYYY-MM-DD/ai-topic-radar.html`
5. 检查 `manifest.json`
6. 检查 `digests/search-index.json`
7. 检查 `feed.xml`
8. 检查 GitHub Actions Secrets
9. 检查 GitHub Pages URL 大小写

## 安全提醒

不要提交：

- `.env`
- API key
- Telegram bot token
- 飞书 webhook
- 私有社群内容
- 公司内部资料

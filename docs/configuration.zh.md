# 配置帮助文档

本文是查表式配置手册。新手完整路径见 [新手启用指南](getting-started.zh.md)。

不要把真实 token 写进 README、提交记录、聊天内容或 `.env.example`。本地用环境变量，线上用 GitHub Actions Secrets。

官方参考：

- DeepSeek API 文档：https://api-docs.deepseek.com/zh-cn/
- GitHub Actions Secrets：https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- GitHub Personal Access Token：https://docs.github.com/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token
- GitHub Pages Quickstart：https://docs.github.com/en/pages/quickstart
- Product Hunt API：https://www.producthunt.com/v2/docs
- Telegram Bot：https://core.telegram.org/bots/features
- Telegram sendMessage：https://core.telegram.org/bots/api#sendmessage
- 飞书自定义机器人：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

## Pages URL

当前仓库名是 `AI-TREND-RADAR`，GitHub Pages 推荐 URL 是：

```text
https://conradgui.github.io/AI-TREND-RADAR
```

通知和 RSS 的链接应保持同一个路径。不要混用小写 `ai-topic-radar`，否则 Pages 链接可能因为路径大小写不一致而打不开。

## DeepSeek

本地临时配置：

```bash
export LLM_PROVIDER=deepseek
printf "DeepSeek API key: "
read -r -s DEEPSEEK_API_KEY
printf "\n"
export DEEPSEEK_API_KEY
```

如果账号使用特定模型 ID：

```bash
export DEEPSEEK_MODEL=your_deepseek_model_id
```

运行：

```bash
pnpm digest
```

macOS 剪贴板方式：

```bash
export LLM_PROVIDER=deepseek
export DEEPSEEK_API_KEY="$(pbpaste)"
pnpm digest
```

GitHub Actions Secret 名称：

```text
DEEPSEEK_API_KEY
```

## GitHub Token

Actions 中 `${{ secrets.GITHUB_TOKEN }}` 会自动提供，一般不需要手动创建。

本地运行时，如果遇到 GitHub API 403，可以配置个人 token 提高限流：

```bash
printf "GitHub token: "
read -r -s GITHUB_TOKEN
printf "\n"
export GITHUB_TOKEN
```

如果需要让脚本创建 digest issue：

```bash
export DIGEST_REPO=Conradgui/AI-TREND-RADAR
```

## Product Hunt

Product Hunt 用于补充 AI 产品发布信号。未配置时会跳过，不阻断主报告。

```bash
printf "Product Hunt token: "
read -r -s PRODUCTHUNT_TOKEN
printf "\n"
export PRODUCTHUNT_TOKEN
```

GitHub Actions Secret 名称：

```text
PRODUCTHUNT_TOKEN
```

## 数据源状态与选题规则

日报不会因为单个公开来源失败而中断。主报告里的"数据源状态与修复提示"使用以下语义：

| 状态 | 含义 |
| --- | --- |
| `ok` | 成功获取并产出内容 |
| `empty` | 成功访问，但本轮没有符合条件的新内容 |
| `skipped` | 缺少可选 token 或配置，主动跳过 |
| `error` | 网络、接口结构或上游返回异常 |

注意：

- `empty` 不是故障。官方内容源、Gitee 等来源在首次运行后没有新增内容是正常情况。
- ArXiv、36kr、OSChina 和官网 sitemap 会校验最小 XML 结构；HTTP 200 但返回 HTML 拦截页或异常 XML 时会标记为 `error`。
- Gitee 是尽力而为来源；空结果、部分关键词失败或接口短暂不可用不会阻断日报。

选题池规则：

- 每日结构化选题池写入 `digests/YYYY-MM-DD/topic-pool.json`，主字段为 `candidates`。
- 搜索索引 `digests/search-index.json` 由 `pnpm manifest` 生成，优先读取 `candidates`，并兼容旧版 `topics`。
- 候选会按 URL 去重。
- OpenAI / Anthropic / Google DeepMind 官网一手内容拥有最高排序优先级。
- GitHub + Gitee 仓库类候选最多保留 16 条，避免仓库信号长期挤满候选池。
- Gitee 单源最多 3 条。
- GitHub 仓库热度使用对数计分，高 star 项目仍可入池，但不会仅凭总 star 压过其他来源。
- 国内源拆分为国内媒体（InfoQ 中国、36kr）和国内开发者社区（开源中国、掘金）；国内源合计最多 6 条。
- 掘金单源最多 2 条，定位为补充社区观察，不作为 Top 深挖主来源。
- Dev.to 和 Lobsters 社区内容会进入选题池，同时也可用于社区报告。
- 50-64 分是"观察项"；如果观察项为空，报告会显示解释文案，这不代表采集失败。

## Telegram

需要两个值：

- `TELEGRAM_BOT_TOKEN`：从 BotFather 创建 bot 后获得。
- `TELEGRAM_CHAT_ID`：目标用户、群组或频道 ID。

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

GitHub Actions Secrets：

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

未配置时，`pnpm notify` 会跳过，不会让 workflow 失败。

## 飞书

飞书使用自定义机器人 webhook。多个 webhook 用英文逗号分隔。

本地测试：

```bash
printf "Feishu webhook url: "
read -r -s FEISHU_WEBHOOK_URLS
printf "\n"
export FEISHU_WEBHOOK_URLS

export PAGES_URL=https://conradgui.github.io/AI-TREND-RADAR
pnpm notify:feishu
```

GitHub Actions Secret：

```text
FEISHU_WEBHOOK_URLS
```

未配置时，`pnpm notify:feishu` 会跳过，不会让 workflow 失败。

## GitHub Actions Secrets

进入：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

建议配置：

| Secret | 是否必需 | 用途 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 必需 | 生成日报摘要和 highlights |
| `PRODUCTHUNT_TOKEN` | 可选 | 启用 Product Hunt 数据源 |
| `TELEGRAM_BOT_TOKEN` | 建议 | Telegram 通知 |
| `TELEGRAM_CHAT_ID` | 建议 | Telegram 通知目标 |
| `FEISHU_WEBHOOK_URLS` | 建议 | 飞书通知 |
| `SMTP_HOST` | 建议 | 邮箱早报 SMTP 服务器 |
| `SMTP_PORT` | 可选 | SMTP 端口，默认 `587`，SSL 通常用 `465` |
| `SMTP_USERNAME` | 建议 | SMTP 登录邮箱或账号 |
| `SMTP_PASSWORD` | 建议 | SMTP 密码或邮箱授权码 |
| `EMAIL_FROM` | 可选 | 发件人地址，默认使用 `SMTP_USERNAME` |
| `EMAIL_TO` | 建议 | 收件人邮箱，可填你的手机邮箱 |
| `ANTHROPIC_API_KEY` | 可选 | 备用 LLM provider |
| `ANTHROPIC_BASE_URL` | 可选 | 备用 provider base URL |

GitHub CLI 写入 Secret 示例：

```bash
printf "DeepSeek API key: "
read -r -s DEEPSEEK_API_KEY
printf "\n"
printf "%s" "$DEEPSEEK_API_KEY" | gh secret set DEEPSEEK_API_KEY
unset DEEPSEEK_API_KEY
```

Telegram：

```bash
printf "Telegram bot token: "
read -r -s TELEGRAM_BOT_TOKEN
printf "\n"
printf "%s" "$TELEGRAM_BOT_TOKEN" | gh secret set TELEGRAM_BOT_TOKEN
unset TELEGRAM_BOT_TOKEN

printf "Telegram chat id: "
read -r TELEGRAM_CHAT_ID
printf "%s" "$TELEGRAM_CHAT_ID" | gh secret set TELEGRAM_CHAT_ID
unset TELEGRAM_CHAT_ID
```

飞书：

```bash
printf "Feishu webhook url: "
read -r -s FEISHU_WEBHOOK_URLS
printf "\n"
printf "%s" "$FEISHU_WEBHOOK_URLS" | gh secret set FEISHU_WEBHOOK_URLS
unset FEISHU_WEBHOOK_URLS
```

邮箱早报：

```bash
printf "SMTP host: "
read -r SMTP_HOST
printf "%s" "$SMTP_HOST" | gh secret set SMTP_HOST
unset SMTP_HOST

printf "SMTP port (default 587): "
read -r SMTP_PORT
printf "%s" "$SMTP_PORT" | gh secret set SMTP_PORT
unset SMTP_PORT

printf "SMTP username: "
read -r SMTP_USERNAME
printf "%s" "$SMTP_USERNAME" | gh secret set SMTP_USERNAME
unset SMTP_USERNAME

printf "SMTP password or app password: "
read -r -s SMTP_PASSWORD
printf "\n"
printf "%s" "$SMTP_PASSWORD" | gh secret set SMTP_PASSWORD
unset SMTP_PASSWORD

printf "Email to: "
read -r EMAIL_TO
printf "%s" "$EMAIL_TO" | gh secret set EMAIL_TO
unset EMAIL_TO
```

常见 SMTP 配置：

| 邮箱 | `SMTP_HOST` | `SMTP_PORT` | 说明 |
| --- | --- | --- | --- |
| QQ 邮箱 | `smtp.qq.com` | `587` 或 `465` | 使用授权码，不是 QQ 登录密码 |
| 163 邮箱 | `smtp.163.com` | `587` 或 `465` | 使用客户端授权码 |
| Gmail | `smtp.gmail.com` | `587` 或 `465` | 使用 App Password |

## GitHub Pages

进入：

```text
Settings -> Pages
```

推荐配置：

```text
Source: GitHub Actions
```

Pages 只在日报、周报、月报 workflow 成功后自动部署，也可以在 `Actions -> Deploy GitHub Pages -> Run workflow` 手动部署。普通代码或 README push 不会触发发布，避免开发过程中的测试产物误上站。

部署后访问：

```text
https://conradgui.github.io/AI-TREND-RADAR
```

每日主报告：

```text
https://conradgui.github.io/AI-TREND-RADAR/digests/YYYY-MM-DD/ai-topic-radar.html
```

RSS：

```text
https://conradgui.github.io/AI-TREND-RADAR/feed.xml
```

如果访问 Web UI、RSS 或单日报告时看到 404：

- 确认 `Settings -> Pages` 使用 `GitHub Actions` 作为 Source。
- 确认 `Actions -> Deploy GitHub Pages` 已成功完成；如果还没有运行过，可以手动运行一次。
- 先等待 GitHub Pages 部署完成，刚开启 Pages 或刚完成部署时可能需要 1-3 分钟。
- 确认仓库 main 分支存在 `index.html`、`feed.xml`、`manifest.json`、`.nojekyll` 和 `digests/YYYY-MM-DD/ai-topic-radar.html`。
- 如果 Actions 刚生成日报，等提交和 `Deploy GitHub Pages` 部署都完成后再刷新链接。

## 输出开关

默认只生成中文主报告：

```bash
pnpm digest
```

生成源级中文报告：

```bash
SAVE_SOURCE_REPORTS=1 pnpm digest
```

生成中英文源级报告：

```bash
REPORT_LANGS=zh,en SAVE_SOURCE_REPORTS=1 pnpm digest
```

## 安全检查

提交前建议检查：

```bash
git status --short
git diff -- . ':!digests/**'
```

不要提交：

- `.env`
- 真实 API key
- Telegram bot token
- 飞书 webhook
- 私有社群内容
- 公司内部资料
- 未公开报告

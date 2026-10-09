<p align="center">
  <img src="docs/assets/hero.png" alt="Regmark：你的店铺前后一致吗？四个来源印出四个不同的价格，套印错位；随后每个来源都与结账价格一致，套准对齐。" width="100%">
</p>

<p align="center">
  <a href="https://github.com/kairwang01/regmark/actions/workflows/ci.yml"><img alt="CI 状态" src="https://github.com/kairwang01/regmark/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/regmark"><img alt="npm 版本" src="https://img.shields.io/npm/v/regmark?color=21355c"></a>
  <a href="#在-github-actions-中使用"><img alt="GitHub Action：kairwang01/regmark@v0" src="https://img.shields.io/badge/action-kairwang01%2Fregmark%40v0-21355c?logo=githubactions&logoColor=white"></a>
  <a href="docs/rules.md"><img alt="17 条规则" src="https://img.shields.io/badge/rules-17-21355c"></a>
  <a href="LICENSE"><img alt="Apache-2.0 许可证" src="https://img.shields.io/badge/license-Apache--2.0-21355c"></a>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/README-English-c2256e"></a>
</p>

<h1 align="center">Regmark</h1>

<p align="center"><b>你的店铺前后一致吗？</b><br>
在本地或 CI 中，找出商品页、结构化数据、商家 feed、AI 代理端点与结账之间的价格、库存和运费不一致。</p>

<p align="center">
  <a href="#十秒钟试用">演示</a> ·
  <a href="docs/quickstart.md">快速上手</a> ·
  <a href="#在-github-actions-中使用">GitHub Action</a> ·
  <a href="docs/rules.md">规则</a> ·
  <a href="docs/configuration.md">配置</a> ·
  <a href="README.md">English</a>
</p>

你的 feed 写着 **22 美元**，购物车却收 **24 美元**。JSON-LD 里还留着上个月的促销价，引用你店铺报价的购物助手也信了它。这些文件单独看都是合法的，只是店铺自己和自己对不上；在 Google 拒绝该商品、或顾客拿到一个不同的总价之前，没有任何东西会告诉你。

Regmark 会读取店铺陈述商品事实的每一个地方：用户看到的页面，页面中的 JSON-LD、microdata 和 Open Graph 标签，你的 Google 与 ACP feed，UCP 目录和店铺 MCP 服务器，店铺 API，以及真实的购物车。它按规格逐一对齐这些数据，报告每一处不一致，给出两个值以及它们各自的确切位置。在 CI 中，它可以在不一致的数据上线之前让构建失败。

- **默认只读。** 无需账号、API 密钥或托管服务，没有遥测。它遵守 `robots.txt`，并自行控制请求节奏。
- **给证据，不打分。** 每条发现都会指明规格、两个值、它们的原始文本和定位信息：JSON-LD 路径、feed 条目或 API 字段。
- **为 CI 而生。** 提供退出码、逐规则预算、pull request 评论、用于代码扫描的 SARIF，以及 JUnit、JSON、Markdown 和单文件 HTML 报告。
- **检查代理读到的内容。** UCP 目录、店铺 MCP 服务器、ACP 商品 feed，以及对购物代理和对浏览器说法不一的页面。

## 十秒钟试用

```bash
npx regmark demo
```

它会审计随工具打包的一家小型模拟店铺，店里预设了 27 个缺陷：feed 里是上周的价格，JSON-LD 只列出三个尺码中的一个，购物车并不兑现“免运费”的宣称，UCP 目录落后于购物车，页面向代理报出的价格比向浏览器报出的更低。任何数据都不会离开你的机器。

<p align="center"><img src="docs/assets/terminal.png" alt="regmark demo 的终端输出：price.mismatch 发现，每条都显示该来源的值、结账的值以及错误值所在的位置" width="880"></p>

它还会写出 `regmark-demo.html`，这是一个自包含的单文件，可以直接打开，也可以发给别人。各来源不一致时，报告标题会呈现 Out of register（套印不准）的效果，就像对位偏移的印张；运行 `npx regmark demo --clean` 则可以看到同一家店铺在没有任何问题时的样子。

<p align="center">
  <img src="docs/assets/report-out-of-register.png" alt="标题为 Out of register 的 HTML 报告，文字以青、品红、黄三色重影" width="49%">
  <img src="docs/assets/report-in-register.png" alt="标题为 In register 的 HTML 报告，印得干净利落" width="49%">
</p>

唯一的要求是 Node.js 22 或更新版本。没有 npm？整个工具就是一个文件：

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/latest/download/regmark.mjs
node regmark.mjs demo
```

## 审计你自己的店铺

```bash
npx regmark audit https://your-shop.example --html report.html
```

不加任何参数时，它会自动判断店铺运行的是 WooCommerce 还是 Shopify，抽样 25 件商品，读取它们的页面和店铺 API 并进行比较。给它更多可比较的数据，它就能发现更多问题：

```bash
# 商家 feed（最容易过期的来源），以及它允许有多旧
npx regmark audit https://your-shop.example --feed /feeds/google.xml --max-age feed=24h

# AI 购物代理会读取的内容：UCP 目录、店铺 MCP 服务器、ACP feed
npx regmark audit https://your-shop.example --ucp --mcp --acp-feed /feeds/acp.jsonl.gz

# 真实购物车总价和 cloaking 检查，仅用于你已证明归自己所有的店铺
REGMARK_OWNERSHIP_TOKEN=… npx regmark audit https://staging.your-shop.example --checkout --cloaking
```

`npx regmark explain <rule>` 会说明一条发现通常由什么引起，以及应该到哪里修复。`npm install -D regmark` 则像其他开发工具一样，把它固定在项目中。[全部参数和配置字段](docs/configuration.md) · [快速上手与排错](docs/quickstart.md)

## 在 GitHub Actions 中使用

```yaml
# .github/workflows/regmark.yml
name: Regmark
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
          comment: 'true'
```

当某条规则超出预算时，任务会失败。发现会显示在任务摘要中；设置 `comment: 'true'` 后，还会生成一条 pull request 评论，并在每次推送时更新。HTML、JSON、SARIF 和 Markdown 报告会作为构件保存，各项计数则作为步骤输出。error 级规则出现第一条发现就会失败；warn 级规则除非设置了预算，否则不会让构建失败。如果店铺已经存在发现，可以先把每条规则的预算设为当前数量，再逐步调低。

[全部输入与输出](docs/ci.md#inputs)、向代码扫描上传 SARIF、GitLab 及其他任何 CI：[docs/ci.md](docs/ci.md)。

| 退出码 | 含义 |
|---|---|
| `0` | 读到了商品，且每条规则都在预算内 |
| `1` | 至少一条规则超出预算 |
| `2` | 审计无法运行、没有读到任何商品，或（使用 `--strict` 时）有来源无法采集 |

店铺宕机会让构建失败，而不是通过。

## 为什么需要它

Google Merchant Center 其实已经在对你做这种比对：它把 feed 中的价格与落地页及其结构化数据对照，要求它们[一致](https://support.google.com/merchants/answer/12159029)，并拒绝不一致的商品。你只能事后从 Google 那里得知，而且一次只知道一个商品。

如今，读取这些数据的“读者”越来越多。AI 购物代理会照搬你的结构化数据、UCP 目录或 MCP 服务器给出的内容来报价，而它的用户实际支付的是结账给出的金额。如果这是两个不同的数字，这笔订单和这位顾客的信任就都没了，也没有任何仪表盘会告诉你原因。

Regmark 抢在前面做这个比对：一次覆盖所有来源，可用于测试环境或生产环境，发现差异时还能让构建失败。

## 它读取什么

各个来源的分组方式，就像印张被分离成若干色版。黑版是其他色版对齐的依据，所以印刷行业称它为 K，即 key（主版）。在这里，结账就是主版。

| 色版 | 信息来源 | 支持范围 |
|---|---|---|
| **C** | 商品页：可见价格与库存、JSON-LD、microdata、Open Graph、商品文本 | 任何在 HTML 中呈现这些事实的店铺 |
| **M** | Google 格式的商家 feed：RSS、Atom 或制表符分隔 | 任何你能提供 URL 的 feed |
| **Y** | 代理直接读取的内容：UCP 目录（`/.well-known/ucp`）、店铺 MCP 服务器与 ACP 商品 feed | 只读；UCP 2026-08-25 |
| **K** | 店铺本身：店铺 API 与真实购物车 | WooCommerce 与 Shopify；购物车须在所有权验证之后 |

以哪个来源为准是明确规定的：先看结账，其次是店铺 API，最后才是可见页面。结构化数据、feed 和代理端点从不被当作依据，它们是被检查的对象。[确切的抽样与覆盖范围](docs/configuration.md#which-products-get-audited)

## 它能发现什么

| 规则 | | 检测内容 |
|---|---|---|
| `price.mismatch` | error | 某个来源标示的价格，与结账实际收取的不一致 |
| `price.currency-ambiguous` | error | 机器可读的价格缺少币种，或币种错误 |
| `price.tax-basis` | warn | 两个价格恰好相差一个 VAT 或 GST 税率 |
| `price.sale-expired` | warn | 仍在收取的价格，其促销结束日期已经过去 |
| `availability.mismatch` | error | 一个来源显示有货，店铺显示售罄，或者相反 |
| `availability.stale` | warn | feed 的时间已超过你为它设定的刷新间隔 |
| `variant.missing` | error | 结构化数据或代理端点只列出部分规格，漏掉了其他规格 |
| `variant.unpurchasable` | error | 各处都说可以购买，购物车却拒绝 |
| `shipping.mismatch` | error | 声称的运费与结账实际收取的不一致 |
| `shipping.undisclosed` | warn | 运费只在结账时才出现 |
| `identity.unmatched` | warn | feed 中的条目对应店铺已不再销售的商品 |
| `identity.gtin-invalid` | warn | GTIN 校验位错误，或被两个规格共用 |
| `policy.return-missing` | info | 没有机器可读的退货政策 |
| `content.hidden-text` | warn | 文本保留在页面中，却被刻意藏起来不让人看到 |
| `content.instruction-like` | error | 商品文本是写给语言模型而不是写给顾客的 |
| `content.invisible-chars` | warn | 用零宽字符和 Unicode 标签字符夹带不可见文本 |
| `content.cloaking` | error | 页面向购物代理展示的价格或库存，与向浏览器展示的不同 |

[docs/rules.md](docs/rules.md) 精确说明了每条规则何时触发，并且同样仔细地说明了它何时保持静默。内容检查是启发式检测，不是完整的提示词注入防御。

## 需要证明店铺归你所有的检查

读取公开页面不需要任何人的许可，但有两项检查不同。**购物车探测**会把一个单位的商品放进购物车、设置收货地、读取价格和运费，然后清空购物车：这会对店铺产生写入。**cloaking 检查**会分别以浏览器和购物代理的身份重新获取每个页面：这是在冒充其他客户端。这两项检查都只会在你证明店铺归你所有之后才会运行。

1. 选择一个由 16 个或更多字母、数字、`_` 或 `-` 组成的 token。
2. 在 `/.well-known/regmark.txt` 提供 `regmark-verify=<token>` 这一行，或将其作为 TXT 记录发布在 `_regmark.<your-domain>`。
3. 带上 `REGMARK_OWNERSHIP_TOKEN=<token>` 运行，并加上 `--checkout`、`--cloaking` 或两者都加。

没有任何参数可以跳过这一步。探测从不进入支付环节，每处理完一件商品就会清空购物车，如果没能清空，会明确地大声提示。在 WooCommerce 上，它读取含税的完整总价；在 Shopify 上，它读取行项目价格、可购买性和运费，因为税额只有到结账时才能确定。

## 它在站点上的行为

- 只会访问你指定的主机。指向别处的重定向或链接不会被跟随。
- 遵守 `robots.txt`，请求之间间隔一秒。
- 拒绝访问任何解析到私有地址的主机，因此恶意店铺无法利用在你内网中运行的审计，向内网发起请求。
- 限制响应大小，并且按解压后的大小计算。
- 把读取到的一切内容都视为不可信，所有报告格式皆是如此。
- 不会向任何地方发送数据，没有遥测。

## 与其他工具的比较

| | 检查什么 | 不检查什么 |
|---|---|---|
| Google Merchant Center 诊断 | 你的 feed 与页面是否一致，针对 feed 中的商品 | 发布之前的状态；其他来源；你的 CI |
| Rich Results Test、schema 校验器 | 单个页面的标记格式是否正确 | 其中的值是否属实 |
| UCP、ACP 与 feed 校验器 | 端点或文件的结构是否正确 | 其中的值是否与其他任何来源一致 |
| 页面级“AI 就绪度”评分 | 机器能从单个页面读到什么 | 读到的内容是否与你的 feed 或结账一致 |
| **Regmark** | 每个来源是否都与结账一致，按规格逐一检查 | 除读取所需之外的标记有效性；排名或可见度 |

这些工具回答的是不同的问题，配合使用效果很好。[定位与应用场景](docs/positioning.md)

## 常见问题

**它会改动我店铺里的任何东西吗？** 除非你要求，否则不会。单纯的 `audit` 只读取。`--checkout` 会写入购物车，而且只有在所有权验证之后才会执行；它从不下单。

**它会执行 JavaScript 吗？** 不会。它读取服务器返回的 HTML，大多数爬虫和代理也是如此。只有脚本运行后才出现的价格，它看不到，通常它们也看不到。

**支持哪些平台？** WooCommerce 和 Shopify 通过各自的店铺 API 读取，并且可以在购物车处进行探测。其他任何店铺都可以根据其页面、sitemap 和 feed 进行审计，以可见页面为基准。欢迎贡献[更多平台](https://github.com/kairwang01/regmark/issues/7)的支持。

**`--ucp` 在 Shopify 上能用吗？** 能。Shopify 从店铺的 `myshopify.com` 域名提供 UCP 目录，所以审计店铺自己的域名时，需要在配置文件中把 `ucp.url` 设为 `https://<shop>.myshopify.com/.well-known/ucp`，把这个域名加入允许访问的主机；Regmark 报告的采集问题会准确说明这一点。在 Shopify 上使用 `--mcp` 会报告 `/api/mcp` 没有目录工具：Shopify 已把这些工具移到了 UCP 之下。[代理端点](docs/configuration.md#the-agent-endpoints)

**报告通过意味着什么？** 意味着样本中的商品在你设定的预算内保持一致。请同时查看采集问题和被跳过的规则：无法读取的来源，也就无从证明它是正确的。`--strict` 会把任何采集问题都变成失败。

**它会把我的数据发到别处吗？** 不会。报告就是你磁盘上的文件。没有遥测，也没有托管服务。

## 项目状态

版本 0.2.0。它能用，但还很年轻，规则接触过的真实店铺不多。

- 超过 1100 个单元测试、类型检查，以及在 Node 22 和 24 上运行的 CI，其中也会运行 Action 本身。
- 一个基准测试，让工具对本仓库中的两家店铺运行。其中一家预设了 27 个缺陷，应当产生 31 条发现；工具报告的正是这 31 条，没有多出别的。另一家没有缺陷，工具什么也没有报告。
- 首次对 11 家公开的 WooCommerce 店铺做只读运行，发现了工具自身的三类误报，三类均已修复。[那次运行的结果](plan/06-prototype.md)。

如果 Regmark 对你的店铺报告了并不存在的问题，把它告诉本项目就是你能做的最有用的事：[报告误报](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml)。

**接下来：** [更多平台](https://github.com/kairwang01/regmark/issues/7) · [在更多主题上识别可见价格](https://github.com/kairwang01/regmark/issues/6) · 基于 UCP 的结账会话 · 一个能逛遍店铺的购物代理，检查它报出的总价是否就是购物车实际收取的总价。

## 参与贡献

[为再多一个主题识别可见价格](https://github.com/kairwang01/regmark/issues/6)是一个小而独立的入门贡献，而[工具在你店铺上的表现](https://github.com/kairwang01/regmark/issues/1)眼下比代码更有价值。新规则从在 fixture 店铺中植入一个缺陷开始；[CONTRIBUTING.md](CONTRIBUTING.md) 会带你走一遍这个流程。

```bash
git clone https://github.com/kairwang01/regmark && cd regmark
pnpm install
node packages/cli/src/bin.ts demo     # 直接从 TypeScript 源码运行 CLI
pnpm test && pnpm bench && pnpm typecheck
```

如果 Regmark 帮你避免了一次商品被拒，或一位困惑的顾客，点一个 ⭐ 能帮助其他店铺发现它。

## 文档

- [快速上手与排错](docs/quickstart.md)
- [配置：全部命令、参数和配置字段](docs/configuration.md)
- [在 CI 中运行](docs/ci.md)
- [每条规则的含义](docs/rules.md)
- [JSON 报告](docs/report-format.md)
- [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [变更日志](CHANGELOG.md)
- [设计笔记与路线图](https://opensource.kairwang.cloud/regmark/)（中文）

## 许可证与托管

Apache-2.0。项目站点托管在腾讯云。

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="腾讯云" height="22"></a>

腾讯云标志是腾讯的商标，不在本许可证的授权范围内，在此仅用于说明托管提供方。

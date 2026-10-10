---
title: 使用说明
slug: usage
nav: 使用说明
summary: 下载并校验固定发布包，运行合成演示，再只读检查自己的店并接进 CI。
---

## 先看一眼它是什么样

需要 Node 22 或更新的版本。在空目录中下载固定版本并验证校验和：

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.2.0/regmark.mjs && \
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.2.0/regmark.mjs.sha256 && \
sha256sum -c regmark.mjs.sha256 && \
node regmark.mjs demo
```

macOS 将校验命令换成 `shasum -a 256 -c regmark.mjs.sha256`。任一步失败，命令链会停止。2026-10-10 检查时 npm 包接口返回 HTTP 404，请使用已校验的发布文件，不要依赖 `npx regmark`。固定发布包不含之后尚未发版的源码修复；需要最新源码时按仓库的[快速上手](https://github.com/kairwang01/regmark/blob/main/docs/quickstart.md#development)运行。

演示仅访问本地合成样板店，无需真实店铺凭据。27 个预设缺陷产生 31 条发现，并生成 `regmark-demo.html`。这不是对真实店铺准确率的测量。演示特意启用了样板店的购物车与 cloaking 检查，普通只读审计不会自动启用。

运行干净的对照样例，并保留第一份报告：

```terminal
$ node regmark.mjs demo --clean --html regmark-clean.html
```

干净样例应有零发现。两个 `demo` 命令都退出 0；CI 门禁请用 `audit`。切换到干净样例不代表修复了真实店铺。

## 检查自己的店

```terminal
$ node regmark.mjs audit https://your-shop.example
```

什么参数都不带时，它做这几件事：

1. 判断店铺用的是什么平台。目前认得 WooCommerce 和 Shopify。
2. 从后台的商品接口里抽 25 件商品。认不出平台时，改从站点地图里找商品页。
3. 读这些商品的页面：人看到的价格和库存、JSON-LD、microdata、Open Graph。
4. 把页面上说的和接口里说的逐项比对，打印结果。

没有 checkout 或 cloaking 配置时，上述流程只做普通只读请求，遵守 robots.txt，默认对同一主机每秒最多发一个请求。耗时取决于请求数量和响应速度；配置中的 checkout 对象即使没有命令行开关也会启用探针，请把只读和探针配置分开。

后续命令从下载目录运行，或给 `node` 提供 `regmark.mjs` 的完整路径。

## 给它更多可比的东西

**商品 feed。** 这是最容易过期的一处，建议总是带上：

```terminal
$ node regmark.mjs audit https://your-shop.example --feed /feeds/google.xml
```

feed 的地址可以是相对店铺的路径，也可以是完整网址。支持 Google Merchant 的 RSS、Atom 和制表符分隔三种格式。

**feed 的新鲜度。** 今天碰巧没错、但已经九天没更新的 feed，明天就会错。告诉工具它最多可以多旧，超过了就报：

```terminal
$ node regmark.mjs audit https://your-shop.example --feed /feeds/google.xml --max-age feed=24h
```

**购物代理直接读的那几处。** 店铺如果提供了 UCP 目录、店铺 MCP 服务或 ACP 商品 feed，把它们也读进来比。三者都只读：

```terminal
$ node regmark.mjs audit https://your-shop.example --ucp --mcp --acp-feed /feeds/acp.jsonl.gz
```

`--ucp` 从 `/.well-known/ucp` 找到店铺的 UCP 目录，`--mcp` 向店铺的 MCP 服务查询同一批商品，`--acp-feed` 读一份 ACP 格式的商品 feed。它们说的价格和库存，会和别的出口一样被拿去同基准比对。

**结账实算。** 只有把商品真的放进购物车，才知道实际收多少。这一步支持 WooCommerce 和 Shopify，并且要先证明店是你的，见下一节。

```terminal
$ REGMARK_OWNERSHIP_TOKEN=你的令牌 node regmark.mjs audit https://your-shop.example \
    --feed /feeds/google.xml --checkout --ship-to US:94103
```

在 WooCommerce 上，探针读出含运费和税的总价。在 Shopify 上，税要到结账那一步才算得出来，所以探针读的是购物车收不收这件商品、这一行的价格，以及寄到目的地最便宜的运费，不给出到手总价；Shopify 店铺请加上 `--platform shopify`。

**对代理和对人说的是不是一样。** 加上 `--cloaking`，工具会把抽到的每个页面分别以浏览器和购物代理的身份再读一遍，比的是两边被告知的价格和库存，不是网页源码。这一步要冒充别的客户端，所以同样要先证明店是你的。

```terminal
$ REGMARK_OWNERSHIP_TOKEN=你的令牌 node regmark.mjs audit https://staging.your-shop.example --cloaking
```

**指定页面。** 若只查指定页面而不采样平台目录，使用 `--platform none`：

```terminal
$ node regmark.mjs audit https://your-shop.example --platform none --page /product/blue-tee/ --page /product/tote/
```

## 证明店是你的

读公开页面不需要谁同意。结账探针不一样：它会往购物车里放一件商品，填一个收货地，读出价格，再清空购物车。这是在往店里写数据。伪装检查则要以别的客户端的身份去读页面。这两件事都必须先证明你管得了这家店。

1. 自己选一个令牌，16 到 128 位，字母、数字、下划线或连字符。
2. 让店铺在 `/.well-known/regmark.txt` 这个地址返回一行：`regmark-verify=你的令牌`。不方便放文件的话，在 `_regmark.你的域名` 加一条内容相同的 TXT 记录也可以。
3. 运行时通过环境变量 `REGMARK_OWNERSHIP_TOKEN` 把同一个令牌交给工具。

没有任何参数可以跳过这一步。探针不会走到支付，每查完一件商品就清空购物车，清不掉的话会明确报出来。有预发布环境时，建议让探针跑在预发布环境上。

## 看懂输出

```terminal
  your-shop.example    48 variants    1m 12s
  C page jsonld opengraph    M feed    Y –    K platform checkout

  ✗ price.mismatch              2 findings
      TEE-BLU-M    C jsonld 45.00 USD  ≠  K checkout 39.00 USD
                   https://your-shop.example/product/tee/#jsonld[0]/offers/1/price
      TOTE-NAT     M feed 22.00 USD  ≠  K checkout 24.00 USD
                   https://your-shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price
  ! shipping.undisclosed        6 findings
      …
  ✓ 12 rules passed

  2 errors, 6 warnings. 1 rule over budget.
```

- **第二行**是这次读了哪些出口，按四块色版归类：C 是商品页，M 是 feed，Y 是购物代理直接读的出口（UCP 目录、MCP 服务、ACP feed），K 是店铺自己（后台接口和结账）。某块版后面是横线，说明这类出口这次没读；上面这个例子没带 `--ucp`、`--mcp`、`--acp-feed`，所以 Y 是空的。
- **每条发现**左边是哪个规格，中间是「哪个出口说了什么」，`≠` 右边是被相信的那一方说了什么，下一行是错的那个值具体在哪：网址加上页面里的位置。
- **行首的记号**：`✗` 是错误级，`!` 是警告，`i` 是提示，`✓` 是通过。
- **最后一行**是总数，以及有几条规则超出了预算。

想知道某一类问题通常是怎么来的、该去哪里改：

```terminal
$ node regmark.mjs explain price.mismatch
```

## 留下报告

终端里的摘要之外，还可以写出文件，可以同时要几种：

| 参数 | 写出什么 | 适合 |
|---|---|---|
| `--html report.html` | 单个 HTML 文件，不带脚本，不依赖外部资源 | 发给同事或客户 |
| `--json report.json` | 全部数据，带格式版本号（现在是 `regmark.audit/v0`，1.0 之前可能调整） | 自己再加工 |
| `--markdown report.md` | GitHub 风格的 Markdown | 贴进合并请求的评论 |
| `--sarif report.sarif` | SARIF 2.1.0 | GitHub 的代码扫描界面 |
| `--junit report.xml` | JUnit XML | GitLab、Jenkins 等 |

## 预算：已经有一堆问题的店怎么开始

错误级的规则默认一条都不许有，警告和提示不会让检查失败。一家运营多年的店第一次跑，多半会有存量问题，一上来就全红没法用。

做法是先把现状记下来，以后只许变少：

```terminal
$ node regmark.mjs audit https://your-shop.example --budget price.mismatch=7 --budget variant.missing=31
```

或者写进配置文件。`node regmark.mjs init https://your-shop.example` 会在当前目录生成一个 `regmark.config.json`，在里面加上：

```json
{
  "store": "https://your-shop.example",
  "feed": "/feeds/google.xml",
  "sample": 50,
  "budget": {
    "price.mismatch": 7,
    "variant.missing": 31
  }
}
```

当前目录下有这个文件时，直接运行 `node regmark.mjs audit` 就会读它。把它提交进仓库，每修掉一批就把数字往下调。

退出码：0 是全部在预算内，1 是有规则超出预算，2 是检查没能跑起来，或者一件商品都没读到。后一种情况不会被算成通过：预发环境挂了，构建应该红，而不是绿。

默认情况下，某一个出口没读成（比如 feed 地址 404）只会记成一条「采集问题」，其余照常比对。想让任何一个出口读不成都算失败，加上 `--strict`，这时退出码也是 2。

## 接进 GitHub Actions

```yaml
# .github/workflows/regmark.yml
name: regmark
on:
  pull_request:
  schedule:
    - cron: '17 3 * * *'

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
          budget: |
            price.mismatch=7
            variant.missing=31
```

有规则超出预算时任务失败。发现的问题直接显示在任务摘要里；带上 `comment: 'true'` 时，还会贴成合并请求里的一条评论，之后每次运行更新同一条，不会刷屏。HTML、JSON、SARIF、Markdown 四份报告会作为产物保存。合并请求里建议指向预发布环境，定时任务指向线上。

`@v0` 会跟着 0.x 的最新版本走；想让构建永远不变，就钉死成 `@v0.2.0`。

要跑结账探针或伪装检查，把令牌存成仓库的 secret，再加上：

```yaml
          checkout: 'true'
          cloaking: 'true'
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
```

读代理出口的三个开关是 `ucp: 'true'`、`mcp: 'true'` 和 `acp-feed: /feeds/acp.jsonl.gz`。

别的 CI 系统直接运行命令、看退出码就行，GitLab 的写法见仓库里的 `examples/gitlab-ci.yml`。

## 常见问题

**会不会影响店铺负载？** 工具会限速，但不能保证对所有店铺都没有影响；建议先在预发布环境小样本测试。对同一个主机每秒最多一个请求，默认只抽 25 件商品。购物车探针碰到店铺的防护拦截时，会清空购物车并停下，不重试。

**需要大模型的密钥吗？** 不需要。17 条规则全是确定性的比对，同样的输入永远给出同样的结果，也没有任何费用。

**会把我的数据传到哪里去吗？** 不会。工具只访问你指定的店铺，没有遥测，报告写在你本机。

**Shopify 支持到什么程度？** 能读公开的商品接口，和页面、feed、代理出口逐个规格比对；验证归属之后，能用购物车探针核对价格和运费，但读不到含税的到手总价。另外，Shopify 对来自云服务器和 VPN 网络的自动访问拦得比较多，CI 的机器正好在这类网络里，所以探针在 CI 里可能被拦下；被拦时它会如实记成一条采集问题。

**报了一条明明没问题的，怎么办？** 这是这个项目最想知道的事。到仓库里按「False alarm」模板提一个 issue，贴上那条发现和实际情况。

**报的问题确实存在，但我现在不打算修。** 给那条规则设预算，或者用 `--budget 规则名=数量` 放行当前的数量。

**为什么有的规则显示被跳过？** 有些规则需要特定的出口。没开结账探针时，比运费的规则就没有可比的基准，会注明「needs checkout」；没给 `--max-age` 时，查 feed 新鲜度的规则也会注明自己被跳过。

全部参数和配置项见仓库里的 [docs/configuration.md](https://github.com/kairwang01/regmark/blob/main/docs/configuration.md)，每条规则的精确定义见 [docs/rules.md](https://github.com/kairwang01/regmark/blob/main/docs/rules.md)。两份文档是英文的。

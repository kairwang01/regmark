---
title: 使用说明
slug: usage
nav: 使用说明
summary: 从十秒钟的演示，到检查自己的店，再到接进 CI。每一步给出命令，以及跑完之后你会看到什么。
---

## 先看一眼它是什么样

需要 Node 22 或更新的版本。不用安装，一条命令：

```terminal
$ npx github:kairwang01/regmark demo
```

这会检查工具自带的一家小店。店里事先埋了 19 个毛病，都是真实店铺里常见的：feed 里还是上周的价格，JSON-LD 只列了三个尺码里的一个，写着包邮但购物车照收运费。两秒钟后你会在终端里看到完整的结果，当前目录下多出一个 `regmark-demo.html`，那是可以直接打开、也可以发给同事的报告。

想看「一切正常」是什么样，加上 `--clean`：

```terminal
$ npx github:kairwang01/regmark demo --clean
```

## 检查自己的店

```terminal
$ npx github:kairwang01/regmark audit https://your-shop.example
```

什么参数都不带时，它做这几件事：

1. 判断店铺用的是什么平台。目前认得 WooCommerce 和 Shopify。
2. 从后台的商品接口里抽 25 件商品。认不出平台时，改从站点地图里找商品页。
3. 读这些商品的页面：人看到的价格和库存、JSON-LD、microdata、Open Graph。
4. 把页面上说的和接口里说的逐项比对，打印结果。

整个过程只读不写，遵守 robots.txt，对同一个主机每秒最多发一个请求，所以 25 件商品大约要一分钟。终端里会显示它正在做哪一步。

经常用的话，装到全局更方便：

```terminal
$ npm install -g github:kairwang01/regmark
$ regmark audit https://your-shop.example
```

## 给它更多可比的东西

**商品 feed。** 这是最容易过期的一处，建议总是带上：

```terminal
$ regmark audit https://your-shop.example --feed /feeds/google.xml
```

feed 的地址可以是相对店铺的路径，也可以是完整网址。支持 Google Merchant 的 RSS、Atom 和制表符分隔三种格式。

**结账实算。** 只有把商品真的放进购物车，才知道运费和税是多少。这一步目前支持 WooCommerce，并且要先证明店是你的，见下一节。

```terminal
$ REGMARK_OWNERSHIP_TOKEN=你的令牌 regmark audit https://your-shop.example \
    --feed /feeds/google.xml --checkout --ship-to US:94103
```

**指定页面。** 只想查某几个商品：

```terminal
$ regmark audit https://your-shop.example --page /product/blue-tee/ --page /product/tote/
```

## 证明店是你的

读公开页面不需要谁同意。结账探针不一样：它会往购物车里放一件商品，填一个收货地，读出总价，再清空购物车。这是在往店里写数据，所以必须先证明你管得了这家店。

1. 自己选一个令牌，16 位以上，字母、数字、下划线或连字符。
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

- **第二行**是这次读了哪些出口，按四块色版归类：C 是商品页，M 是 feed，Y 是协议端点，K 是店铺自己（后台接口和结账）。某块版后面是横线，说明这类出口这次没读到。
- **每条发现**左边是哪个规格，中间是「哪个出口说了什么」，`≠` 右边是被相信的那一方说了什么，下一行是错的那个值具体在哪：网址加上页面里的位置。
- **行首的记号**：`✗` 是错误级，`!` 是警告，`i` 是提示，`✓` 是通过。
- **最后一行**是总数，以及有几条规则超出了预算。

想知道某一类问题通常是怎么来的、该去哪里改：

```terminal
$ regmark explain price.mismatch
```

## 留下报告

终端里的摘要之外，还可以写出文件，可以同时要几种：

| 参数 | 写出什么 | 适合 |
|---|---|---|
| `--html report.html` | 单个 HTML 文件，不带脚本，不依赖外部资源 | 发给同事或客户 |
| `--json report.json` | 全部数据，结构稳定并带版本号 | 自己再加工 |
| `--markdown report.md` | GitHub 风格的 Markdown | 贴进合并请求的评论 |
| `--sarif report.sarif` | SARIF 2.1.0 | GitHub 的代码扫描界面 |
| `--junit report.xml` | JUnit XML | GitLab、Jenkins 等 |

## 预算：已经有一堆问题的店怎么开始

错误级的规则默认一条都不许有，警告和提示不会让检查失败。一家运营多年的店第一次跑，多半会有存量问题，一上来就全红没法用。

做法是先把现状记下来，以后只许变少：

```terminal
$ regmark audit https://your-shop.example --budget price.mismatch=7 --budget variant.missing=31
```

或者写进配置文件。`regmark init https://your-shop.example` 会在当前目录生成一个 `regmark.config.json`，在里面加上：

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

当前目录下有这个文件时，直接运行 `regmark audit` 就会读它。把它提交进仓库，每修掉一批就把数字往下调。

退出码：0 是全部在预算内，1 是有规则超出预算，2 是检查没能跑起来，或者一件商品都没读到。后一种情况不会被算成通过：预发环境挂了，构建应该红，而不是绿。

## 接进 GitHub Actions

```yaml
# .github/workflows/regmark.yml
name: regmark
on:
  pull_request:
  schedule:
    - cron: '17 3 * * *'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
          budget: |
            price.mismatch=7
            variant.missing=31
```

有规则超出预算时任务失败。发现的问题直接显示在任务摘要里，HTML、JSON、SARIF、Markdown 四份报告会作为产物保存。合并请求里建议指向预发布环境，定时任务指向线上。

要跑结账探针，把令牌存成仓库的 secret，再加两行：

```yaml
          checkout: true
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
```

别的 CI 系统直接运行命令、看退出码就行，GitLab 的写法见仓库里的 `examples/gitlab-ci.yml`。

## 常见问题

**会不会把我的店打挂？** 不会。每秒最多一个请求，默认只抽 25 件商品，遇到限流或拒绝就停，不重试。

**需要大模型的密钥吗？** 不需要。15 条规则全是确定性的比对，同样的输入永远给出同样的结果，也没有任何费用。

**会把我的数据传到哪里去吗？** 不会。工具只访问你指定的店铺，没有遥测，报告写在你本机。

**Shopify 支持到什么程度？** 目前能读公开的商品接口，和页面上的结构化数据逐个规格比对。结账探针还没做。另外，Shopify 会拒绝一部分云服务器的访问，在自己的电脑或自己的 CI 里跑一般没有问题。

**报了一条明明没问题的，怎么办？** 这是这个项目最想知道的事。到仓库里按「False alarm」模板提一个 issue，贴上那条发现和实际情况。

**报的问题确实存在，但我现在不打算修。** 给那条规则设预算，或者用 `--budget 规则名=数量` 放行当前的数量。

**为什么有的规则显示被跳过？** 有些规则需要特定的出口。没开结账探针时，比运费的两条规则就没有可比的基准，会注明「needs checkout」。

全部参数和配置项见仓库里的 [docs/configuration.md](https://github.com/kairwang01/regmark/blob/main/docs/configuration.md)，每条规则的精确定义见 [docs/rules.md](https://github.com/kairwang01/regmark/blob/main/docs/rules.md)。两份文档是英文的。

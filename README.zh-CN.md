<p align="center">
  <img src="docs/assets/hero.png" alt="Regmark：四个出口印出四个不同的价格，套不准；都向结账对齐之后，印成一个清楚的数" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-21355c"></a>
  <img alt="Node 22 及以上" src="https://img.shields.io/badge/node-%E2%89%A5%2022-21355c">
  <img alt="15 条规则" src="https://img.shields.io/badge/rules-15-21355c">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/README-English-c2256e"></a>
</p>

# Regmark

**检查你的店对机器说的话，和结账时实际收的钱，是不是一回事。**

同一件商品的价格、库存和运费，一家店会在好几个地方各说一遍：商品页、页面里的 JSON-LD、Open Graph 标签、商品 feed、店铺后台接口。人只看得到其中一处，Google、比价网站和 AI 购物代理读的是另外几处，而没有任何东西保证它们一致。Regmark 把这些地方全读一遍，按商品的每个规格对齐，哪一处和最终决定买家付多少钱的那一处对不上，就报出来。

不用注册，不用密钥，不用服务器。它读你的店，然后把看到的打印出来。

## 十秒钟看懂

```bash
npx --allow-git=all github:kairwang01/regmark demo
```

这条命令会检查工具自带的一家小店。店里事先埋了 19 个毛病：feed 里还是上周的价格，JSON-LD 只列了三个尺码里的一个，写着包邮但购物车照收运费。

<p align="center"><img src="docs/assets/terminal.png" alt="regmark demo 的终端输出：price.mismatch 三条，每条写着该出口的值、结账的值，以及错的那个值在哪" width="880"></p>

它还会写出一个 `regmark-demo.html`，单个文件，可以直接打开，也可以发给同事。标题就是结论：各处对不上时，标题像套印不准的印张那样重影；对得上时，印得干干净净。

<p align="center">
  <img src="docs/assets/report-out-of-register.png" alt="标题为 Out of register 的 HTML 报告，字带着青、品红、黄三色重影" width="49%">
  <img src="docs/assets/report-in-register.png" alt="标题为 In register 的 HTML 报告，字迹清楚" width="49%">
</p>

只需要 Node 22 或更新的版本。`--allow-git=all` 是给 npm 12 准备的：从这一版起，npm 默认不再从 git 取包，旧版 npm 不需要它。也可以完全不用 npm，整个工具就是一个文件：

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/latest/download/regmark.mjs
node regmark.mjs demo
```

## 检查自己的店

```bash
npx --allow-git=all github:kairwang01/regmark audit https://your-shop.example
```

什么参数都不带时，它会自己判断店铺用的是什么平台，抽 25 件商品，读它们的页面和后台接口，然后比对。整个过程只读不写，遵守 robots.txt，每秒最多发一个请求。

给它的东西越多，它能比的就越多。下面的 `regmark` 指你选的那种运行方式；用 `npm install -g --allow-git=all github:kairwang01/regmark` 可以把它装成一条命令。

```bash
# 加上商品 feed，这是最容易过期的一处
regmark audit https://your-shop.example --feed /feeds/google.xml

# 加上购物车的实算总价，运费和税也能查（WooCommerce）
REGMARK_OWNERSHIP_TOKEN=… regmark audit https://your-shop.example --feed /feeds/google.xml --checkout

# 留一份报告
regmark audit https://your-shop.example --html report.html
```

`regmark explain <规则名>` 会告诉你这类问题通常是怎么来的、该去哪里改。全部参数见[配置说明](docs/configuration.md)。

## 为什么要做这个

这件事 Google Merchant Center 已经在替你查了。它拿 feed 里的价格去比落地页和结构化数据，要求[完全一致](https://support.google.com/merchants/answer/12159029)，对不上的商品直接拒登；结账页的价格比商品页高，[账号会被警告或封停](https://support.google.com/merchants/answer/10330822)。而你是事后才从 Google 那里知道的，一次知道一件。

现在来读这些数据的不只是 Google。AI 购物代理报给用户的是结构化数据里的数，用户付的是结账页上的数。两个数不一样，这一单和这个用户的信任就都没了，而且没有任何报表会告诉你原因。

Regmark 把这个比对提到前面来做：所有出口一起比，查到差异可以让构建失败。

## 它能查出什么

| 规则 | 级别 | 查的是什么 |
|---|---|---|
| `price.mismatch` | 错误 | 某一处标的价格，结账时并不是这个数 |
| `price.currency-ambiguous` | 错误 | 给机器读的价格没写币种，或者币种不对 |
| `price.tax-basis` | 警告 | 两个价格正好差一个增值税或消费税税率 |
| `price.sale-expired` | 警告 | 促销截止日期已经过了，但收的还是促销价 |
| `availability.mismatch` | 错误 | 一处说有货，店里实际售罄，或者反过来 |
| `variant.missing` | 错误 | 结构化数据只列了一部分规格 |
| `variant.unpurchasable` | 错误 | 处处都说能买，购物车却加不进去 |
| `shipping.mismatch` | 错误 | 标称的运费和结账收的不一样 |
| `shipping.undisclosed` | 警告 | 运费要走到结账才知道 |
| `identity.unmatched` | 警告 | feed 里还挂着店里已经不卖的东西 |
| `identity.gtin-invalid` | 警告 | 条码校验位不对，或者两个规格共用一个条码 |
| `policy.return-missing` | 提示 | 没有机器读得懂的退货政策 |
| `content.hidden-text` | 警告 | 留在页面里、却存心不让人看见的文字 |
| `content.instruction-like` | 错误 | 写给语言模型看、而不是写给顾客看的商品文字 |
| `content.invisible-chars` | 警告 | 夹带看不见内容的零宽字符和 Unicode 标签字符 |

每条规则什么时候报、什么时候不报，[docs/rules.md](docs/rules.md) 里有精确的定义。后者写得和前者一样仔细。

## 它读哪些地方

这些出口按印刷分色的办法归成四块版。印刷时黑版是其余色版对齐的基准，所以它的代号是 K，取自 key。在这里，结账就是那块黑版。

| 色版 | 出口 | 支持情况 |
|---|---|---|
| **C** | 商品页：可见的价格和库存、JSON-LD、microdata、Open Graph | 已支持 |
| **M** | 商品 feed：Google 的格式，RSS、Atom 或制表符分隔 | 已支持 |
| **Y** | 代理协议端点：UCP、ACP、MCP | 计划中 |
| **K** | 店铺本身：后台商品接口，以及真实购物车算出的总价 | WooCommerce 完整支持；Shopify 只读商品接口 |

以谁为准是明确规定的：先信结账，其次信后台接口，最后信人能看到的页面。JSON-LD、feed 和协议端点永远不被当作基准，它们是被检查的对象。

## 接进 CI

```yaml
# .github/workflows/regmark.yml
on: pull_request
jobs:
  regmark:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
```

有规则超出预算时，这个任务会失败。发现的问题写在任务摘要里，HTML、JSON、SARIF、Markdown 四份报告作为产物保存。错误级的规则默认一条都不许有，警告不会让构建失败。店里已经有一批存量问题的话，先把每条规则的预算设成当前的数量，以后只许降不许升。GitLab 的写法和 SARIF 上传见 [CI 说明](docs/ci.md)。

报告有终端摘要，以及 `--html`、`--json`、`--sarif`、`--junit`、`--markdown` 五种文件。退出码：0 是在预算内，1 是超出预算，2 是检查没能跑起来，或者一件商品都没读到。店挂了的时候构建会失败，不会被算成通过。

## 结账探针

读公开页面不需要谁同意。结账探针不一样：它会往购物车里放一件商品，填一个收货地，读出总价，再清空购物车。这是在往店里写数据，所以必须先证明这家店是你的。

1. 选一个 16 位以上的字母数字串当令牌。
2. 在 `/.well-known/regmark.txt` 里放一行 `regmark-verify=<令牌>`，或者在 `_regmark.<你的域名>` 加一条内容相同的 TXT 记录。
3. 运行时带上 `REGMARK_OWNERSHIP_TOKEN=<令牌>` 和 `--checkout`。

没有任何参数可以跳过这一步。探针不会走到支付，每查完一件就清空购物车，清不掉会明确报出来。

## 它在别人的站上怎么行事

- 只访问你指定的主机，不跟随跳到别处的重定向和链接。
- 遵守 robots.txt，请求之间隔一秒。
- 拒绝访问解析到内网地址的主机。在公司内网里检查一家不怀好意的店，对方没法借这次检查去打你的内网。
- 响应大小有上限，按解压后的字节算。
- 从店铺读到的一切，在每一种报告格式里都当作不可信内容处理。
- 不向任何地方上报任何数据。

## 和别的工具比

| | 查什么 | 不查什么 |
|---|---|---|
| Google Merchant Center 的诊断 | feed 和页面是否一致，限于已提交的商品 | 发布之前；其他出口；你的 CI |
| 富媒体结果测试、schema 校验器 | 一个页面的标记格式对不对 | 里面的值是不是真的 |
| UCP 和 feed 校验器 | 端点或文件的形状合不合规范 | 里面的值和别处对不对得上 |
| 页面级的「AI 就绪度」打分 | 机器能从一个页面读到多少 | 读到的和 feed、和结账是否一致 |
| **Regmark** | 每个出口、每个规格是否和结账一致 | 超出读取需要的标记合规性；排名和曝光 |

## 现在的状态

版本 0.1.0。能用，还很新，它的规则见过的真实店铺不多。

- 近 700 项单元测试，外加类型检查。
- 一个基准：拿仓库里的两家样板店量工具本身。一家埋了 19 个缺陷，应当报 22 条，工具报出的正是这 22 条，没有多报；另一家没有缺陷，工具一条不报。
- 第一次对 11 家公开的 WooCommerce 店做只读检查时，查出了工具自己的三类误报，都已修掉。[那次实测说明了什么，说明不了什么](plan/06-prototype.md)。

如果 Regmark 在你的店上报了一条其实没问题的东西，这是你能告诉这个项目的最有用的一件事：[报告一条误报](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml)。

**接下来：** 把 UCP 和 ACP 端点接成第四块版；Shopify 的结账探针；Magento 和 Medusa；feed 新鲜度；一个真的把店走一遍的购物代理，核对它报给用户的总价是不是购物车算出来的那个数。

## 文档

- [配置和全部参数](docs/configuration.md)（英文）
- [在 CI 里运行](docs/ci.md)（英文）
- [每条规则的定义](docs/rules.md)（英文）
- [JSON 报告的格式](docs/report-format.md)（英文）
- [参与贡献](CONTRIBUTING.md)：新规则从在样板店里埋一个缺陷开始
- [设计思路、选型和路线图](https://opensource.kairwang.cloud/regmark/)（中文）

## 托管

项目站点运行在腾讯云上。

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="Tencent Cloud" height="22"></a>

## 许可证

Apache-2.0。腾讯云的标志是腾讯的商标，不在本许可证的范围内，放在这里只是为了注明托管方。

---
title: 原型与实测
slug: prototype
nav: 原型与实测
summary: 现在是 0.2.0。用预置缺陷的样板店量过，第一个版本也在真实店铺上试过一次。结果和它说明不了的事，都写在这里。
---

## 做到哪了

2026 年 10 月 9 日有了第一个能跑的版本，当天整理成 0.1.0。现在是 0.2.0，源码在 [GitHub](https://github.com/kairwang01/regmark) 上，下载并校验固定的 GitHub 发布包后，可用 `node regmark.mjs demo` 试用。2026-10-10 检查时 npm 包接口返回 404。怎么用见[使用说明](07-usage.md)。

| 模块 | 状态 | 说明 |
|---|---|---|
| 商品页采集 | 已实现 | 可见价格和库存、JSON-LD、microdata、Open Graph、商品文本 |
| feed 采集 | 已实现 | Google Merchant 格式的 RSS、Atom 和制表符分隔文本，并记下 feed 自己说的生成时间 |
| WooCommerce | 已实现 | 商品接口和结账探针 |
| Shopify | 已实现 | 公开的商品接口，和购物车探针。探针读得到这一行的价格和最便宜的运费，读不到含税的到手总价 |
| 代理直接读的出口 | 0.2.0 新增，只读 | UCP 目录、店铺 MCP 服务、ACP 商品 feed。UCP 的结账会话还没做 |
| 事实表与身份对齐 | 已实现 | |
| 规则 | 17 条 | 13 条套准，4 条内容卫生。0.2.0 新增 `availability.stale` 和 `content.cloaking` |
| 报告 | 已实现 | 终端、JSON、SARIF、JUnit、Markdown、单文件 HTML。每条规则附带通常的原因和修法 |
| 命令行 | 已实现 | `audit`、`demo`、`explain`、`rules`、`init`，自动识别平台，预算，退出码，`--strict` |
| 归属验证 | 已实现 | 站点文件或 DNS 记录。结账探针和伪装检查都要先过这一关 |
| 探店代理 | 没开始 | |
| GitHub Action | 已实现 | 结果写进任务摘要，可以贴成合并请求里的一条评论，报告存为产物 |

源码约 12,700 行，测试约 12,800 行，共 1155 项单元测试，全部通过。

## 报告长什么样

<!-- figure:reports -->

终端里是下面这样。这是 0.2.0 对错版店跑出来的真实输出，只把本机地址换成了 `shop.example`，中间省略了几段。

```terminal
  shop.example    20 variants    0s
  C page jsonld opengraph    M feed    Y acp ucp mcp    K platform checkout

  ✗ price.mismatch              5 findings
      TOTE-NAT     M feed 22.00 USD  ≠  K checkout 24.00 USD
                   https://shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price
      TEE-BLU-M    C jsonld 45.00 USD  ≠  K checkout 39.00 USD
                   https://shop.example/product/classic-tee/#jsonld[0]/hasVariant/1/offers/price
      enamel-mug   C opengraph 14.00 USD  ≠  K checkout 16.00 USD
                   https://shop.example/product/enamel-mug/#meta[property="product:price:amount"]
      SOCK-M       Y acp 10.00 USD  ≠  K checkout 12.00 USD
                   https://shop.example/feeds/acp.jsonl.gz#item[id="SOCK-M"]/price
      SOCK-M       Y ucp 11.00 USD  ≠  K checkout 12.00 USD
                   https://shop.example/ucp/v1/catalog/lookup#lookup_catalog[id="402"]/products/3/variants/1/price
  …
  ✗ availability.mismatch       4 findings
      SOCK-L       C jsonld in_stock  ≠  K platform out_of_stock
                   https://shop.example/product/trail-socks/#jsonld[0]/hasVariant/2/offers/availability
      BEANIE-NVY   Y acp in_stock  ≠  K platform out_of_stock
                   https://shop.example/feeds/acp.jsonl.gz#item[id="BEANIE-NVY"]/availability
      BEANIE-NVY   M feed in_stock  ≠  K platform out_of_stock
                   https://shop.example/feeds/google.xml#item[id="BEANIE-NVY"]/availability
      BEANIE-NVY   Y mcp in_stock  ≠  K platform out_of_stock
                   https://shop.example/api/mcp#lookup_catalog[id="302"]/result/structuredContent/products/2/variants/1/availability
  ! availability.stale          1 finding
      canvas-tote   feed was generated 9 days before the audit, longer ago than its maxAge of 24 hours; every item in it is that old
                    https://shop.example/feeds/google.xml#/rss/channel/lastBuildDate
  …

  20 errors, 10 warnings, 1 note. 8 rules over budget.
```

每一行开头的 C、M、Y、K 是色版：这条说法来自哪一类出口。`≠` 右边永远是被相信的那一方。

## 用样板店量工具本身

仓库里带着两家很小的假店，卖同样的 10 件商品、19 个变体。对照店的每个出口都和结账一致。错版店在它的基础上埋了 27 个缺陷（0.1.0 时是 19 个），每个缺陷只让一个出口说错一件事，并且事先写明它应当被哪条规则、在哪个变体、哪个出口上报出来，一共 31 条。

| 量的是什么 | 结果 | 门槛 |
|---|---|---|
| 错版店：应报 31 条，报出几条 | 31 条 | 路线图定的是至少九成，现在的检查要求全中 |
| 错版店：报了几条不该报的 | 0 条 | |
| 对照店：报了几条 | 0 条 | 0 条 |
| 结账探针跑完，店里还留着几个有货的购物车 | 0 个 | 0 个 |
| 不给归属令牌时，发出几个写请求 | 0 个 | 0 个 |

埋的缺陷都是真实店铺里常见的毛病：

| 缺陷 | 应当由谁报 |
|---|---|
| JSON-LD 给的是原价，实际按促销价收 | `price.mismatch` |
| feed 里还是上周的价格 | `price.mismatch` |
| og:price 标签是旧值 | `price.mismatch` |
| feed 写有货，实际售罄 | `availability.mismatch` |
| JSON-LD 写有货，实际售罄 | `availability.mismatch` |
| JSON-LD 只列了三个尺码里的第一个 | `variant.missing` |
| JSON-LD 有价格，没有币种 | `price.currency-ambiguous` |
| og 标签的币种写成了加元 | `price.currency-ambiguous` |
| JSON-LD 说促销几个月前就结束了，可现在收的还是促销价 | `price.sale-expired` |
| feed 写包邮，结账收了运费 | `shipping.mismatch` |
| 运费只有走到结账才知道 | `shipping.undisclosed` |
| feed 给两个变体写了同一个条码 | `identity.gtin-invalid` |
| JSON-LD 里的条码校验位不对 | `identity.gtin-invalid` |
| feed 里还挂着一件页面已经下掉的商品 | `identity.unmatched` |
| 所有出口都说能买，购物车拒绝加入 | `variant.unpurchasable` |
| 描述里藏了一段堆关键词的隐藏文字 | `content.hidden-text` |
| 一条评论是写给语言模型看的 | `content.instruction-like` |
| 描述里夹着看不见的 Unicode 字符 | `content.invisible-chars` |
| 没有任何出口给出退货政策 | `policy.return-missing` |
| feed 自己说是九天前生成的，导出任务早就停了 | `availability.stale` |
| ACP feed 里还是旧价格，购物车收得更多 | `price.mismatch` |
| ACP feed 告诉代理有货，实际售罄 | `availability.mismatch` |
| UCP 目录里还是上个月的价格 | `price.mismatch` |
| 店铺的 MCP 服务告诉代理有货，实际售罄 | `availability.mismatch` |
| UCP 目录只列了三个尺码里的一个 | `variant.missing` |
| 同一个页面，给自称购物代理的客户端的 JSON-LD 价格，比给浏览器的低 | `content.cloaking` |
| 一条只给购物代理看的评论，是写给它们而不是写给顾客的 | `content.instruction-like` |

这个基准放在每次提交都跑的检查里。以后每加一条规则，先在错版店里埋一个对应的缺陷。

要说清楚的一点：样板店是我自己写的，工具也是我自己写的。它能证明规则按定义工作、没有互相打架，证明不了规则的定义符合真实世界。后一件事要靠下面这一节。

## 在真实店铺上试了一次

10 月 9 日，用当天的第一个版本对一批公开的 WooCommerce 店铺跑了只读检查：读它们公开的商品接口，再各读 5 个商品页，拿页面上说的和接口说的比。只发读请求，遵守 robots.txt，每个主机每秒最多一次，不碰购物车，不读 feed。

一共试了 16 家。5 家没读成：两家回了限流或拒绝，一家服务器报错，一家跳到了别的域名，一家在 robots.txt 里禁止抓取接口。每一种情况工具都停了下来，没有重试。

剩下 11 家，55 件商品，125 个变体：

| 发现 | 数量 | 涉及店铺 |
|---|---|---|
| 页面标签说的库存状态，和商品接口说的相反 | 2 条 | 2 家 |
| JSON-LD 里的价格没有可用的币种，原因是 `priceSpecification` 的结构写坏了 | 2 条 | 1 家 |
| 页面和 JSON-LD 的价格，正好比接口的价格低一个消费税税率 | 10 条 | 1 家 |
| 没有机器可读的退货政策 | 55 件商品全部 | 11 家全部 |

第一类和第二类是真的对不上，原始数据核对过。第三类两边都没错：那家店在澳洲，对海外访客显示不含税价，接口给的是含税价。它不算错误，但代理读到一个数、付的是另一个数，所以保留为警告。

## 实测教会的三件事

第一遍跑完时，报出来的问题比上表多得多，而且大部分是工具自己的毛病。这三类误报，样板店一条都量不出来：

1. **把税差当成了价差。** 上面那家澳洲店的 5 件商品，一开始全被报成价格错误。现在两个数正好差一个标准税率时，归到单独的 `price.tax-basis`，级别是警告。美元和加元不适用这条，因为那里的标价从来不含税。
2. **没认出 JSON-LD 说的是哪件商品。** WooCommerce 在商品没填 SKU 时，会把后台的商品编号写进 JSON-LD 的 `sku`；多规格商品则常常只写一条报价，带的是父商品的 SKU。这两种写法工具都没和接口里的商品对上，于是报了 12 条「页面列了店里没有的商品」。现在前一种能对上，后一种按「这是在说整件商品」来比。
3. **把轮播里没轮到的幻灯片当成了隐藏文字。** 一家店的评价轮播被报了 4 次。现在只有两种情况才报：用的是界面上没有正当用途的隐藏手法，比如文字和背景同色、字号为零；或者用的是普通手法，但藏的内容是在反复堆砌商品名。

三处都改了，各自补了测试。改完重跑，上表里没有一条是误报。

## 这次实测说明不了什么

- **说明不了这些问题有多普遍。** 11 家店是随手凑的样本，都是 WooCommerce，都是肯让一台云服务器读接口的店。
- **最该测的两块没测到。** 商品 feed 不公开，结账探针要店主授权。feed 滞后和运费对不上，恰恰是预期中最常出问题的地方，从外面量不了。这也是这个工具应当由店主自己来跑的原因。
- **Shopify 没测成。** Shopify 的边缘网络对云服务器的地址直接回 429。工具不绕过拒绝，所以这台机器上做不了 Shopify 的样本。0.2.0 新增的 Shopify 购物车探针，以及 UCP、MCP、ACP 三类出口，目前拿得出的证据只有样板店上的基准，还没有一次真实店铺上的实测记录。
- **不能用它来证明市场需要这个工具。** 它只证明了工具在真实店铺上能跑、会在该停的时候停、能找到核对得上的问题。有没有人愿意把它接进自己的流程，要等发布之后才知道。

## 和方案不一样的地方

| 方案里写的 | 实际做的 | 原因 |
|---|---|---|
| 用 Vitest 测试 | 用 Node 自带的测试运行器 | 少一组依赖。Node 22 能直接运行 TypeScript，测试不需要构建 |
| 用 parse5 解析 HTML | 用 cheerio，它底层就是 parse5 | 可见价格要靠选择器来取，cheerio 自带 |
| 用 Zod 校验内部数据 | 暂时手写检查 | 目前只有配置一处需要，等报告格式对外稳定时再引入 |
| 13 条套准规则 | 0.1.0 是 12 条，0.2.0 补齐到 13 条 | `price.tax-basis` 提前做了。`availability.stale` 和 `content.cloaking` 在 0.1.0 时推后，因为采集器当时还拿不到 feed 的生成时间，也不会换一个身份再读一遍页面；0.2.0 补上了 |
| Shopify 排在第二阶段 | 只读部分在 0.1.0 提前做了，购物车探针在 0.2.0 补上 | 本来想用它做实测样本，结果被拒之门外，见上 |
| 隐藏文字一律报 | 只报障眼法和堆关键词 | 见上一节 |

---
title: Regmark
slug: ""
nav: 总览
summary: 让 AI 购物代理读到的商品事实，和结账时实际收的对得上。
---

## 这是什么

Regmark 是一个开源的命令行测试工具。一家店会从好几个出口向机器报价：商品页、结构化数据、商品 feed、代理协议端点。Regmark 把这些出口上的价格、库存、运费逐项拿去和结账实算的结果比对，对不上就报出来，并且可以让 CI 失败。

它要回答三个问题：

1. **各处说的是不是同一个数？** 这是套准，也是首期的重点。原型已经做了。
2. **照着读到的信息去买，买不买得成？** 这是探店，让一个代理真的走一遍。还没开始。
3. **商品内容里有没有会带偏代理的东西？** 这是内容卫生。原型已经做了。

## 一个例子

下面是同一件 T 恤在四个出口上的样子。价格、库存、运费各有一处对不上，单看任何一个出口都发现不了。

<!-- figure:plates -->

| 版 | 出口 | 价格 | 库存 | 运费 |
|---|---|---|---|---|
| C | 商品页的 JSON-LD | 35.00 | 有货 | 没提 |
| M | 商品 feed | 39.00 | 有货 | 包邮 |
| Y | UCP 目录接口 | 39.00 | 缺货 | 没提 |
| K | 结账实算 | 39.00 | 可下单 | 6.20 |

Regmark 对这件商品会报三条：JSON-LD 的价格是促销结束后没改回来的旧值，UCP 的库存状态是错的，feed 里的「包邮」在结账时并不成立。每一条都带着两边的原始取值和出处。下面用 feed 来演示同样的三条，因为协议端点的采集器还没写。

```terminal
$ regmark audit https://shop.example --feed /feeds/google.xml --platform woocommerce --checkout

  shop.example    48 variants    2m 41s
  C page jsonld opengraph    M feed    Y –    K platform checkout

  ✗ price.mismatch           1 finding
      TEE-BLU-M   C jsonld 35.00 USD  ≠  K checkout 39.00 USD
                  https://shop.example/p/tee-blue/#jsonld[0]/offers/2/price
  ✗ availability.mismatch    1 finding
      TEE-BLU-M   M feed in_stock  ≠  K platform out_of_stock
                  https://shop.example/feeds/google.xml#item[id="TEE-BLU-M"]/availability
  ✗ shipping.mismatch        1 finding
      TEE-BLU-M   M feed free  ≠  K checkout 6.20 USD
                  https://shop.example/feeds/google.xml#item[id="TEE-BLU-M"]/shipping
  ✓ 12 rules passed

  3 errors, 0 warnings. 3 rules over budget.
```

这段是照上面那张表排的示意，格式和工具的真实输出一致。对样板店跑出来的原件，以及工具写出的 HTML 报告，在[原型与实测](06-prototype.md)一章。

## 名字的来历

印刷时各色版要逐张对齐，纸边印的那个十字圆圈叫套准标，英文是 registration mark，行话叫 reg mark。黑版是其余色版对齐的基准，所以它的代号是 K，取自 key。

在这个项目里，结账就是那块黑版。商品页、feed、协议端点都得向它对齐，因为用户最后付的是结账算出来的那个数。

Regmark 目前是工作代号。npm 上这个包名还空着，GitHub 上的同名账号已经被人注册，正式定名之前还要查商标。

## 现在的状态

| 项 | 内容 |
|---|---|
| 阶段 | 版本 0.2.0，发布到 npm 和 GitHub Marketplace |
| 试一下 | `npx regmark demo`，详见[使用说明](07-usage.md) |
| 源码 | [github.com/kairwang01/regmark](https://github.com/kairwang01/regmark) |
| 已经有的 | 商品页、Google feed、ACP feed、UCP 目录、店铺 MCP 服务、WooCommerce 与 Shopify 商品接口的采集，WooCommerce 与 Shopify 结账探针，对代理换脸（cloaking）的检查，17 条规则，六种报告，GitHub Action |
| 还没有的 | 探店代理，经 UCP 结账会话的实算，更多平台 |
| 验收 | 超过 1100 项测试通过。样板店里 27 处预置缺陷对应的 31 条发现全部查出，对照店零误报 |
| 实现语言 | TypeScript。使用要求 Node 22 及以上 |
| 许可证 | 代码 Apache-2.0，文档 CC BY 4.0 |
| 更新 | 2026 年 10 月 9 日 |

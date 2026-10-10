---
title: Regmark
slug: ""
nav: 总览
summary: 比对各出口的商品事实，以公开接口或页面为默认基准，可选验证归属后的购物车探针。
---

## 这是什么

Regmark 是一个开源的命令行测试工具。一家店会从好几个出口向机器报价：商品页、结构化数据、商品 feed、代理协议端点。Regmark 对采样商品逐项比对这些出口。默认以公开商品接口、其次以可见页面为基准；验证店铺归属后，可选购物车探针补充结账证据。发现超出预算时可以让 CI 失败。

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

Regmark 对这件商品会报三条：JSON-LD 的价格是促销结束后没改回来的旧值，UCP 的库存状态是错的，feed 里的「包邮」在结账时并不成立。每一条都带着两边的原始取值和出处。下面用 feed 展示报告格式。当前已实现 UCP 目录、店铺 MCP 服务和 ACP feed 的只读采集；这段是合成示意，不是真实店铺实测。

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

在这个项目里，K 表示参考观测。默认只读审计通常以公开商品接口或可见页面为基准；只有验证归属并运行购物车探针时，才有相应的结账观测。

Regmark 的源码和单文件发布包托管在 GitHub。2026-10-10 检查时 npm 包接口返回 HTTP 404；这并不表示包名一定可注册，也不构成商标检索。

## 现在的状态

| 项 | 内容 |
|---|---|
| 阶段 | GitHub 已有 v0.2.0 发布包；npm 当前返回 404，Marketplace 状态不在此作保证 |
| 试一下 | 下载并校验固定发布包后运行 `node regmark.mjs demo`，详见[使用说明](07-usage.md) |
| 源码 | [github.com/kairwang01/regmark](https://github.com/kairwang01/regmark) |
| 已经有的 | 商品页、Google feed、ACP feed、UCP 目录、店铺 MCP 服务、WooCommerce 与 Shopify 商品接口的采集，WooCommerce 与 Shopify 结账探针，对代理换脸（cloaking）的检查，17 条规则，六种报告，GitHub Action |
| 还没有的 | 探店代理，经 UCP 结账会话的实算，更多平台 |
| 验收 | 超过 1100 项测试通过。样板店里 27 处预置缺陷对应的 31 条发现全部查出，合成对照店零发现；不是对真实店铺准确率的测量 |
| 实现语言 | TypeScript。使用要求 Node 22 及以上 |
| 许可证 | 代码 Apache-2.0，文档 CC BY 4.0 |
| 更新 | 2026 年 10 月 10 日 |

---
title: 技术架构与选型
slug: architecture
nav: 架构与选型
summary: 一个不需要服务器的命令行工具。难点不在技术栈，在数据模型、误报控制和对不可信内容的处理。
---

## 五条设计原则

1. **本地优先。** 首期没有服务端，没有账号，没有遥测。装上就能跑，结果写在本地文件里。
2. **事实带出处。** 任何一个值都能追到它来自哪个地址的哪个字段、什么时候读的。没有出处的结论不报。
3. **协议是插件。** 核心不认识 UCP 或 ACP，只认识事实表。协议变了，换采集器。
4. **确定性优先。** 能用规则判断的不用模型。必须用模型的地方要能录制、能重放。
5. **被测内容一律视为不可信。** 这个工具的日常工作就是读别人写的网页，再把其中一部分交给模型，必须按最坏情况设计。

## 分层

```text
regmark/
├── packages/
│   ├── core/            事实表的类型、身份对齐、规则运行器、发现项
│   ├── collect-page/    商品页：可见文字、JSON-LD、microdata、Open Graph
│   ├── collect-feed/    Google Merchant 格式的 feed
│   ├── collect-woo/     WooCommerce Store API，含结账探针
│   ├── collect-shopify/ Shopify 公开的商品接口，只读
│   ├── rules/           规则目录：套准规则与内容卫生规则
│   ├── report/          终端、JSON、SARIF、JUnit、HTML
│   └── cli/             命令行入口和审计编排，包名 regmark
├── fixtures/shop/       两家样板店：错版店预置了缺陷，对照店没有
├── e2e/                 基准：拿两家样板店量工具本身
└── docs/rules.md        每条规则的精确定义
```

这是原型现在的样子。协议端点的采集器和探店代理各是一个还没建的包。

依赖只能从下往上：`core` 不依赖任何采集器，采集器不依赖规则，规则不依赖报告。

## 选型

| 项 | 选什么 | 为什么 | 没选什么 |
|---|---|---|---|
| 语言和运行时 | TypeScript，Node 22.18 及以上，源码由 Node 直接运行，没有构建步骤 | 目标用户写的就是它：电商前端、Shopify 和 Medusa 的插件、建站公司的脚手架都以 TypeScript 为主。`npx` 一行就能跑，GitHub Action 原生支持，MCP 的官方 SDK 也是它最成熟 | Python 的评测生态更强，但目标用户要多装一套环境。Go 和 Rust 能打成单个可执行文件，可是愿意用它们写采集器插件的人少得多 |
| 仓库结构 | pnpm 工作区，单仓多包 | 采集器和规则要能单独发版、单独被引用 | 多仓库，一个人维护不过来 |
| 内部数据校验 | 计划用 Zod，原型里暂时是手写检查 | 事实表的类型和运行时校验写一遍就够，还能导出 JSON Schema 给别的语言用。目前只有配置一处要校验，等报告格式对外稳定时再引入 | 一直手写下去 |
| 协议数据校验 | 规范自带的 JSON Schema，用 Ajv 执行 | 规范的 schema 就是权威，自己重写一份只会和它漂移 | 把协议结构翻译成 Zod |
| 网络请求 | Node 内置的 fetch，外面包一层限速、重试和 robots.txt | 少一个依赖，行为可控 | axios、got |
| HTML 解析 | cheerio（底层是 parse5），加自己写的 JSON-LD 和 microdata 提取 | 不执行脚本，不加载远程资源。可见价格要靠选择器取，cheerio 自带 | 默认带一个无头浏览器，体积大，启动慢，攻击面也大。需要时再选装 Playwright |
| feed 解析 | fast-xml-parser，制表符分隔的格式自己解析 | 关掉所有类型转换，条码的前导零才不会丢 | 让解析器自动把数字字符串转成数字 |
| 存储 | 默认只写本地 JSON 文件。巡检模式用 SQLite | 首期不需要查询历史，文件就够，而且方便在 CI 里当产物上传 | 任何需要单独启动的数据库 |
| 模型接入 | 自己写一层薄适配，支持 OpenAI 兼容接口和 Anthropic 接口 | 代理循环本身不到两百行。自己写，录制和重放才插得进去 | 代理框架。它们解决的问题这里没有，带来的升级负担却是实打实的 |
| MCP | 官方 TypeScript SDK | 既要当客户端去连店铺的 MCP，以后也要把 Regmark 自己包成 MCP 服务给编程代理用 | 自己实现协议 |
| 测试 | Node 自带的测试运行器，加两家样板店 | 少一组依赖，见下文「怎么测这个测试工具」 | 只靠单元测试 |
| 许可证 | 代码 Apache-2.0 | 和 ACP、UCP 规范同一种许可证，直接引用它们的 schema 没有障碍，并且带专利授权 | MIT 没有专利条款。AGPL 会让建站公司不敢用 |

## 数据模型

事实表的核心是「观察」。下面是示意，不是最终接口。

```ts
/** 某个出口在某个时刻对某个事实的一次陈述 */
type Observation<T> = {
  value: T;                 // 归一化后的值
  raw: string;              // 原始取值，一个字符都不改
  surface: Surface;         // 'jsonld' | 'page' | 'feed.google' | 'ucp' | 'checkout' …
  locator: string;          // 地址加定位：JSON 指针、CSS 路径或 feed 行号
  fetchedAt: string;        // ISO 8601
};

type Offer = {
  variant: VariantKey;      // gtin | brand+mpn | sku | url+options
  price: Observation<Money>[];
  availability: Observation<Availability>[];
  shipping: Observation<ShippingQuote>[];
  returnPolicy: Observation<ReturnPolicy>[];
};
```

规则是纯函数，拿一个变体的全部观察，返回发现项：

```ts
export default defineRule({
  id: 'price.mismatch',
  severity: 'error',
  check(offer, { datum, tolerance }) {
    const key = pickDatum(offer.price, datum);
    if (!key) return [];
    return offer.price
      .filter((o) => o !== key && !sameMoney(o.value, key.value, tolerance))
      .map((o) => finding({ expected: key, actual: o }));
  },
});
```

配置也是代码，这样预算和基准顺序都能进版本控制：

```ts
import { defineConfig } from 'regmark';

export default defineConfig({
  store: 'https://shop.example',
  surfaces: {
    page: { sitemap: '/sitemap_products.xml', sample: 50 },
    feed: { google: '/feeds/google.xml' },
    ucp: true,
    checkout: { via: 'woocommerce', shipTo: { country: 'US', postalCode: '94103' } },
  },
  datum: ['checkout', 'platform', 'page'],
  budget: { 'price.mismatch': 0, 'availability.stale': 2 },
});
```

## 基准怎么定

「以谁为准」是这个工具最重要的一个决定，所以它是显式配置，而且有默认顺序：

1. **结账实算。** 用户最后付的就是这个数。
2. **平台接口。** 没接结账探针时，用店铺后端自己的商品接口。
3. **可见页面。** 前两者都没有时，以人在浏览器里看到的为准。

JSON-LD、feed 和协议端点永远不当基准，它们是被检查的对象。

## 安全模型

**读到的一切都不可信。** 采集器读的是别人的网页，探店代理会把其中一部分交给模型，而内容卫生模块要找的恰恰就是藏在里面的恶意内容。所以：

- 代理手里只有被测店铺的工具：搜索、查看商品、操作购物车。它没有文件系统，没有通用的网络访问，也拿不到用户的密钥。
- 代理循环在支付之前有一道硬停，不是提示词里的一句「请不要付款」，而是工具列表里根本没有支付这个工具。
- 每次运行有步数、时间和花费的上限。
- HTML 报告里所有来自被测站点的内容都转义，报告本身不带脚本。
- 采集器不跟随跳到其他主机的重定向，不解析内网地址，不加载 JSON-LD 的远程上下文。

**带写操作的探针要验证归属。** 建购物车、开结账会话会在别人的系统里留下数据，可能占住库存。只有三种情况下才允许：在店铺域名下放了一个验证文件，在 DNS 里加了一条验证记录，或者提供了店铺自己的接口凭据。只读的检查对任何公开页面都能跑，和浏览器访问没有区别。

**凭据。** 只从环境变量读，不写进配置文件，不进报告，录制的会话在落盘前抹掉鉴权头。

## 怎么测这个测试工具

一个检查工具最怕两件事：该报的没报，不该报的报了。两件事都用样板店来量。

**错版店。** 一家很小的假店，同时提供商品页、JSON-LD、feed、UCP 端点和结账接口，里面预先埋好一批已知的缺陷，每个缺陷对应一条规则。工具对它跑一遍，查出来的占埋进去的多少，就是召回率。

**对照店。** 同一批商品，没有缺陷。工具对它跑一遍，报出任何一条都算误报。

首期预置的缺陷，都是真实店铺里常见的：

| 缺陷 | 现实里通常怎么来的 |
|---|---|
| JSON-LD 的价格是原价，页面显示的是促销价 | 主题只改了显示层，结构化数据还在读原价字段 |
| feed 里的价格是昨天的 | 导出任务的周期比改价的频率长 |
| feed 写有货，页面写售罄 | 同上，库存变得比导出快 |
| JSON-LD 只有默认变体的报价 | SEO 插件只输出第一个变体 |
| 页面按访客所在地显示加元，JSON-LD 写的是美元 | 多币种插件在前端换算，没改结构化数据 |
| feed 写包邮，结账收运费 | 包邮有门槛，feed 里没法表达条件 |
| feed 是不含税价，结账是含税价 | 面向不同市场时的税务设置不一致 |
| 两个变体共用一个 GTIN | 录入商品时复制粘贴 |
| 促销价的截止日期已经过了 | 促销结束后没人清理字段 |
| UCP 目录里的商品，在站点上是 404 | 下架只改了前台，没同步到适配器 |
| 描述里有一段和背景同色的文字 | 早年做搜索引擎优化留下的，或者有人故意放的 |
| 对爬虫的 User-Agent 返回另一个价格 | 防爬措施，或者有人故意为之 |

每加一条规则，就要先在错版店里加一个对应的缺陷。规则的测试不是「我觉得它对」，而是「它把埋的那个找出来了，并且没在对照店里乱报」。

## 分发

- **npm。** `npx regmark audit <地址>`，不需要全局安装。
- **容器镜像。** 给不想装 Node 的 CI 环境用，里面预装了可选的浏览器。
- **GitHub Action。** 包一层，负责把结果写回合并请求。

不收集任何使用数据。工具除了访问被测站点和用户自己配置的模型接口，不联系任何地方。

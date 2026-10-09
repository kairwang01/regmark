---
title: 调研依据
slug: sources
nav: 调研依据
summary: 方案里每一个带编号的说法，出处都在这里。哪些是一手材料，哪些只看到了转述，也分别标明。
---

## 怎么读这份清单

调研做于 2026 年 10 月 9 日。标「已核对」的，是直接读了原文或查了原始数据。标「转述」的，是原文所在的站点拒绝了访问，内容来自其他媒体的引用，或者来自搜索结果的摘要，引用时应当再核对一次。

这个领域变化很快，半年前的结论到现在可能已经不成立。

## 清单

1. **ACP 规范仓库。** [agentic-commerce-protocol/agentic-commerce-protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)。`spec` 目录下有五个带日期的版本：2025-09-29、2025-12-12、2026-01-16、2026-01-30、2026-04-17，另有一个未发布的目录。2026-04-17 这一版新增了购物车和 feed 的接口定义。Apache-2.0。已核对。
2. **UCP 规范仓库与发布记录。** [Universal-Commerce-Protocol/ucp 的发布页](https://github.com/Universal-Commerce-Protocol/ucp/releases)列有 v2026-01-11、v2026-01-23、v2026-04-08、v2026-08-25 四个版本。同一组织下有官方的 [conformance 测试仓库](https://github.com/Universal-Commerce-Protocol/conformance)。能力划分见 [ucp.dev](https://ucp.dev/)：目录、购物车、结账、身份关联、订单。Apache-2.0。已核对。
3. **Walmart 在 ChatGPT 内结账的转化率。** [Modern Retail，2026 年 3 月 27 日](https://www.modernretail.co/technology/what-went-wrong-with-chatgpts-instant-checkout/)引用 Walmart 高管 Daniel Danker 对 WIRED 的说法：在聊天窗口里直接售卖的商品，转化率低三倍，买家不想每件商品单独结账。同一篇文章引述一位零售商高管，称该功能还需要实时库存、优惠券和促销才算成熟。Modern Retail 一文已核对，WIRED 原文为转述。另见 [Search Engine Land 的报道](https://searchengineland.com/walmart-chatgpt-checkout-converted-worse-472071)。
4. **OpenAI 调整 ChatGPT 购物策略。** [TechCrunch，2026 年 3 月 24 日](https://techcrunch.com/2026/03/24/openais-plans-to-make-chatgpt-more-like-amazon-arent-going-so-well/)：OpenAI 发言人称不再把 Instant Checkout 作为独立功能优先开发，官方博客的说法是初版「没有达到我们希望提供的灵活度」，今后专注商品发现，商家使用自己的结账。已核对。OpenAI 的原文是[《Powering Product Discovery in ChatGPT》](https://openai.com/index/powering-product-discovery-in-chatgpt/)，[CNBC 当天也有报道](https://www.cnbc.com/2026/03/24/openai-revamps-shopping-experience-in-chatgpt-after-instant-checkout.html)，这两篇为转述。
5. **UCP Checker 的月度统计。** [2026 年 8 月](https://ucpchecker.com/blog/state-of-agentic-commerce-august-2026)：15,735 家通过验证的店铺，93% 在 A 档。[2026 年 5 月](https://ucpchecker.com/blog/state-of-agentic-commerce-may-2026)：通过验证的 WooCommerce 店铺只有 3 家。[2026 年 2 月](https://ucpchecker.com/blog/state-of-agentic-commerce-february-2026)：没有发现 Shopify 之外的平台公开提供发现文件。这是工具方自己的统计，样本怎么选的没有独立验证。转述。
6. **Cloudflare 的 Agent Readiness 评分。** [Cloudflare 博客](https://blog.cloudflare.com/agent-readiness/)，2026 年 4 月发布。检查站点对代理的通用支持程度，会检测 x402、UCP、ACP，但这几项不计入总分。转述。
7. **ShopGym。** [Shopify Engineering，2026 年 10 月 1 日](https://shopify.engineering/shopgym)。把真实店铺变成可重置的沙盒，并生成购物任务，用来评测代理。六家沙盒店，224 个任务。[代码仓库](https://github.com/agentic-foundation-modeling-research/shop-gym)用 MIT 许可证。已核对。
8. **ShoppingBench。** [arXiv 2508.04266](https://arxiv.org/abs/2508.04266)。基于真实购物意图的评测集，论文里表现最好的代理成功率也不到 50%。转述。
9. **Magentic Marketplace。** [arXiv 2510.25779](https://arxiv.org/abs/2510.25779)，微软研究院。模拟双边市场里的代理行为，发现各模型都明显偏向最先收到的报价，也会被操纵性的说辞影响。预印本。转述。
10. **What Is Your AI Agent Buying?** [arXiv 2508.02630](https://arxiv.org/abs/2508.02630)。发现商品的位置对代理的选择影响很大，不同模型的偏好不同，模型更新会让商品的份额大幅重排，卖家微调描述就能提高被选中的概率。预印本，几个版本之间的数字有变化。转述。
11. **消费者对代理代买的接受度。** [Worldpay](https://worldpay.com/insights/articles/agentic-commerce-building-for-adoption-not-autonomy)：美国和英国约 6% 的消费者愿意让代理在没有自己参与的情况下完成购买。转述。
12. **隐藏提示注入的实测。** [Search Engine World](https://www.searchengineworld.com/hidden-prompt-injection-vs-twelve-ai-assistants-one-obeyed-three-warned-the-user)：在一个虚构的商品页里藏了一条指令，测了十二个 AI 助手，一个照做了，三个提醒了用户。单次测试，方法没有独立复核。转述。
13. **同方向的开源项目。** [CatalogReady](https://github.com/PO-VINCENT/ai-shopping-audit) 检查单个商品页的机器可读程度。[ucp-ready](https://github.com/monkydot/ucp-ready) 检查 UCP 发现文件的形状，自述「检查的是店铺公布了什么，不是真实的结账流程」。[AgentReady](https://github.com/swarmclawai/agentready) 是面向一般站点的被动扫描。[storeprobe](https://github.com/tuhinmitra888/storeprobe) 的方向最接近，在开发中，目前只做目录检索。四个项目的星标都在个位数。已核对。
14. **Shopify 的代理入口。** [Digital Commerce 360，2026 年 3 月 25 日](https://www.digitalcommerce360.com/2026/03/25/shopify-brands-shoppable-inside-chatgpt-integration/)引述 Shopify 总裁 Harley Finkelstein：商家的商品「默认可购」，购买在商家自己的店里通过应用内浏览器完成。[Shopify 2026 年 1 月的公告](https://www.shopify.com/news/ai-commerce-at-scale)宣布向不使用 Shopify 建站的品牌开放 Shopify Catalog。两篇均已核对。
15. **AP2 移交 FIDO 联盟。** [Google 博客](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/)，2026 年 4 月。同时发布 AP2 v0.2，增加了用户不在场时的支付。方案正文没有直接引用，列在这里是因为它关系到支付这一层以后由谁来定标准。转述。
16. **已有的协议适配器。** [WordPress 插件目录里带 ucp 标签的插件](https://wordpress.org/plugins/tags/ucp/)有好几个，都是给 WooCommerce 加 UCP 端点的，安装量都很小。[Saleor 的页面](https://saleor.io/agentic-commerce)写着它面向开放的代理电商标准重新设计，相关部分「即将开源」。Saleor 页面已核对，插件目录为转述。
17. **Google 对价格不一致的规则。** [Merchant Center 帮助：How to fix: Mismatched product price](https://support.google.com/merchants/answer/12159029?hl=en)。爬虫把数据源里的价格和落地页、结构化数据里的价格比对；页面 HTML 里的价格必须与提交的价格完全一致；不一致的商品可能被拒登，并可能导致账号被封。列出的常见原因包括网站和 feed 更新有时间差、结构化数据写错、用户看到的价格和爬虫抓到的不同、促销生效时间设错。已核对。
18. **Google 对落地页与结账页价格不一致的规则。** [Merchant Center 帮助：Inaccurate prices](https://support.google.com/merchants/answer/10330822)。结账页显示的价格高于商品落地页时，账号会被警告或封停；各种附加费用要么并入运费，要么并入落地页和结账页都显示的价格。已核对。
19. **Shopify 社区里的卖家讨论。** [2021 年 11 月的帖子](https://community.shopify.com/t/how-to-fix-google-shop-mismatched-value-page-crawl-price/76637)，多规格商品被报 Mismatched value (page crawl) [price]，跟帖持续到 2023 年，其中一条写着「after three years of following this issue」。[2023 年 2 月的帖子](https://community.shopify.com/t/mismatched-value-page-crawl-price/188235)：「it seems like Google is guessing at the right price」。[2024 年 8 月的日文帖子](https://community.shopify.com/t/google-google-merchant-center/349666)：feed 价 12,180 日元，抓取价 11,073 日元，发帖人推测差额是消费税。三帖均已核对，引文为原文的翻译。
20. **WooCommerce 结构化数据的老问题。** [AdTribes 的说明文章](https://adtribes.io/woocommerce-structured-data-bug/)，2018 年 3 月发布，2023 年 10 月更新。多规格商品的 JSON-LD 给每个规格都写了最便宜规格的价格，库存状态跟随父商品，「Google will disapprove all of those variations」。这是 feed 插件厂商的文章，它卖的就是修这个问题的功能。已核对。
21. **AI 购物助手的价格准确率。** [Tech.co 的报道](https://tech.co/?p=367919)，转述 Product.ai 的一项测试：对 ChatGPT、Claude、Gemini、Perplexity 问了 220 个购物问题，913 个可核对的价格回答里 85% 与标价一致，报错时偏差的中位数为 300 美元。原文没能打开，数字来自搜索摘要。转述。

## 没有找到的

有两类数据本来想引用，没有找到可靠的来源：

- **各出口之间不一致的发生率。** 商品页、结构化数据、feed 之间的价格和库存到底有多大比例对不上，没有看到公开的、方法可查的统计。能找到的说法都来自卖 feed 工具的厂商。这本身就是 Regmark 发布时可以补上的一块：对一批公开店铺做只读检查，公布汇总后的数字。
- **代理因为数据不一致而放弃购买的比例。** 没有找到实测数据。
- **Reddit 和 X 上的讨论。** 这两处是卖家抱怨最集中的地方，但检索工具访问不了，所以这份清单里的社区讨论只来自 Shopify 社区和 WordPress 论坛。中文的跨境卖家社区也搜过，没有找到有信息量的原帖。

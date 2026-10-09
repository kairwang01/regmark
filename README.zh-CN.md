<p align="center">
  <img src="docs/assets/hero.png" alt="Regmark：像对齐印刷色版一样，对齐商品页、结构化数据、feed 与结账信息" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0 许可证" src="https://img.shields.io/badge/license-Apache--2.0-21355c"></a>
  <img alt="打包后的 CLI 需要 Node 22 或更新版本" src="https://img.shields.io/badge/node-%E2%89%A5%2022-21355c">
  <a href="docs/rules.md"><img alt="15 条审计规则" src="https://img.shields.io/badge/rules-15-21355c"></a>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/README-English-c2256e"></a>
</p>

# Regmark — 可接入 CI 的电商商品数据一致性检查

**发现商品页、JSON-LD、商品 feed 和店铺 API 之间的价格、库存与运费差异。** 验证 WooCommerce 店铺所有权后，还可以通过购物车探测核对结账金额。

Feed 写着 **22 美元**，购物车却收 **24 美元**，两边的格式都完全合法。Regmark 按同一商品规格关联各处数据，列出冲突值和来源位置，并将检查接入发布流程。

默认只读。无需注册、平台 API 密钥或托管服务。支持本地和 CI，输出可独立打开的 HTML 报告，以及 JSON、SARIF、JUnit 和 Markdown。

[快速上手](docs/quickstart.md) · [全部配置](docs/configuration.md) · [规则](docs/rules.md) · [CI](docs/ci.md) · [English](README.md)

## 先运行演示

需要 Node.js 22 或更新版本及 npm。以下命令从 GitHub 安装 CLI，检查随工具打包的模拟店铺：

```bash
npx --allow-git=all github:kairwang01/regmark demo
```

打开生成的 `regmark-demo.html`。模拟店铺中有 **19 个预设缺陷，对应 22 条发现**，包括过期 feed 价格、缺失规格和未披露运费。演示命令会成功退出，真实 `audit` 的退出码见下文。无需准备真实店铺或凭证。

<p align="center"><img src="docs/assets/terminal.png" alt="终端报告显示 feed 价格 22.00 USD 与结账价格 24.00 USD 冲突，并标出来源位置" width="880"></p>

```bash
# 对比没有预设缺陷的同一模拟店铺
npx --allow-git=all github:kairwang01/regmark demo --clean --html regmark-clean.html
```

<p align="center">
  <img src="docs/assets/report-out-of-register.png" alt="有缺陷的模拟店铺 HTML 报告，标题为 Out of register，呈套印偏移效果" width="49%">
  <img src="docs/assets/report-in-register.png" alt="干净模拟店铺 HTML 报告，标题为 In register，表示已观测信息一致" width="49%">
</p>

每条发现并列展示观测值与来源，便于定位负责修复的模块：

<p align="center"><img src="docs/assets/report-findings.png" alt="展开的模拟店铺差异：feed 22 对结账 24 美元、JSON-LD 45 对 39 美元、Open Graph 14 对 16 美元，附有来源位置" width="880"></p>

CMYK 视觉来自印刷套准：页面、feed、规划中的代理协议，以及店铺 API 或购物车，是需要对齐的几块色版。截图来自模拟店铺，不代表真实商家的故障。

固定版本安装、故障排查及源码运行见[快速上手](docs/quickstart.md)。

## 第一次只读检查

```bash
npx --allow-git=all github:kairwang01/regmark audit https://your-shop.example \
  --feed /feeds/google.xml --html report.html --json report.json
```

换成真实店铺地址与 feed 路径，没有 feed 时去掉 `--feed`。工具自动识别 WooCommerce 或 Shopify，默认抽样最多 25 件商品，读取页面并比较可用数据。默认同一主机的请求间隔为 1 秒，并遵守 `robots.txt`。

没有开启购物车探测时，优先以店铺 API 为基准，再回退到页面可见信息。报告通过表示本次观测样本在预算内；采集问题与跳过的规则也要一起查看，才能了解实际覆盖范围。

后文的 `regmark` 命令可这样安装：

```bash
npm install --global --allow-git=all github:kairwang01/regmark
regmark init https://your-shop.example
regmark audit --html report.html
regmark explain price.mismatch
```

## 谁会用到它

| 你负责的工作 | 适合何时运行 | 能得到什么 |
|---|---|---|
| WooCommerce 开发、主题或插件维护 | 主题、定价插件、feed 导出器更新后 | 按规格给出差异与来源，帮助定位负责修复的模块 |
| 商品 feed、技术 SEO 与投放协作 | 促销开始或结束、库存批量更新后 | 可重复运行的 feed、页面、结构化数据一致性检查 |
| Shopify 店铺开发 | 主题或结构化数据应用更新后 | 公共商品目录、页面和 feed 的只读比较 |
| 电商发布与质量保障 | 测试环境部署完成后 | 可保存的报告与逐规则预算，阻止已知问题回归 |

Google 官方文档说明，Merchant Center 会核对商品数据、落地页及结构化数据中的价格，差异可能导致商品被拒。Regmark 把这些差异检查带进团队自己的工作流。[Google Merchant Center：商品价格不一致](https://support.google.com/merchants/answer/12159029)。

一致的机器可读商品信息，也为搜索和购物助手提供更可靠的输入。Regmark 检查可观测事实，不测量搜索排名、不预测 AI 推荐，也不保证 Merchant Center 审核通过。[定位与应用场景](docs/positioning.md)。

## 当前支持与边界

| 信息来源 | 已支持 | 边界 |
|---|---|---|
| 商品页 | 可见价格/库存、JSON-LD、microdata、Open Graph、选定的商品文本 | 只读取服务器返回的 HTML，不执行 JavaScript 或浏览器交互 |
| 商品 feed | Google 格式的 RSS、Atom、TSV | 需要显式传入 `--feed`；一次读取整个文件 |
| WooCommerce | 公共 Store API 商品目录；可选的所有权验证后购物车探测 | 每次一件商品、每轮一个收货地区；不下单或付款 |
| Shopify | 公共 `/products.json` 商品目录 | 仅只读，尚无 Shopify 购物车探测 |
| 其他平台 | 显式指定页面、sitemap 发现及提供的 feed | 依赖返回 HTML 中能提取到的事实 |
| UCP、ACP、MCP | 路线图 | 本版本尚无协议端点采集器 |

默认比较优先级为 **结账 → 店铺 API → 可见页面**，按每条事实是否可用选择基准。JSON-LD、microdata、Open Graph 与 feed 默认是被检查的对象。结果受抽样、数据是否可访问与提取能力限制：目录发现最多考虑 1,000 件 WooCommerce 商品或 250 件 Shopify 商品，默认排除超过 30 个规格的商品。[抽样与配置细节](docs/configuration.md#which-products-get-audited)。

## 15 条规则检查什么

| 规则 | 默认级别 | 示例 |
|---|---|---|
| `price.mismatch` | error | Feed 或结构化价格与所选基准不一致 |
| `price.currency-ambiguous` | error | 机器可读价格缺少币种或币种冲突 |
| `price.tax-basis` | warn | 价格差恰好对应支持的 VAT/GST 税率 |
| `price.sale-expired` | warn | 价格标注的有效期已过 |
| `availability.mismatch` | error | 一处有货，另一处售罄 |
| `variant.missing` | error | 结构化数据漏掉目录中的规格 |
| `variant.unpurchasable` | error | 声称可购买，但购物车拒绝添加 |
| `shipping.mismatch` | error | 声称的运费与探测到的购物车收费不同 |
| `shipping.undisclosed` | warn | 购物车收运费，但未观察到其他来源披露金额 |
| `identity.unmatched` | warn | Feed 条目匹配不到店铺在售商品 |
| `identity.gtin-invalid` | warn | GTIN 校验位错误或规格标识重复 |
| `policy.return-missing` | info | 未观察到机器可读的退货政策 |
| `content.hidden-text` | warn | 选定商品文本命中支持的 HTML/CSS 隐藏模式 |
| `content.instruction-like` | error | 商品文本包含面向助手的指令式语言 |
| `content.invisible-chars` | warn | 选定文本中存在可疑的不可见字符 |

每条规则都有减少误报的静默条件。内容检查是启发式检测，不是完整的提示词注入防御。[查看全部规则的触发条件与限制](docs/rules.md)。

## 接入 CI

```yaml
# .github/workflows/regmark.yml
name: Regmark
on: pull_request
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
```

在测试环境部署就绪后运行。Action 会写入任务摘要，并在生成成功时上传 HTML、JSON、SARIF 和 Markdown 报告。固定使用审核过的发布版本或 commit；仓库中的改动需要发布新版本后才会进入对应的新发行包。

| 退出码 | 含义 |
|---|---|
| `0` | 读到了商品，且所有规则都在预算内 |
| `1` | 至少一条规则超过预算 |
| `2` | 配置错误、执行失败、没有读到商品，或严格模式遇到采集问题 |

Error 规则默认预算为 0；warn/info 默认不限数量，也可以设置预算使它们阻止构建。已有问题可先用当前数量作为预算，修复后逐步调低。当前源码新增 `--strict`，可在任何采集问题出现时失败；固定的 `v0.1.0` 发行版尚不包含此参数。[GitHub Actions、GitLab、SARIF 与预算](docs/ci.md)。

## 可选的 WooCommerce 购物车检查

在你控制的测试店铺上：

1. 选择一个由字母、数字、`_`、`-` 组成的 16–128 字符 token。
2. 在 `/.well-known/regmark.txt` 提供 `regmark-verify=<token>`，或在 `_regmark.<store-host>` 发布相同内容的 TXT 记录。
3. 将 `REGMARK_OWNERSHIP_TOKEN` 放入环境变量或 CI Secret，然后运行：

```bash
regmark audit https://staging.your-shop.example --platform woocommerce \
  --feed /feeds/google.xml --checkout --ship-to US:94103 --html report.html
```

探测会向购物车添加一个单位商品、设置地址、读取总价，并在每个规格结束后尝试清空。不会下单或付款，但会写入购物车/会话状态；清理失败会报告。必须通过所有权验证，并检查采集问题以确认探测实际执行。[所有权验证与请求策略](docs/configuration.md#writes)。

## 如何与现有工具配合

| 工具或流程 | 主要回答什么问题 | 与 Regmark 的配合 |
|---|---|---|
| Merchant Center 诊断 | Google 是否发现商品数据或政策问题？ | 以其作为 Google 处理结果的依据，使用 Regmark 重复检查自己的店铺与测试环境 |
| Rich Results Test / Schema 校验器 | 页面标记能否被读取，是否满足相应结构要求？ | 先校验标记，再将其中的值与 feed/API/购物车对照 |
| Feed 校验器 | 文件格式和字段是否符合其要求？ | 先校验文件，再比较其内容与店铺事实 |
| 浏览器端到端测试 | 指定条件下的购买流程是否正常？ | 保留浏览器与支付覆盖，补充 Regmark 的规格匹配和多格式报告 |

这些流程可以互补。Regmark 当前专注于可观测的商品数据一致性。[完整定位说明](docs/positioning.md)。

## 开发与贡献

项目处于 `0.1.0` 早期阶段。Fixture 基准验证 19 个预设缺陷对应 22 条发现，干净店铺对应 0 条发现；这是可复现的测试证据，不是真实商家准确率估计。

```bash
# 源码开发：Node 22.18+，pnpm 版本见 package.json
pnpm install --frozen-lockfile
pnpm test
pnpm bench
pnpm typecheck
```

最有价值的贡献是可复现的[误报](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml)或[漏报](https://github.com/kairwang01/regmark/issues/new?template=missed-defect.yml)。主题提取 fixture、平台实例、文档纠错都适合开始。[贡献指南](CONTRIBUTING.md)。

后续方向包括代理协议采集、更广泛的主题适配、feed 时效性及 Shopify 购物车支持；进展见 [Issues](https://github.com/kairwang01/regmark/issues)。如果它帮助了你，欢迎 Star 让更多人发现；可复现的反馈能让项目更可靠。

## 文档导航

- [快速上手与排错](docs/quickstart.md)
- [复现截图与录制演示](docs/demo.md)
- [全部命令、参数和配置字段](docs/configuration.md)
- [CI 接入与渐进预算](docs/ci.md)
- [规则参考](docs/rules.md)与 [JSON 报告格式](docs/report-format.md)
- [产品定位](docs/positioning.md)与[曝光、SEO、演示方案](docs/discoverability.md)
- [贡献指南](CONTRIBUTING.md)与[中文设计笔记](https://opensource.kairwang.cloud/regmark/)

## 许可证与托管

Apache-2.0。项目站点托管在腾讯云。

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="Tencent Cloud" height="22"></a>

腾讯云标志属于其权利人，不属于本项目许可证授权范围，仅用于说明托管提供方。

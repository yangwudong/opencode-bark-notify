# opencode-bark-notify

为 [OpenCode](https://opencode.ai) 提供基于 [Bark](https://github.com/Finb/Bark) 的手机推送通知。

任务完成、需要授权、等你回答时，iPhone 上收到 **agent 的实际消息内容**。

## 功能

- **详细内容** — 推送 agent 的最后一条消息，不只是"任务完成"
- **分类标识** — iOS 副标题显示事件类型：✅ Responded / 🔐 Wait for Permission / ❓ Input Needed / ❌ Error
- **Markdown 回复** — 标题、列表、代码块保留格式
- **自动消除** — 在电脑上处理完授权或提问，手机上对应的通知自动消失
- **Session 感知** — 每条通知包含 session 标题
- **零依赖** — 纯 TypeScript，Bun 直接运行

## 前置条件

- iOS 设备安装 [Bark](https://apps.apple.com/app/id1403753865)
- Bark device key（在 Bark App 首页查看，如 `BrHXXCACzphzrB63kNJMFF`）

## 安装

### 方式一：带配置（推荐）

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": [
    ["@jack-yang/opencode-bark-notify", {
      "barkKey": "你的BARK设备KEY"
    }]
  ]
}
```

### 方式二：环境变量

在 `~/.zshrc` 中设置：

```bash
export BARK_KEY="你的BARK设备KEY"
```

然后在 `opencode.json` 中：

```json
{
  "plugin": ["@jack-yang/opencode-bark-notify"]
}
```

重启 OpenCode 生效。

## 配置项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `barkKey` | string | *(环境变量 `BARK_KEY`)* | Bark 设备 Key（**必填**） |
| `barkUrl` | string | `https://api.day.app` | Bark 服务器地址（自建服务器用） |
| `level` | string | `timeSensitive` | iOS 通知级别 |
| `group` | string | `opencode` | iOS 通知分组 |
| `expireAfter` | string \| number | *(永久)* | 通知多久后自动删除，如 `"5m"`、`"30m"`、`"1h"`、`"24h"`、`"2d"`、`"90s"`。纯数字表示分钟。`"permanent"` / `0` / 不配置 = 永不删除 |
| `markdown` | boolean | `true` | 用 Markdown 推送回复（Bark 的 [`markdown`](https://github.com/Finb/Bark/blob/master/docs/params.md#markdown) 参数），保留格式。同时附带一段简短的纯文本 `body`，兼容旧版 Bark |
| `autoDismiss` | boolean | `true` | 在 opencode 里处理完授权或提问后，从手机上删除对应的 🔐 / ❓ 通知（Bark 的 [`id`](https://github.com/Finb/Bark/blob/master/docs/params.md#id) + [`delete`](https://github.com/Finb/Bark/blob/master/docs/params.md#delete)）。需要在 iOS 设置里为 Bark 打开**后台 App 刷新** |

> `expireAfter` 对应 Bark 的 [`ttl`](https://github.com/Finb/Bark/blob/master/docs/params.md#ttl) 参数：到期后 Bark 会删除历史记录，并从通知中心移除该通知。仅对保存到 Bark 历史的推送生效（默认保存）。

## 通知类型

| 事件 | 标识 | 内容 |
|------|------|------|
| Session 完成 | **✅ Responded** | agent 最后一条回复（≤500字） |
| 需要权限 | **🔐 Wait for Permission** | 权限类型 + 匹配模式 |
| 需要回答 | **❓ Input Needed** | 问题内容 |
| Session 出错 | **❌ Error** | 错误信息（代替 ✅ 发送；手动取消不算出错） |

## 与桌面通知配合

本插件与 [@mohak34/opencode-notifier](https://github.com/mohak34/opencode-notifier)（桌面通知）互补：

- **桌面通知**（声音/弹窗）→ 电脑上
- **Bark 推送**（手机）→ 手机上

本插件总是推送；如果希望桌面通知只在终端不在前台时弹，在 opencode-notifier 里设置 `suppressWhenFocused`。

## 许可证

MIT

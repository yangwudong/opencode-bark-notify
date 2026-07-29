# opencode-bark-notify

为 [OpenCode](https://opencode.ai) 提供基于 [Bark](https://github.com/Finb/Bark) 的手机推送通知，**智能感知终端焦点**。

离开电脑时收到 **agent 的实际消息内容**，在终端前时自动静默——不打扰。

## 功能

- **焦点感知** — 终端在前台时不发通知，切走或离开时才推
- **详细内容** — 推送 agent 的最后一条消息，不只是"任务完成"
- **分类标识** — iOS 副标题显示事件类型：✅ Responded / 🔐 Wait for Permission / ❓ Input Needed
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
| `terminals` | string[] | `["Ghostty", "Terminal", "iTerm2", ...]` | 焦点检测的终端 App 名称 |

## 通知类型

| 事件 | 标识 | 内容 |
|------|------|------|
| Session 完成 | **✅ Responded** | agent 最后一条消息（≤500字） |
| 需要权限 | **🔐 Wait for Permission** | 权限类型 + 匹配模式 |
| 需要回答 | **❓ Input Needed** | 问题内容 |

## 与桌面通知配合

本插件与 [@mohak34/opencode-notifier](https://github.com/mohak34/opencode-notifier)（桌面通知）互补：

- **桌面通知**（声音/弹窗）→ 在电脑前但切到了其他窗口
- **Bark 推送**（手机）→ 完全离开电脑

两者各自独立检测焦点，互不冲突。

## 许可证

MIT

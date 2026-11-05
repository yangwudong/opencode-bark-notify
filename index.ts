import type { Plugin } from "@opencode-ai/plugin"

interface BarkConfig {
  barkKey?: string
  barkUrl?: string
  level?: string
  group?: string
}

const DEFAULT_BARK_URL = "https://api.day.app"
const MAX_BODY_LENGTH = 500

const sendBark = async (
  barkUrl: string,
  barkKey: string,
  title: string,
  subtitle: string,
  body: string,
  level: string,
  group: string,
) => {
  try {
    await fetch(`${barkUrl}/${barkKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title, subtitle, body, group, level }),
    })
  } catch {}
}

const truncate = (text: string, max: number): string => {
  const clean = text.replace(/\n+/g, " ").trim()
  return clean.length > max ? clean.slice(0, max) + "..." : clean
}

// Every notification is sent, whether or not the terminal is in front. Focus detection
// (osascript) proved fragile across macOS releases and silently dropped notifications.
//
// Only the plugin itself may be exported: opencode calls every exported function of a
// plugin module as a plugin, so an exported helper would be invoked with the plugin context.
export const BarkNotifyPlugin: Plugin = async ({ project, client, directory }, config: BarkConfig = {}) => {
  const barkKey = config.barkKey || process.env.BARK_KEY
  if (!barkKey) {
    console.warn(
      "[opencode-bark-notify] No barkKey configured. Set barkKey in plugin config or BARK_KEY env var.",
    )
    return {}
  }

  const barkUrl = config.barkUrl || process.env.BARK_URL || DEFAULT_BARK_URL
  const level = config.level || "timeSensitive"
  const group = config.group || "opencode"

  // project.id is "global" outside a git repository; the folder name says more.
  const folder = String(directory || (project as any)?.worktree || "").split("/").filter(Boolean).pop()
  let currentTitle = `OpenCode · ${folder || "Session"}`

  // Only assistant text is worth sending; user prompts arrive as text parts too.
  const assistantMessages = new Set<string>()
  let lastMessage = ""

  const send = (subtitle: string, body: string) =>
    sendBark(barkUrl, barkKey, currentTitle, subtitle, body, level, group)

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (info?.role === "assistant" && info.id) assistantMessages.add(info.id)
      }

      if (event.type === "message.part.updated") {
        const part = event.properties?.part
        if (part?.type === "text" && part.text && !part.synthetic && assistantMessages.has(part.messageID)) {
          lastMessage = part.text
        }
        if (part?.type === "tool" && part.tool === "question" && part.state?.status === "running") {
          const questions = part.state?.input?.questions || []
          const q = questions[0]?.question || "Input needed"
          await send("❓ Input Needed", q)
        }
      }

      // Permission requests arrive as an event; the old "permission.ask" hook is gone in opencode 1.19+.
      if (event.type === "permission.asked") {
        const p = event.properties || {}
        const patterns: string[] = p.patterns || []
        let body = p.permission || "permission"
        if (patterns.length) body += `: ${patterns.join(", ")}`
        await send("🔐 Wait for Permission", truncate(body, MAX_BODY_LENGTH))
      }

      if (event.type === "session.idle") {
        const sid = event.properties?.sessionID
        if (sid) {
          try {
            const sessions = await client.session.list({ limit: 50 } as any)
            const s = (sessions as any).data?.find((s: any) => s.id === sid)
            if (s?.title) currentTitle = `OpenCode · ${s.title}`
          } catch {}
        }

        const body = lastMessage ? truncate(lastMessage, MAX_BODY_LENGTH) : "Task completed"
        lastMessage = ""
        await send("✅ Responded", body)
      }
    },
  }
}

export default BarkNotifyPlugin

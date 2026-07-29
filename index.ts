import type { Plugin } from "@opencode-ai/plugin"

interface BarkConfig {
  barkKey?: string
  barkUrl?: string
  level?: string
  group?: string
  terminals?: string[]
}

const DEFAULT_TERMINALS = ["Ghostty", "Terminal", "iTerm2", "Alacritty", "kitty", "WezTerm"]
const DEFAULT_BARK_URL = "https://api.day.app"
const MAX_BODY_LENGTH = 500

const isFocused = async (terminals: string[]): Promise<boolean> => {
  if (process.platform !== "darwin") return false
  try {
    const proc = Bun.spawn(
      ["osascript", "-e", 'tell application "System Events" to name of first application whose frontmost is true'],
      { stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(proc.stdout).text()
    return terminals.includes(output.trim())
  } catch {
    return false
  }
}

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

export const BarkNotifyPlugin: Plugin = async ({ project, client }, config: BarkConfig = {}) => {
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
  const terminals = config.terminals || DEFAULT_TERMINALS

  let lastMessage = ""
  let currentTitle = `OpenCode · ${project?.id || "Session"}`

  const send = (subtitle: string, body: string) =>
    sendBark(barkUrl, barkKey, currentTitle, subtitle, body, level, group)

  return {
    event: async ({ event }) => {
      if (event.type === "message.part.updated") {
        const part = event.properties?.part
        if (part?.type === "text" && part.text) {
          lastMessage = part.text
        }
        if (part?.type === "tool" && part.tool === "question" && part.state?.status === "running") {
          if (await isFocused(terminals)) return
          const questions = part.state?.input?.questions || []
          const q = questions[0]?.question || "Input needed"
          await send("❓ Input Needed", q)
        }
      }

      if (event.type === "session.idle") {
        if (await isFocused(terminals)) return

        const sid = event.properties?.sessionID
        if (sid) {
          try {
            const sessions = await client.session.list({ limit: 50 })
            const s = sessions.data?.find((s: any) => s.id === sid)
            if (s?.title) currentTitle = `OpenCode · ${s.title}`
          } catch {}
        }

        const body = lastMessage ? truncate(lastMessage, MAX_BODY_LENGTH) : "Task completed"
        await send("✅ Responded", body)
      }
    },

    "permission.ask": async (input: any) => {
      if (await isFocused(terminals)) return
      const permType = input?.type || "permission"
      const patterns = input?.patterns || []
      let body = permType
      if (patterns.length) body += `: ${patterns.join(", ")}`
      await send("🔐 Wait for Permission", body)
    },
  }
}

export default BarkNotifyPlugin

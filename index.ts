import type { Plugin } from "@opencode-ai/plugin"

interface BarkConfig {
  barkKey?: string
  barkUrl?: string
  level?: string
  group?: string
  expireAfter?: string | number
  markdown?: boolean
  autoDismiss?: boolean
}

const DEFAULT_BARK_URL = "https://api.day.app"
const MAX_BODY_LENGTH = 500
// With `markdown` set, `body` is only the fallback for Bark versions without Markdown; keep it
// short so both fit APNs' 4 KB payload limit (CJK text is 3 bytes per character).
const MAX_FALLBACK_LENGTH = 150
const REQUEST_TIMEOUT_MS = 5000
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

// "30m" / "1h" / "24h" / "2d" / 45 (bare number = minutes) → seconds for Bark's `ttl`.
// "permanent", empty or unset → undefined (never auto-deleted). Invalid → undefined + warn.
const parseExpireAfter = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined
  const str = String(value).trim().toLowerCase()
  if (["permanent", "forever", "never", "0"].includes(str)) return undefined
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/)
  if (!match) {
    console.warn(`[opencode-bark-notify] Invalid expireAfter "${value}"; notifications will be kept permanently.`)
    return undefined
  }
  return Math.round(Number(match[1]) * UNIT_SECONDS[match[2] || "m"])
}

const sendBark = async (barkUrl: string, barkKey: string, payload: Record<string, unknown>) => {
  try {
    await fetch(`${barkUrl}/${barkKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      // A hung Bark server must not stall opencode's event handling.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {}
}

const clip = (text: string, max: number): string => {
  const clean = text.trim()
  return clean.length > max ? clean.slice(0, max) + "..." : clean
}

const truncate = (text: string, max: number): string => clip(text.replace(/\n+/g, " "), max)

const errorText = (error: any): string => error?.data?.message || error?.name || "Unknown error"

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
  const ttl = parseExpireAfter(config.expireAfter)
  const markdown = config.markdown !== false
  const autoDismiss = config.autoDismiss !== false

  // project.id is "global" outside a git repository; the folder name says more.
  const folder = String(directory || (project as any)?.worktree || "").split("/").filter(Boolean).pop()
  const fallbackTitle = `OpenCode · ${folder || "Session"}`

  // State is per session: several sessions (or a session and its subagents) can run at once.
  // Only assistant text is worth sending; user prompts arrive as text parts too.
  // `error` is set by session.error and cleared by any later reply text, so an error the
  // session recovers from (compaction, a file that failed to attach) does not turn ✅ into ❌.
  const sessions = new Map<string, { assistantMessages: Set<string>; lastMessage: string; error?: string }>()
  const state = (sid: string) => {
    let s = sessions.get(sid)
    if (!s) sessions.set(sid, (s = { assistantMessages: new Set(), lastMessage: "" }))
    return s
  }

  // Bark ids of 🔐 / ❓ notifications still on the phone, so they can be deleted once answered.
  const pending = new Set<string>()

  const sessionInfo = async (sid: string | undefined): Promise<{ title?: string; parentID?: string }> => {
    if (!sid) return {}
    try {
      const { data } = (await client.session.get({ path: { id: sid } })) as any
      return data || {}
    } catch {
      return {}
    }
  }

  const send = async (
    sid: string | undefined,
    subtitle: string,
    body: string,
    extra: Record<string, unknown> = {},
    info?: { title?: string },
  ) => {
    const { title } = info || (await sessionInfo(sid))
    await sendBark(barkUrl, barkKey, {
      title: title ? `OpenCode · ${title}` : fallbackTitle,
      subtitle,
      body,
      group,
      level,
      ...(ttl ? { ttl } : {}),
      ...extra,
    })
  }

  // A request notification carries the request id as its Bark id; answering it on the
  // computer sends a silent delete push. Bark needs Background App Refresh for this.
  const sendRequest = async (sid: string | undefined, requestID: string | undefined, subtitle: string, body: string) => {
    if (autoDismiss && requestID) pending.add(requestID)
    await send(sid, subtitle, body, autoDismiss && requestID ? { id: requestID } : {})
  }

  const dismiss = async (requestID: string | undefined) => {
    if (!requestID || !pending.delete(requestID)) return
    await sendBark(barkUrl, barkKey, { id: requestID, delete: "1" })
  }

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (info?.role === "assistant" && info.id && info.sessionID) state(info.sessionID).assistantMessages.add(info.id)
      }

      if (event.type === "message.part.updated") {
        const part = event.properties?.part
        const s = part?.sessionID && sessions.get(part.sessionID)
        if (s && part.type === "text" && part.text && !part.synthetic && s.assistantMessages.has(part.messageID)) {
          s.lastMessage = part.text
          s.error = undefined
        }
      }

      if (event.type === "question.asked") {
        const q = event.properties || {}
        await sendRequest(q.sessionID, q.id, "❓ Input Needed", truncate(q.questions?.[0]?.question || "Input needed", MAX_BODY_LENGTH))
      }

      // Permission requests arrive as an event; the old "permission.ask" hook is gone in opencode 1.19+.
      // Subagent permissions are sent too: they block the run until answered.
      if (event.type === "permission.asked") {
        const p = event.properties || {}
        const patterns: string[] = p.patterns || []
        let body = p.permission || "permission"
        if (patterns.length) body += `: ${patterns.join(", ")}`
        await sendRequest(p.sessionID, p.id, "🔐 Wait for Permission", truncate(body, MAX_BODY_LENGTH))
      }

      if (event.type === "permission.replied" || event.type === "question.replied" || event.type === "question.rejected") {
        await dismiss(event.properties?.requestID)
      }

      // Cancelling is the user's own doing, not an error worth a push.
      if (event.type === "session.error") {
        const { sessionID: sid, error } = event.properties || {}
        if (error?.name !== "MessageAbortedError") {
          if (sid) state(sid).error = errorText(error)
          else await send(undefined, "❌ Error", truncate(errorText(error), MAX_BODY_LENGTH))
        }
      }

      if (event.type === "session.idle") {
        const sid = event.properties?.sessionID
        const { lastMessage = "", error } = (sid && sessions.get(sid)) || {}
        if (sid) sessions.delete(sid)

        // A subagent finishing is not the end of the task; its parent goes idle later.
        const info = await sessionInfo(sid)
        if (info.parentID) return

        if (error) {
          await send(sid, "❌ Error", truncate(error, MAX_BODY_LENGTH), {}, info)
          return
        }
        if (markdown && lastMessage) {
          // `markdown` overrides `body` in Bark apps that support it.
          const md = { markdown: clip(lastMessage, MAX_BODY_LENGTH) }
          await send(sid, "✅ Responded", truncate(lastMessage, MAX_FALLBACK_LENGTH), md, info)
        } else {
          await send(sid, "✅ Responded", lastMessage ? truncate(lastMessage, MAX_BODY_LENGTH) : "Task completed", {}, info)
        }
      }

      if (event.type === "session.deleted") {
        const sid = event.properties?.info?.id
        if (sid) sessions.delete(sid)
      }
    },
  }
}

export default BarkNotifyPlugin

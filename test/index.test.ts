import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import BarkNotifyPlugin from "../index.ts"

const ctx: any = {
  project: { id: "global" },
  directory: "/Users/me/work/my-repo",
  client: {
    session: {
      get: async ({ path: { id } }: any) =>
        ({
          s1: { data: { id: "s1", title: "My Session" } },
          s2: { data: { id: "s2", title: "Other Session" } },
          child: { data: { id: "child", title: "Subagent", parentID: "s1" } },
        })[id as string] ?? { data: undefined },
    },
  },
}

const assistant = (id: string, sessionID = "s1") => ({ type: "message.updated", properties: { info: { id, sessionID, role: "assistant" } } })
const user = (id: string, sessionID = "s1") => ({ type: "message.updated", properties: { info: { id, sessionID, role: "user" } } })
const text = (messageID: string, t: string, sessionID = "s1") => ({
  type: "message.part.updated",
  properties: { part: { type: "text", sessionID, messageID, text: t } },
})
const idle = (sessionID?: string) => ({ type: "session.idle", properties: sessionID ? { sessionID } : {} })

describe("opencode-bark-notify", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const sent = () => fetchMock.mock.calls.map(([url, init]: any) => ({ url, body: JSON.parse(init.body) }))

  it("module exports a default plugin function", async () => {
    const mod = await import("../index.ts")
    expect(typeof mod.default).toBe("function")
  })

  it("returns no hooks without a bark key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const hooks = await BarkNotifyPlugin(ctx, {} as any)
    expect(hooks).toEqual({})
    warn.mockRestore()
  })

  it("sends the last assistant message on session.idle, with the session title", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: assistant("m1") })
    await hooks.event({ event: text("m1", "All done\nline 2") })
    await hooks.event({ event: idle("s1") })
    expect(sent()).toEqual([
      {
        url: "https://api.day.app/KEY",
        body: { title: "OpenCode · My Session", subtitle: "✅ Responded", body: "All done line 2", group: "opencode", level: "timeSensitive" },
      },
    ])
  })

  it("ignores the user's own prompt text", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: user("u1") })
    await hooks.event({ event: text("u1", "please run the tests") })
    await hooks.event({ event: assistant("a1") })
    await hooks.event({ event: text("a1", "Tests pass.") })
    await hooks.event({ event: user("u2") })
    await hooks.event({ event: text("u2", "thanks") })
    await hooks.event({ event: idle("s1") })
    expect(sent()[0].body.body).toBe("Tests pass.")
  })

  it("does not repeat the previous answer when a turn produced no text", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: assistant("a1") })
    await hooks.event({ event: text("a1", "first") })
    await hooks.event({ event: idle("s1") })
    await hooks.event({ event: idle("s1") })
    expect(sent().map((s) => s.body.body)).toEqual(["first", "Task completed"])
  })

  it("titles with the folder name when the project has no id (not a git repo)", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: { type: "permission.asked", properties: { permission: "bash", patterns: [] } } })
    expect(sent()[0].body.title).toBe("OpenCode · my-repo")
  })

  it("sends on permission.asked events", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: { type: "permission.asked", properties: { permission: "bash", patterns: ["echo hello"] } } })
    expect(sent()[0].body).toMatchObject({ subtitle: "🔐 Wait for Permission", body: "bash: echo hello" })
  })

  it("sends when the question tool starts", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({
      event: {
        type: "message.part.updated",
        properties: { part: { type: "tool", tool: "question", state: { status: "running", input: { questions: [{ question: "Tabs or spaces?" }] } } } },
      },
    })
    expect(sent()[0].body).toMatchObject({ subtitle: "❓ Input Needed", body: "Tabs or spaces?" })
  })

  it("honours barkUrl, level and group", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY", barkUrl: "https://bark.example", level: "active", group: "g" } as any)
    await hooks.event({ event: idle() })
    expect(sent()[0]).toMatchObject({ url: "https://bark.example/KEY", body: { level: "active", group: "g", body: "Task completed" } })
  })

  it.each([
    ["5m", 300],
    ["10m", 600],
    ["30m", 1800],
    ["1h", 3600],
    ["3h", 10800],
    ["6h", 21600],
    ["24h", 86400],
    ["1.5h", 5400],
    ["2d", 172800],
    ["90s", 90],
    [45, 2700],
    ["45", 2700],
  ])("sends expireAfter %s as ttl %i seconds", async (expireAfter, ttl) => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY", expireAfter } as any)
    await hooks.event({ event: idle() })
    expect(sent()[0].body.ttl).toBe(ttl)
  })

  it.each([undefined, "permanent", 0, "0"])("keeps notifications permanently for expireAfter %s", async (expireAfter) => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY", expireAfter } as any)
    await hooks.event({ event: idle() })
    expect(sent()[0].body).not.toHaveProperty("ttl")
  })

  it("warns and keeps permanently on an invalid expireAfter", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY", expireAfter: "soon" } as any)
    await hooks.event({ event: idle() })
    expect(sent()[0].body).not.toHaveProperty("ttl")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("does not send ✅ when a subagent session goes idle", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: assistant("c1", "child") })
    await hooks.event({ event: text("c1", "subagent result", "child") })
    await hooks.event({ event: idle("child") })
    expect(sent()).toEqual([])
    await hooks.event({ event: assistant("a1") })
    await hooks.event({ event: text("a1", "parent done") })
    await hooks.event({ event: idle("s1") })
    expect(sent().map((s) => s.body.body)).toEqual(["parent done"])
  })

  it("keeps last messages and titles separate per session", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: assistant("a1", "s1") })
    await hooks.event({ event: assistant("b1", "s2") })
    await hooks.event({ event: text("a1", "from s1", "s1") })
    await hooks.event({ event: text("b1", "from s2", "s2") })
    await hooks.event({ event: idle("s1") })
    await hooks.event({ event: idle("s2") })
    expect(sent().map((s) => [s.body.title, s.body.body])).toEqual([
      ["OpenCode · My Session", "from s1"],
      ["OpenCode · Other Session", "from s2"],
    ])
  })

  it("titles permission notifications with their own session", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: { type: "permission.asked", properties: { sessionID: "s2", permission: "bash", patterns: [] } } })
    expect(sent()[0].body.title).toBe("OpenCode · Other Session")
  })

  it("passes a timeout signal so a hung Bark server cannot block", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: idle() })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it("never throws when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await expect(hooks.event({ event: idle() })).resolves.toBeUndefined()
  })

  it("truncates long bodies to 500 chars", async () => {
    const hooks: any = await BarkNotifyPlugin(ctx, { barkKey: "KEY" } as any)
    await hooks.event({ event: assistant("a1") })
    await hooks.event({ event: text("a1", "a".repeat(600)) })
    await hooks.event({ event: idle("s1") })
    expect(sent()[0].body.body).toBe("a".repeat(500) + "...")
  })

  it("exports only the plugin (opencode calls every exported function as a plugin)", async () => {
    const mod: Record<string, unknown> = await import("../index.ts")
    const fns = Object.entries(mod).filter(([, v]) => typeof v === "function")
    expect(fns.every(([, v]) => v === mod.default)).toBe(true)
  })

  // opencode's npm loader takes the server entry from exports["./server"] or "main" only;
  // with just exports["."] an npm install is skipped silently (fixed in #2).
  it("declares the server entry the npm loader looks for", async () => {
    const { readFileSync } = await import("node:fs")
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    expect(pkg.main).toBe("./index.ts")
    expect(pkg.exports["./server"]).toEqual({ import: "./index.ts" })
  })

  // @opencode-ai/plugin is only imported as a type. As a peer dependency npm installed it
  // (and ~30 transitive packages) for every user; opencode checks engines.opencode instead.
  it("installs no runtime dependencies", async () => {
    const { readFileSync } = await import("node:fs")
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    expect(pkg.engines.opencode).toBeDefined()
  })
})

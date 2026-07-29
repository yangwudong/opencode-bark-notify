import { describe, it, expect } from "vitest"

describe("opencode-bark-notify", () => {
  it("module exports a default plugin function", async () => {
    const mod = await import("../index.ts")
    expect(typeof mod.default).toBe("function")
  })
})

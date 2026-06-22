import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./client.js";

// fetch 한 번 호출에 대한 가짜 Response — request<T> 헬퍼의 분기만 검증한다.
function fakeFetch(opts: { ok?: boolean; status?: number; statusText?: string; body?: string }) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "",
    json: async () => JSON.parse(opts.body ?? "{}"),
    text: async () => opts.body ?? "",
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// listAdapters 는 가장 단순한 GET — request<T> 의 성공/실패 경로를 대표로 태운다.
describe("api request helper (via listAdapters)", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    vi.stubGlobal("fetch", fakeFetch({ body: JSON.stringify({ adapters: [{ kind: "claude-code" }] }) }));
    const out = await api.listAdapters();
    expect(out.adapters[0]?.kind).toBe("claude-code");
  });

  it("sends Content-Type: application/json", async () => {
    const f = fakeFetch({ body: "{}" });
    vi.stubGlobal("fetch", f);
    await api.listAdapters();
    expect(f).toHaveBeenCalledWith(
      "/api/adapters",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
  });

  it("throws the server { error } message on failure", async () => {
    vi.stubGlobal("fetch", fakeFetch({ ok: false, status: 500, body: JSON.stringify({ error: "boom" }) }));
    await expect(api.listAdapters()).rejects.toThrow("boom");
  });

  it("throws the raw body when the error payload is not JSON (proxy HTML 등)", async () => {
    vi.stubGlobal("fetch", fakeFetch({ ok: false, status: 502, statusText: "Bad Gateway", body: "<html>proxy down</html>" }));
    await expect(api.listAdapters()).rejects.toThrow("<html>proxy down</html>");
  });

  it("falls back to statusText when the error body is empty", async () => {
    vi.stubGlobal("fetch", fakeFetch({ ok: false, status: 503, statusText: "Service Unavailable", body: "" }));
    await expect(api.listAdapters()).rejects.toThrow("Service Unavailable");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { clientExceptionInfo, isNetworkFailure, networkErrorInfo } from "@/lib/client-errors";
import { apiFetch, RequestFailedError } from "@/lib/fetch-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("network failures are reported as network errors", () => {
  it("recognises the browser's Failed to fetch rejection", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    const info = clientExceptionInfo(new TypeError("Failed to fetch"), "unhandledrejection");
    expect(info.code).toBe("NETWORK_ERROR");
    expect(info.action).toBe("unhandledrejection");
    expect(info.details).toBe("Failed to fetch");
    expect(info.messageAr).toContain("الاتصال");
  });

  it("keeps genuine UI bugs in the CLIENT_ERROR bucket", () => {
    const info = clientExceptionInfo(new Error("Cannot read property id of undefined"), "render");
    expect(info.code).toBe("CLIENT_ERROR");
  });

  it("uses the catalogued bilingual network message", () => {
    const info = networkErrorInfo(new Error("socket hang up"));
    expect(info.code).toBe("NETWORK_ERROR");
    expect(info.messageEn).toContain("server");
    expect(info.hintEn).toBeTruthy();
  });
});

describe("apiFetch", () => {
  it("returns the parsed body and response on a normal reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { response, data } = await apiFetch<{ ok: boolean }>("/api/purchases/bootstrap");
    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
  });

  it("turns a dropped connection into a reportable RequestFailedError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(apiFetch("/api/purchases", { method: "POST", action: "create purchase invoice" }))
      .rejects.toMatchObject({
        name: "RequestFailedError",
        reported: true,
        info: { code: "NETWORK_ERROR", action: "create purchase invoice" },
      });
  });

  it("does not classify an HTTP error response as a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 })));
    const { response, data } = await apiFetch("/api/purchases/bootstrap");
    expect(response.status).toBe(403);
    expect(data).toEqual({ code: "FORBIDDEN" });
    await expect(apiFetch("/api/purchases/bootstrap")).resolves.toBeTruthy();
  });

  it("exposes RequestFailedError for callers that need to distinguish it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const error = await apiFetch("/api/purchases").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestFailedError);
  });
});

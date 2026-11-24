"use client";

import { clientExceptionInfo, publishError, type ClientErrorInfo } from "./client-errors";

export interface ApiFetchInit extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  action?: string;
  /** Auxiliary reads (type-ahead, price hints) must not raise scary toasts. */
  silent?: boolean;
}

/** A request that never produced a usable HTTP response. */
export class RequestFailedError extends Error {
  readonly info: ClientErrorInfo;
  readonly reported: boolean;

  constructor(info: ClientErrorInfo, reported: boolean) {
    super(info.messageEn);
    this.name = "RequestFailedError";
    this.info = info;
    this.reported = reported;
  }
}

/**
 * Single fetch entry point for client components.
 *
 * - Bounds every request with a timeout so a dropped connection cannot leave a
 *   spinner (or a promise) hanging forever.
 * - Converts network/timeout rejections into the detailed NETWORK_ERROR envelope
 *   and publishes it once, so the global handler never reports a misleading
 *   CLIENT_ERROR / `Failed to fetch` from an unhandled rejection.
 * - HTTP error responses are returned untouched: callers keep using
 *   `apiErrorMessage(data, t)` for the server's bilingual envelope.
 */
export async function apiFetch<T>(
  url: string,
  init: ApiFetchInit = {},
): Promise<{ response: Response; data: T | null }> {
  const { timeoutMs = 20_000, action = "request", silent = false, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    let response: Response;
    try {
      response = await fetch(url, { ...fetchInit, signal: controller.signal });
    } catch (error) {
      const info = clientExceptionInfo(error, action);
      if (!silent) publishError(info);
      throw new RequestFailedError(info, !silent);
    }

    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      // An empty or non-JSON body is handled by the caller via apiErrorMessage.
    }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

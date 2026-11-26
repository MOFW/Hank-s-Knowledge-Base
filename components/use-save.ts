"use client";

import { useRef, useState } from "react";
import { useHydrated } from "./use-hydrated";

type Saved = { id: string; rowVersion: number };

export function useSave<T extends Saved = Saved>(url: string, version?: number, method = version === undefined ? "POST" : "PATCH") {
  // The server-rendered form must wait for its authenticated submit handler.
  const ready = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);

  async function save(body: object): Promise<T | null> {
    if (!ready || inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError("");
    setConflict(false);
    setSucceeded(false);
    const raw = JSON.stringify(body);
    const signature = JSON.stringify([url, method, version, raw]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    const headers = new Headers({ "Content-Type": "application/json", "Idempotency-Key": attempt.current.key });
    if (version !== undefined) headers.set("If-Match", `"v${version}"`);
    try {
      const response = await fetch(url, { method, headers, body: raw });
      const payload = await response.json() as { data?: T; error?: { code?: string; message?: string; fields?: unknown } };
      if (!response.ok) {
        setConflict(payload.error?.code === "VERSION_CONFLICT");
        const field = Array.isArray(payload.error?.fields) ? payload.error.fields[0]?.message : undefined;
        setError(field ?? payload.error?.message ?? "无法保存。");
        return null;
      }
      if (!payload.data) {
        setError("未收到保存确认。请保留当前输入，并重试相同内容。");
        return null;
      }
      setSucceeded(true);
      return payload.data;
    } catch {
      setError("未收到保存结果。可再次提交相同内容以确认结果。");
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return { pending, disabled: !ready || pending, error, conflict, succeeded, save };
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const saveEvent = "hkb:saved";

export function useNavigateAfterSave() {
  const router = useRouter();
  return (href: string, message = "已保存") => {
    const current = new URL(location.href);
    const next = new URL(href, current);
    // Vinext clears visited, prefetched and history snapshots synchronously.
    // Clear them before push can read a stale destination.
    router.refresh();
    if (next.pathname !== current.pathname || next.search !== current.search) router.push(href);
    window.dispatchEvent(new CustomEvent(saveEvent, { detail: message }));
  };
}

export function SaveNotice() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let hide: number | undefined;
    function show(event: Event) {
      setMessage((event as CustomEvent<string>).detail);
      clearTimeout(hide);
      hide = window.setTimeout(() => setMessage(""), 2600);
    }
    window.addEventListener(saveEvent, show);
    return () => { window.removeEventListener(saveEvent, show); clearTimeout(hide); };
  }, []);

  return <div className="save-notice" role="status">
    {message && <span><Check size={16} aria-hidden="true" />{message}</span>}
  </div>;
}

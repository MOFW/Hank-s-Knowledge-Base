"use client";

import { useTransition, type ComponentProps } from "react";
import { useRouteTransition } from "./route-transition";

export function GetForm({ children, action, ...props }: Omit<ComponentProps<"form">, "action" | "method" | "onSubmit"> & { action: string }) {
  const { navigate } = useRouteTransition();
  const [pending, startTransition] = useTransition();
  return <form {...props} action={action} method="get" aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    for (const [name, value] of new FormData(event.currentTarget, submitter)) {
      if (typeof value === "string" && value !== "") params.append(name, value);
    }
    const target = params.size ? `${action}?${params}` : action;
    if (action === location.pathname) startTransition(() => navigate(target));
    else navigate(target);
  }}>
    {children}
    <span className="search-progress" role="status">{pending ? "正在加载…" : ""}</span>
  </form>;
}

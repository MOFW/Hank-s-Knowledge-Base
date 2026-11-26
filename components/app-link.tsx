"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ComponentProps } from "react";
import { useRouteTransition } from "./route-transition";

const prefetchOptions = { kind: "full" } as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

export function AppLink({ href, prefetch = false, scroll, onNavigate, onClick, children, ...props }:
  Omit<ComponentProps<"a">, "href"> & { href: string; prefetch?: boolean; scroll?: boolean; onNavigate?: (event: { preventDefault: () => void }) => void }) {
  const router = useRouter();
  const { navigate } = useRouteTransition();
  const internal = href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/") &&
    !props.download && (!props.target || props.target === "_self");
  useEffect(() => {
    if (internal && prefetch) router.prefetch(href, prefetchOptions);
  }, [href, internal, prefetch, router]);

  return <a href={href} data-app-link={internal ? "" : undefined} {...props} onClick={(event) => {
    onClick?.(event);
    if (!internal || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    let handled = false;
    onNavigate?.({ preventDefault: () => { handled = true; } });
    // Vinext beta.5's production Link bundle loses its lazy navigation export.
    // The public router still drives the same App Router and history.
    if (!handled) navigate(href, { scroll });
  }}>
    {children}
  </a>;
}

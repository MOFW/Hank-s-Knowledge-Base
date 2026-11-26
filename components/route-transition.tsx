"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RouteLoading } from "./route-loading";

type Navigate = (href: string, options?: { revalidate?: boolean; scroll?: boolean }) => void;
type Destination = { href: string; from: string; path: string; failed: boolean; changesPage: boolean; scroll: boolean };
const RouteContext = createContext<{ path: string; navigate: Navigate } | null>(null);

function routeKey(path: string, search: string) {
  return search ? `${path}?${search}` : path;
}

export function useRouteTransition() {
  const route = useContext(RouteContext);
  if (!route) throw new Error("RouteTransition is required");
  return route;
}

export function RouteTransition({ header, children }: { header: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const router = useRouter();
  const committed = routeKey(pathname, query);
  const [destination, setDestination] = useState<Destination | null>(null);
  const intent = useRef<Destination | null>(null);
  const [revealed, setRevealed] = useState(false);
  const showDestination = destination && (destination.failed || destination.path !== pathname);

  useLayoutEffect(() => {
    const active = intent.current;
    if (!active || active.failed || active.from === committed) return;
    intent.current = null;
    setDestination(null);
    setRevealed(active.changesPage);
  }, [committed, pathname]);

  useEffect(() => {
    function failed(event: Event) {
      const active = intent.current;
      if (!active) return;
      const url = new URL((event as CustomEvent<string>).detail, location.origin);
      const target = new URL(active.href, location.origin);
      if (routeKey(url.pathname, url.searchParams.toString()) !== routeKey(target.pathname, target.searchParams.toString())) return;
      event.preventDefault();
      const error = { ...active, failed: true };
      intent.current = error;
      setDestination(error);
    }
    function traverse() {
      intent.current = null;
      setDestination(null);
      setRevealed(false);
    }
    window.addEventListener("hkb:route-failed", failed);
    window.addEventListener("popstate", traverse);
    return () => {
      window.removeEventListener("hkb:route-failed", failed);
      window.removeEventListener("popstate", traverse);
    };
  }, []);

  useLayoutEffect(() => {
    if (showDestination && destination.scroll && destination.path !== pathname) window.scrollTo(0, 0);
  }, [showDestination, destination, pathname]);

  const navigate: Navigate = (href, options) => {
    const url = new URL(href, location.origin);
    const search = url.searchParams.toString();
    const target = routeKey(url.pathname, search);
    if (target === committed && !url.hash && !options?.revalidate && !intent.current) return;
    if (target !== committed) {
      // This state update is urgent. The router can commit after the RSC round trip.
      const next = {
        href, from: committed, path: url.pathname, failed: false,
        changesPage: url.pathname !== pathname, scroll: options?.scroll !== false,
      };
      intent.current = next;
      setDestination(next);
      setRevealed(false);
    } else if (intent.current) {
      intent.current = null;
      setDestination(null);
    }
    if (target === committed && !url.hash && options?.revalidate && !destination) {
      router.refresh();
      return;
    }
    router.push(href, { scroll: options?.scroll });
    // Vinext clears its navigation cache immediately. With a push already
    // scheduled, refresh does not launch a second RSC request.
    if (options?.revalidate) router.refresh();
  };

  return <RouteContext.Provider value={{ path: destination?.path ?? pathname, navigate }}>
    {header}
    <main id="main" className="shell" tabIndex={-1}>
      {showDestination && <div className="route-arrival" key={destination.path}>
        <RouteLoading path={destination.path} retry={destination.failed ? () => navigate(destination.href, { scroll: destination.scroll }) : undefined} />
      </div>}
      <div hidden={Boolean(showDestination)} className={revealed ? "route-content-arrival" : undefined}>{children}</div>
    </main>
  </RouteContext.Provider>;
}

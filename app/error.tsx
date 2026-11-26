"use client";

import { usePathname, useRouter } from "next/navigation";
import { RouteLoading } from "@/components/route-loading";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const path = usePathname();
  const router = useRouter();
  return <RouteLoading path={path} retry={() => {
    router.refresh();
    reset();
  }} />;
}

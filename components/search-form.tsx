import type { ReactNode } from "react";
import { GetForm } from "./get-form";

export function SearchForm({ children, className }: { children: ReactNode; className: string }) {
  return <GetForm className={className} action="/search" role="search">{children}</GetForm>;
}

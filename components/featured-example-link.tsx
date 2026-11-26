"use client";

import { ArrowRight } from "lucide-react";
import { rememberExample, type ExampleSource } from "@/lib/example-return";
import { AppLink } from "./app-link";
import { useRouteTransition } from "./route-transition";

export function FeaturedExampleLink({ source }: { source: ExampleSource }) {
  const { navigate } = useRouteTransition();
  const { topicId, questionId, courseId } = source;
  const url = new URLSearchParams({ fromTopic: topicId, fromExample: questionId });
  if (courseId) url.set("fromCourse", courseId);
  const href = `/questions/${questionId}?${url}`;
  return <AppLink className="text-link" href={href} data-featured-solution onClick={(event) => {
    const example = event.currentTarget.closest<HTMLElement>("[data-featured-example]");
    if (!example || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const token = rememberExample(source, example);
    event.preventDefault();
    navigate(href + (token ? `&readingVisit=${token}` : ""));
  }}>完整解答与追问<ArrowRight size={15} aria-hidden="true" /></AppLink>;
}

import type { ZodIssue } from "zod";

export function inputPointer(parts: (string | number)[]) {
  return parts.map((part) => "/" + String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

export function valueType(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

export function fieldValue(value: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((field, key) => field && typeof field === "object" && Object.hasOwn(field, key)
    ? (field as Record<string | number, unknown>)[key] : undefined, value);
}

export function zodInputDetails(issues: ZodIssue[], input: unknown) {
  return issues.slice(0, 20).flatMap((issue) => {
    const path = inputPointer(issue.path);
    const actual = valueType(fieldValue(input, issue.path));
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: inputPointer([...issue.path, key]), expected: "omitted", actual: valueType(fieldValue(input, [...issue.path, key])),
        suggestion: "Remove this field.", message: issue.message,
      }));
    }
    const expected = issue.code === "invalid_type" ? issue.expected
      : issue.code === "invalid_enum_value" || issue.code === "invalid_union_discriminator" ? issue.options.join(" | ")
      : issue.code === "invalid_literal" ? String(issue.expected)
      : issue.code === "invalid_string" && issue.validation === "uuid" ? "UUID string" : issue.message;
    return [{
      path, expected, actual, message: issue.message,
      suggestion: issue.code === "invalid_type" ? `Provide a value of type ${expected}.` : issue.message,
    }];
  }).slice(0, 20);
}

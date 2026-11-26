import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { emptyWrite, questionPatch } from "@/domain/questions";
import { api, expectedVersion, privateHeaders, result, writeInput } from "@/lib/http";
import { plainSolutionMarkdown } from "@/domain/solution-layers";
import { deleteQuestion, getQuestion, updateQuestion } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (request, { ownerId, requestId }, route: Route) => {
  const question = await getQuestion(idSchema.parse((await route.params).id), ownerId);
  if (!question) throw new Problem(404, "NOT_FOUND", "找不到该题目。");
  const view = new URL(request.url).searchParams.get("view");
  if (view === "statement") {
    const { statementMd, originalAssetIds } = question;
    return result({ statementMd, originalAssetIds }, requestId, 200, question.rowVersion);
  }
  if (view === "solution-markdown") {
    const markdown = plainSolutionMarkdown(question);
    if (!markdown.trim()) throw new Problem(404, "NOT_FOUND", "该题目暂无解答正文。");
    return new Response(markdown, { headers: {
      ...privateHeaders,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="solution.md"',
      ETag: `"v${question.rowVersion}"`,
    } });
  }
  return result(question, requestId, 200, question.rowVersion);
});

export const PATCH = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, questionPatch);
  const saved = await updateQuestion(id, input, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});

export const DELETE = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { ctx } = await writeInput(request, ownerId, emptyWrite);
  const saved = await deleteQuestion(id, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});

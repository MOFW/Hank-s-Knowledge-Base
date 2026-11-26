import { reviewChecks } from "@/domain/ai-review";
import { displayDateTime } from "@/lib/learning-display";
import type { reviewHistory } from "@/services/ai-review";

type Run = Awaited<ReturnType<typeof reviewHistory>>["runs"][number];
const checks: Record<typeof reviewChecks[number], string> = {
  statement: "题面完整性", math: "数学正确性", derivation: "推导", answers_question: "解答对应题目",
  follow_ups: "追问", annotations: "公式注解", attribution: "作者与解释归属", evidence: "来源证据",
  visual: "图片及附件", classification: "课程与知识点", duplicates: "重复及冲突",
};
const reasons: Record<string, string> = {
  MODEL_REVIEW_REQUIRED: "模型报告需要复核", ASSIST_ONLY: "当前为辅助审核模式",
  DEPLOYMENT_GATE: "部署尚未开放自动批准", PREEXISTING_CANDIDATE: "候选早于本次开启条件批准",
  UNVERIFIED_SOURCE: "来源原文尚未独立核实", MATERIAL_GAP_OR_SCOPE: "有图片、材料缺口或长对话范围待核对",
  IMPORT_VALIDATION: "导入校验有待解决的问题", DUPLICATE_RISK: "可能与其他题目重复",
  OUTSIDE_ARITHMETIC_POLICY: "超出可独立复算的整数单步运算范围", VERSION_CHANGED: "候选已更新或处理",
  PLAN_CHANGED: "当前导入计划已变化", LIMIT_OR_CONCURRENT_CHANGE: "批准额度已用完或处理条件已变化",
  COMMIT_RETRY_MANUALLY: "提交未确认，请核对最新状态后人工处理", RECHECKING: "审核已保存，正在复核入库条件",
  MODEL_VERSION: "返回的模型版本尚未登记",
};
const failures: Record<string, string> = {
  missing_key: "未配置服务端密钥", authentication: "DeepSeek 认证失败", timeout: "DeepSeek 请求超时",
  rate_limit: "DeepSeek 限流", invalid_json: "返回的 JSON 无效", invalid_schema: "报告字段不符合约定",
  empty: "DeepSeek 返回空结果", truncated: "报告被截断", incomplete: "报告未完整返回",
  input_too_large: "候选超过单次材料上限", budget_or_state_changed: "预算不足或审核状态已变化",
  interrupted: "任务中断，可以重新审核", superseded: "已由手动审核接替", invalid_model: "模型配置无效",
  network: "网络连接失败", provider_unavailable: "DeepSeek 暂时不可用",
};
const statusLabels = { queued: "等待执行", running: "审核中", complete: "审核完成", failed: "审核失败",
  auto_committed: "已自动批准并入库", interrupted: "审核中断" };
const conclusions = { pass: "通过", revise: "建议修订", manual_review: "转人工审核", reject: "建议拒绝" };
const checkLabels = { pass: "通过", fail: "有问题", unknown: "未能核实", not_applicable: "不适用" };

export function AiReviewReport({ run, currentVersion }: { run: Run; currentVersion: number }) {
  const { report } = run;
  const stale = run.itemVersion !== currentVersion && !(run.state === "auto_committed" && run.itemVersion + 2 === currentVersion);
  return <details className="import-detail" suppressHydrationWarning>
    <summary>DeepSeek · {statusLabels[run.state]}{report && " · " + conclusions[report.decision]}{stale && " · 已过期"}</summary>
    <p className="field-hint">候选 v{run.itemVersion} · {displayDateTime(run.finishedAt ?? run.createdAt)}
      {run.model && " · " + run.model}{run.providerModel && " / " + run.providerModel}</p>
    {run.failure && <p>{failures[run.failure] ?? "本次审核未完成，可重试或人工处理。"}</p>}
    {run.reasons?.length ? <ul>{run.reasons.map((reason) => <li key={reason}>
      {reasons[reason] ?? (reason.startsWith("CHECK_") ? "需核对" + checks[reason.slice(6) as keyof typeof checks] : reason)}
    </li>)}</ul> : null}
    {report && <>
      <p>{report.summary}（风险 {report.risk_level}）</p>
      <ul>{reviewChecks.map((check) => <li key={check}>{checks[check]} · {checkLabels[report.checks[check]]}</li>)}</ul>
      <p>数学核对 · {report.math_assessment}</p><p>证据核对 · {report.evidence_assessment}</p>
      {[["报告问题", report.issues], ["建议修订", report.suggested_corrections]].map(([label, findings]) =>
        typeof label === "string" && Array.isArray(findings) && findings.length > 0 && <section key={label}>
          <h3>{label}</h3><ul>{findings.map(({ path, location, reason, suggestion }, index) => <li key={index}>
            <code>{path}</code> {location} · {reason}{suggestion && <p>{suggestion}</p>}
          </li>)}</ul>
        </section>)}
    </>}
    {run.durationMs !== null && <p className="field-hint">{run.durationMs} ms · 输入 {run.inputTokens ?? "未知"}
      {" "}· 输出 {run.outputTokens ?? "未知"} · 计入预算 USD {(run.costMicros / 1_000_000).toFixed(6)}</p>}
  </details>;
}

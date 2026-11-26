"use client";

import { useState } from "react";
import type { SourceWitness } from "@/domain/ai-review";
import type { getReviewSettings } from "@/services/ai-review";

type SettingsView = Awaited<ReturnType<typeof getReviewSettings>>;
const blank: SourceWitness = { title: "", locator: "", quote: "" };
const budgetText = (value: number) => (value / 1_000_000).toFixed(6).replace(/(\.\d{2,}?)0+$/, "$1");
const sitesHelp = "https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites#update-secrets-and-environment-variables";

export function AiReviewSettings({ initial }: { initial: SettingsView }) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState(initial.settings);
  const [budget, setBudget] = useState(budgetText(initial.settings.dailyBudgetMicros));
  const [budgetError, setBudgetError] = useState(false);
  const [witness, setWitness] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/imports/ai-review-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const { data, error } = await response.json() as { data: SettingsView; error?: { message: string } };
      if (!response.ok) throw new Error(error?.message || "保存失败。");
      setView(data);
      setMessage("已保存。");
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(settings: SettingsView["settings"]) {
    const saved = await save({ action: "settings", revision: view.revision, settings });
    if (!saved) return;
    setDraft(saved.settings);
    setBudget(budgetText(saved.settings.dailyBudgetMicros));
    setBudgetError(false);
  }

  return <>
    <section className="create-panel ai-settings">
      <h2>DeepSeek API 密钥</h2>
      <p>{view.keyConfigured ? "已配置" : "待配置"} · {view.model ?? "模型配置无效"}</p>
      {!view.keyConfigured && <p className="field-hint">在 ChatGPT 的 Sites 列表中打开这个站点的项目设置，在 Secrets（环境变量）中
        添加 <code>DEEPSEEK_API_KEY</code>，标记为密钥，再发布以应用配置。
        <a className="text-link" href={sitesHelp} target="_blank" rel="noreferrer">查看 Sites 配置说明</a></p>}
    </section>
    <section className="create-panel ai-settings">
      <h2>审核模式与限额</h2>
      <p className="field-hint">启用后，DeepSeek 会收到题面、解答、追问、注解和必要的引句。请先移除无关个人资料。
        原图、附件和整份聊天档案不会随审核发送。</p>
      <form className="ai-settings-form" onSubmit={(event) => {
        event.preventDefault();
        const value = budget.trim();
        const dollars = Number(value.replace(",", "."));
        if (!/^(?:\d+(?:[.,]\d{0,6})?|[.,]\d{1,6})$/.test(value) || dollars > 20) {
          setBudgetError(true);
          event.currentTarget.querySelector<HTMLInputElement>("#ai-daily-budget")?.focus();
          return;
        }
        const limit = new FormData(event.currentTarget).get("dailyApprovalLimit");
        void saveSettings({ ...draft, dailyApprovalLimit: limit === null ? draft.dailyApprovalLimit : Number(limit),
          dailyBudgetMicros: Math.round(dollars * 1_000_000) });
      }}>
        <label className="check-field"><input type="checkbox" checked={draft.consent} onChange={(event) => {
          const consent = event.currentTarget.checked;
          setDraft({ ...draft, consent, mode: consent && draft.mode === "off" ? "assist" : consent ? draft.mode : "off" });
        }} /> <span>我同意向 DeepSeek 发送上述审核材料</span></label>
        <label>模式 <select aria-describedby="ai-mode-help" value={draft.mode}
          onChange={(event) => setDraft({ ...draft, mode: event.target.value as typeof draft.mode })}>
          <option value="off">关闭</option>
          <option value="assist" disabled={!draft.consent}>辅助审核</option>
          <option value="conditional" disabled={!draft.consent || !view.conditionalReady || !view.keyConfigured}>有条件自动批准</option>
        </select></label>
        <p className="field-hint" id="ai-mode-help">辅助审核只生成报告，由你决定是否入库。
          {!view.conditionalReady ? " 正式自动批准权限待开放。" : !view.keyConfigured ? " 配置密钥后可选择有条件自动批准。" : ""}</p>
        <label htmlFor="ai-daily-budget">每日审核预算（美元）</label>
        <input id="ai-daily-budget" className="ai-settings-amount" type="text" inputMode="decimal" placeholder="0.10" value={budget}
          aria-invalid={budgetError} aria-describedby={budgetError ? "ai-budget-help ai-budget-error" : "ai-budget-help"}
          onChange={(event) => { setBudget(event.currentTarget.value); setBudgetError(false); }} />
        <p className="field-hint" id="ai-budget-help">试用可填 0.10，表示每天 10 美分。填 0 会暂停 API 请求，预算在北京时间零点重置。
          每次调用前会预留费用，收到用量后按估算费用记账。</p>
        {budgetError && <p className="import-error" id="ai-budget-error" role="alert">请输入 0 到 20 美元，例如 0.10。</p>}
        {draft.mode === "conditional" && <fieldset>
          <legend>自动批准</legend>
          <label>每日自动批准题数 <input type="number" name="dailyApprovalLimit" min="0" max="20" required defaultValue={draft.dailyApprovalLimit} /></label>
          <label className="check-field"><input type="checkbox" checked={draft.allowIntegerArithmetic}
            onChange={(event) => setDraft({ ...draft, allowIntegerArithmetic: event.target.checked })} />
            <span>允许可独立复算的单步整数加减乘</span></label>
        </fieldset>}
        <div className="actions">
          <button className="button primary" disabled={busy || (!draft.consent && draft.mode !== "off")}>保存审核设置</button>
          {view.settings.mode === "conditional" && <button type="button" className="button" disabled={busy} onClick={() => {
            void saveSettings({ ...view.settings, mode: "assist" });
          }}>暂停自动批准</button>}
        </div>
      </form>
    </section>
    <details className="create-panel ai-settings">
      <summary>已独立核对的题面来源</summary>
      <p className="field-hint">此项用于自动批准，使用辅助审核时可以跳过。登记前请核对来源原文，标题、定位和完整题面须与候选匹配。</p>
      <form className="ai-settings-form" onSubmit={async (event) => {
        event.preventDefault();
        if (await save({ action: "trust_source", witness })) setWitness(blank);
      }}>
        <label>来源标题 <input required maxLength={240} value={witness.title}
          onChange={(event) => setWitness({ ...witness, title: event.target.value })} /></label>
        <label>引句定位 <input required maxLength={512} value={witness.locator}
          onChange={(event) => setWitness({ ...witness, locator: event.target.value })} /></label>
        <label>完整原文 <textarea required maxLength={512} value={witness.quote}
          onChange={(event) => setWitness({ ...witness, quote: event.target.value })} /></label>
        <button className="button" disabled={busy}>登记核验过的原文</button>
      </form>
      {view.sources.length > 0 && <ul className="import-duplicates">{view.sources.map(({ digest, witness }) => <li key={digest}>
        <strong>{witness.title}</strong> · <span>{witness.locator}</span><p>{witness.quote}</p>
        <button className="button small" type="button" disabled={busy} onClick={() => void save({ action: "remove_source", digest })}>撤销核验</button>
      </li>)}</ul>}
    </details>
    <p role="status">{message}</p>
  </>;
}

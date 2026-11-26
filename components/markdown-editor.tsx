"use client";

import { AppLink } from "@/components/app-link";
import { lazy, Suspense, useId, useRef, useState } from "react";
import { Check, Eye, PencilLine, Save } from "lucide-react";

const Preview = lazy(() => import("./markdown").then(({ Markdown }) => ({ default: Markdown })));

export function MarkdownEditor({ label, name, value, onChange, rows = 8, placeholder }: {
  label: string; name: string; value: string; onChange: (value: string) => void; rows?: number; placeholder?: string;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [surfaceHeight, setSurfaceHeight] = useState(0);

  function showPreview() {
    if (preview) return;
    setSurfaceHeight(surface.current?.offsetHeight ?? 0);
    setPreview(true);
  }

  function insert(template: string) {
    const start = input.current?.selectionStart ?? value.length;
    const end = input.current?.selectionEnd ?? start;
    onChange(value.slice(0, start) + template + value.slice(end));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + template.length, start + template.length);
    });
  }

  return <div className="editor-box markdown-editor" data-mode-changed={surfaceHeight > 0 || undefined}>
    <div className="editor-toolbar">
      <label htmlFor={id}>{label}</label>
      <div className="editor-modes" role="group" aria-label={`${label}显示方式`}>
        <button className="button small" type="button" aria-pressed={!preview} onClick={() => setPreview(false)}><PencilLine size={15} aria-hidden="true" />编辑</button>
        <button className="button small" type="button" aria-pressed={preview} onClick={showPreview}><Eye size={15} aria-hidden="true" />预览</button>
      </div>
    </div>
    <div className="editor-surface" ref={surface} hidden={preview}>
      <div className="formula-toolbar">
        <span>插入</span>
        <button type="button" onClick={() => insert("\n\n$$\nx^2 + y^2 = 1\n$$\n")}>独立公式</button>
        <button type="button" onClick={() => insert("\n\n$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$\n")}>矩阵</button>
      </div>
      <textarea ref={input} id={id} name={name} className="markdown-input" rows={rows}
        aria-describedby={`${id}-help`} spellCheck={false} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
    {preview && <div className="editor-preview" role="region" aria-label={`${label}预览`} tabIndex={0} style={{ minBlockSize: surfaceHeight }}>
      {value.trim() ? <Suspense fallback={<p className="empty" role="status">正在加载预览…</p>}><Preview source={value} /></Suspense> : <p className="empty">暂无内容。</p>}
    </div>}
    <p className="field-hint" id={`${id}-help`}>Markdown · <code>$…$</code> 行内公式 · <code>$$…$$</code> 独立公式</p>
  </div>;
}

export function MarkdownHelp() {
  return <details className="editor-help">
    <summary>排版与公式帮助</summary>
    <div>
      <p>使用 <code>## 小节标题</code> 组织笔记；表格、列表与代码块沿用 Markdown 语法。长公式可用 <code>aligned</code> 分行。</p>
      <pre>{"$$\n\\begin{aligned}\nf(x) &= x^2 + 2x + 1 \\\\\n     &= (x+1)^2\n\\end{aligned}\n$$"}</pre>
      <p>定义、定理、证明、例题、注意与补充可以用以下写法。证明和补充会默认折叠。</p>
      <pre>{"> [!定理] 定理名称\n> 在这里记录定理与公式。\n\n> [!证明]\n> 在这里展开推导过程。"}</pre>
    </div>
  </details>;
}

type Feedback = {
  pending: boolean; error: string; conflict?: boolean; succeeded?: boolean; dirty: boolean; savedHref?: string;
};

export function EditorFeedback({ pending, error, conflict, succeeded, dirty, savedHref }: Feedback) {
  return <div className="editor-feedback">
    {error ? <div className="save-error" role="alert">
      <strong>{conflict ? "保存遇到版本冲突" : "未确认保存成功"}</strong>
      <p>{error}</p>
      <p>当前输入仍保留在此页。{conflict ? "请先保留自己的修改，再核对最新内容。" : "可以修正输入后再保存；网络异常时可重试相同内容。"}</p>
      {conflict && savedHref && <a className="text-link" href={savedHref} target="_blank" rel="noreferrer">在新标签页查看已保存内容 ↗</a>}
    </div> : <p className={succeeded ? "save-status" : "field-hint"} role="status">
      {pending ? "正在保存…" : succeeded ? <><Check size={15} aria-hidden="true" />已保存</> : dirty ? "有未保存的修改" : null}
    </p>}
  </div>;
}

export function EditorActions({ label, cancelHref, disabled, ...feedback }: Feedback & {
  label: string; cancelHref: string; disabled: boolean;
}) {
  return <div className="editor-footer">
    <EditorFeedback {...feedback} />
    <div className="actions">
      <button className="button primary" type="submit" disabled={disabled}><Save size={16} aria-hidden="true" />{feedback.pending ? "正在保存…" : label}</button>
      <AppLink className="button" href={cancelHref}>取消</AppLink>
    </div>
  </div>;
}

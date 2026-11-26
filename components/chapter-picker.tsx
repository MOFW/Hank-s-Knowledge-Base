"use client";

import { useId, useState, type CSSProperties } from "react";
import { Check, FolderTree } from "lucide-react";
import { matchesDirectory, type chapterOptions } from "@/lib/directory";
import { BrowseDialog } from "./browse-dialog";

export type ChapterOption = ReturnType<typeof chapterOptions>[number];

export function ChapterPicker({ name, options, empty, initial, label = "章节", rootOption, onSelect }: {
  name?: string; options: ChapterOption[]; empty: string; initial?: string | null; label?: string;
  rootOption?: { id: string; title: string }; onSelect?: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial ?? "");
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const selected = options.find((option) => option.id === value);
  const visible = term ? options.filter(({ label }) => matchesDirectory(query, label)) : options;
  return <div className="chapter-picker" data-ui-only>
    {name && <input type="hidden" name={name} value={value} />}
    <BrowseDialog title={label} trigger={<><FolderTree size={16} aria-hidden="true" /><span>{label} · {selected?.title ?? (rootOption?.id === value ? rootOption.title : empty)}</span></>}>
      {({ close, listRef }) => {
        function choose(next: string) {
          setValue(next);
          onSelect?.(next);
          setQuery("");
          close();
        }
        return <>
          <div className="browse-search">
            <label htmlFor={id}>搜索章节名称</label>
            <input id={id} autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (visible.length === 1) choose(visible[0].id);
            }} />
          </div>
          <div className="browse-list" ref={listRef}>
            {!term && <button className="browse-row" type="button" aria-pressed={!value} data-browse-item onClick={() => choose("")}>{empty}
              {!value && <Check size={16} aria-hidden="true" />}</button>}
            {!term && rootOption && <button className="browse-row" type="button" aria-pressed={rootOption.id === value} data-browse-item onClick={() => choose(rootOption.id)}>
              {rootOption.title}{rootOption.id === value && <Check size={16} aria-hidden="true" />}</button>}
            {visible.map((option) => {
              const match = term ? option.title.toLocaleLowerCase().indexOf(term) : -1;
              return <button className="browse-row picker-chapter" style={{ "--depth": term ? 0 : option.depth } as CSSProperties} type="button"
                key={option.id} aria-pressed={option.id === value} data-browse-item onClick={() => choose(option.id)}>
                <span>{match < 0 ? option.title : <>{option.title.slice(0, match)}<mark>{option.title.slice(match, match + term.length)}</mark>{option.title.slice(match + term.length)}</>}
                  {(term || option.id === value) && <small>{option.label}</small>}</span>
                {option.id === value && <Check size={16} aria-hidden="true" />}
              </button>;
            })}
            {term && !visible.length && <p className="empty">没有匹配的章节。</p>}
          </div>
        </>;
      }}
    </BrowseDialog>
    {selected && <small className="field-hint picker-path">{selected.label}</small>}
  </div>;
}

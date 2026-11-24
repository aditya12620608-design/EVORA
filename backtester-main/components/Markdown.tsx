"use client";

import React from "react";

/** Tiny markdown renderer for the in-app docs (headings, code, tables, lists, bold). */

function inline(text: string, key: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // split on `code` and **bold**
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(
        <code key={`${key}-${i++}`} className="bg-panel2 px-1 font-mono text-[11px] text-accent">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ source }: { source: string }) {
  const out: React.ReactNode[] = [];
  const lines = source.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="my-2 overflow-x-auto border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink">
          {buf.join("\n")}
        </pre>
      );
      continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <table key={key++} className="my-2 border-collapse">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={`border border-line px-2 py-1 text-[11px] ${ri === 0 ? "bg-panel font-mono text-[10px] text-dim" : ""}`}>
                    {inline(c, key * 100 + ci)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("  "))) {
        if (lines[i].startsWith("- ")) items.push(lines[i].slice(2));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ink">
          {items.map((it, j) => (
            <li key={j}>{inline(it, key * 100 + j)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.startsWith("#")) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, "");
      const cls =
        level === 1
          ? "mt-2 mb-3 text-[18px] font-bold tracking-tight text-ink"
          : level === 2
            ? "mt-5 mb-2 border-b border-line pb-1 text-[14px] font-semibold text-accent"
            : "mt-4 mb-1 text-[12px] font-bold text-ink";
      out.push(
        <div key={key++} className={cls}>
          {inline(text, key)}
        </div>
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph: join consecutive non-empty plain lines
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|```|\||- )/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(
      <p key={key++} className="my-1.5 text-[12px] leading-relaxed text-ink/90">
        {inline(buf.join(" "), key)}
      </p>
    );
  }

  return <div className="max-w-3xl">{out}</div>;
}

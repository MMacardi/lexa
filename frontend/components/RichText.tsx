import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Tiny, safe markdown renderer for chat replies: **bold**, *italic*, `code`,
// numbered/bulleted lists and line breaks. Builds React nodes (no innerHTML).
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={key++}>{m[2]}</em>);
    else if (m[3])
      out.push(
        <code key={key++} className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em]">
          {m[3]}
        </code>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <div className={cn("space-y-1.5", className)}>
      {lines.map((line, i) => {
        const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 font-semibold text-ink-faint">{num[1]}.</span>
              <span className="min-w-0">{inline(num[2])}</span>
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-ink-faint">•</span>
              <span className="min-w-0">{inline(bullet[1])}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className="leading-relaxed">
            <Fragment>{inline(line)}</Fragment>
          </p>
        );
      })}
    </div>
  );
}

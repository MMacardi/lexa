import { cn } from "@/lib/utils";

// Highlight every occurrence of the target word inside an example sentence so the
// learner's eye lands on it. For Latin scripts it also catches simple inflections
// (e.g. "run" → "running"); for other scripts it matches the word exactly.
function buildRegex(word: string): RegExp | null {
  const root = word.trim();
  if (!root) return null;
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isLatin = /^[A-Za-z][A-Za-z' -]*$/.test(root);
  return isLatin ? new RegExp(`(${esc}[A-Za-z]*)`, "gi") : new RegExp(`(${esc})`, "g");
}

export function HighlightWord({
  text,
  word,
  className,
}: {
  text: string;
  word: string;
  className?: string;
}) {
  const re = buildRegex(word);
  if (!re || !text) return <>{text}</>;
  // split() with a single capture group interleaves matches at odd indices.
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className={cn("rounded bg-news-hl px-1 font-semibold text-sage-deep", className)}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

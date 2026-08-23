// Tiny "PRO" badge shown on controls that are locked to the Pro plan.
export function ProTag({ className }: { className?: string }) {
  return (
    <span
      className={
        "ml-1 rounded bg-sage/20 px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-sage-deep " +
        (className ?? "")
      }
    >
      Pro
    </span>
  );
}

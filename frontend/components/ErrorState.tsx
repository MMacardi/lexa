import { Button } from "@/components/ui/button";

// Friendly error block with an optional retry action (e.g. backend down).
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-[18px] border border-warn/40 bg-warn-bg p-6 text-center">
      <p className="text-sm font-semibold text-warn-text">Something went wrong</p>
      <p className="mt-1 text-sm text-warn-text/80">{message}</p>
      <p className="mt-2 text-xs text-ink-faint">
        Is the backend running? Try again in a moment.
      </p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

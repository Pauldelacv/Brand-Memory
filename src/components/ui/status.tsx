import { cn } from "@/lib/cn";
import type { SourceStatus } from "@/types/domain";

const STATUS_STYLES: Record<SourceStatus, string> = {
  UPLOADED: "border-rule-strong text-ink-muted",
  PROCESSING: "border-warning text-warning",
  READY: "border-positive text-positive",
  FAILED: "border-critical text-critical",
};

export function StatusPill({ status }: { status: SourceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 font-mono text-[0.6875rem] tracking-[0.08em] uppercase",
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border border-rule bg-paper px-2 py-0.5 font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Relevance readout on retrieved sources — a bar, not a decorative badge. */
export function RelevanceBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="inline-flex items-center gap-2" title={`Relevance ${percent.toFixed(0)}%`}>
      <span className="block h-1 w-16 bg-rule">
        <span className="block h-full bg-signal" style={{ width: `${percent}%` }} />
      </span>
      <span className="font-mono text-[0.6875rem] text-ink-faint">{percent.toFixed(0)}%</span>
    </span>
  );
}

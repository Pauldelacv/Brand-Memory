import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const controlClasses =
  "w-full border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label block">{label}</span>
      {children}
      {hint && !error ? <span className="block text-xs text-ink-faint">{hint}</span> : null}
      {error ? <span className="block text-xs text-critical">{error}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClasses, "h-10 pr-8", className)} {...props} />;
}

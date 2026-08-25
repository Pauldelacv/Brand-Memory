"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md">
        <p className="label text-critical">Something failed</p>
        <h1 className="mt-2 font-serif text-2xl text-ink">This screen could not be loaded</h1>
        <p className="mt-2 text-sm text-ink-muted">{error.message}</p>
        {error.digest ? (
          <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">ref {error.digest}</p>
        ) : null}
        <Button className="mt-5" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}

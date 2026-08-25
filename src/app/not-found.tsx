import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="label">404</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Nothing here</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This page does not exist, or it belongs to a workspace you cannot access.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm text-signal underline underline-offset-4"
        >
          Back to your brands
        </Link>
      </div>
    </div>
  );
}

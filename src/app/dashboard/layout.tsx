import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-6 px-6">
          <Link href="/dashboard" className="font-mono text-xs tracking-[0.18em] uppercase text-ink">
            Brand Memory
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-ink-muted sm:inline">{user.email}</span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
    </div>
  );
}

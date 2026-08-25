import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brand Memory",
  description: "A knowledge system for creative teams. The AI understands the brand before it creates for the brand.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

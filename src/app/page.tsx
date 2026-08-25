import { redirect } from "next/navigation";

export default function HomePage() {
  // Signed-out visitors are bounced to /login by the middleware.
  redirect("/dashboard");
}

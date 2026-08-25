import { AuthForm } from "@/components/auth-form";
import { signIn } from "@/actions/auth";

export const metadata = { title: "Sign in — Brand Memory" };

export default function LoginPage() {
  return <AuthForm action={signIn} mode="signin" />;
}

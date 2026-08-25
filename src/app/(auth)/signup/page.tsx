import { AuthForm } from "@/components/auth-form";
import { signUp } from "@/actions/auth";

export const metadata = { title: "Create an account — Brand Memory" };

export default function SignupPage() {
  return <AuthForm action={signUp} mode="signup" />;
}

import { login } from "./actions";
import { str } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = str(sp.next) || "/";
  const error = str(sp.error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-4">
      <form action={login} className="card w-full max-w-sm p-8">
        <img src="/logo.png" alt="RJL Capital Advisors" className="mx-auto mb-6 h-10" />
        <h1 className="mb-1 text-center text-lg font-semibold">RJL CRM</h1>
        <p className="mb-6 text-center text-sm text-muted">Enter the team password to continue.</p>
        <input type="hidden" name="next" value={next} />
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" autoFocus autoComplete="current-password" className="input" />
        {error && <div className="mt-2 text-sm text-red-700">That password isn&apos;t right.</div>}
        <button className="btn-primary mt-4 w-full justify-center" type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}

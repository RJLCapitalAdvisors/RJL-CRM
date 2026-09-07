import { login } from "./actions";
import { str } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = str(sp.next) || "/";
  const error = str(sp.error);
  const microsoft = Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID);
  const password = Boolean(process.env.APP_PASSWORD);
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-4">
      <div className="card w-full max-w-sm p-8">
        <img src="/logo.png" alt="RJL Capital Advisors" className="mx-auto mb-6 h-10" />
        <h1 className="mb-1 text-center text-lg font-semibold">RJL CRM</h1>
        <p className="mb-6 text-center text-sm text-muted">Sign in with your RJL Microsoft account.</p>
        {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error === "1" ? "That password isn't right." : error}</div>}
        {microsoft && (
          <a href={`/api/auth/microsoft?next=${encodeURIComponent(next)}`} className="btn-primary w-full justify-center">
            Sign in with Microsoft
          </a>
        )}
        {password && (
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer text-center text-muted">Use the team password instead</summary>
            <form action={login} className="mt-3">
              <input type="hidden" name="next" value={next} />
              <label className="label" htmlFor="password">
                Team password
              </label>
              <input id="password" name="password" type="password" autoComplete="current-password" className="input" />
              <button className="btn-secondary mt-3 w-full justify-center" type="submit">
                Sign in
              </button>
              <p className="mt-2 text-xs text-muted">The team password opens the CRM without knowing who you are, so Handle and other mailbox features need Microsoft sign-in.</p>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}

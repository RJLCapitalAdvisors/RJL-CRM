import { login } from "./actions";
import { str } from "@/lib/format";

export const metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = str(sp.next) || "/";
  const error = str(sp.error);
  const business = str(sp.business) === "IL" ? "IL" : str(sp.business) === "CA" ? "CA" : null;
  const israel = business === "IL";
  const microsoft = Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID);
  const password = Boolean(process.env.APP_PASSWORD);
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-4">
      <div className="card w-full max-w-sm p-8">
        {israel ? (
          <div className="mx-auto mb-6 w-fit rounded-lg bg-[#161b21] px-4 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/israel-logo.svg" alt="RJL Israel" className="h-8" />
          </div>
        ) : (
          <img src="/logo.png" alt="RJL Capital Advisors" className="mx-auto mb-6 h-10" />
        )}
        <h1 className="mb-1 text-center text-lg font-semibold">{israel ? "RJL Israel" : business === "CA" ? "RJL Capital Advisors" : "RJL CRM"}</h1>
        <p className="mb-6 text-center text-sm text-muted">
          {israel ? "Sign in with your @rjlisrael.com Microsoft account to open RJL Israel." : business === "CA" ? "Sign in with your @rjlcapadvisors.com Microsoft account to open RJL Capital Advisors." : "Sign in with your RJL Microsoft account. Each business opens with its own account; sign in to both, one at a time, to use both."}
        </p>
        {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error === "1" ? "That password isn't right." : error}</div>}
        {microsoft && (
          <a href={`/api/auth/microsoft?next=${encodeURIComponent(next)}${business ? `&business=${business}` : ""}`} className="btn-primary w-full justify-center">
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

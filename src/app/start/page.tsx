import Image from "next/image";
import Link from "next/link";

export const metadata = { title: "Choose a business" };

/** Two businesses, one sign-in: pick where to work. */
export default function StartPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0c0e11] px-6">
      <div className="grid w-full max-w-3xl gap-6 md:grid-cols-2">
        <Link href="/" className="group flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white px-8 py-12 text-center shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl">
          <Image src="/logo.png" alt="RJL Capital Advisors" width={220} height={78} className="h-auto w-52" />
          <div>
            <div className="text-lg font-semibold text-ink">RJL Capital Advisors</div>
            <div className="mt-1 text-sm text-muted">Deals, investors, progress reports, blasts</div>
          </div>
        </Link>
        <Link href="/israel" className="group flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-[#15181c] px-8 py-12 text-center shadow-xl transition hover:-translate-y-0.5 hover:border-sky/40 hover:shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-lg bg-white/10 text-3xl text-sky">✦</span>
            <span className="text-left leading-tight">
              <span className="block text-3xl font-semibold tracking-wide text-white">RJL</span>
              <span className="block text-xs uppercase tracking-[0.3em] text-sky">Israel</span>
            </span>
          </div>
          <div>
            <div className="text-lg font-semibold text-white">RJL Israel</div>
            <div className="mt-1 text-sm text-white/60">Apartments, buyers, agents and developers in Israel</div>
          </div>
        </Link>
      </div>
    </div>
  );
}

// app/page.tsx
import BrandCard from "@/components/BrandCard";
import QuoteHelperPanel from "@/components/QuoteHelperPanel";

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4 py-12">
      {children}
    </div>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-950 text-slate-50">
      <Container>
        <BrandCard />

        <div className="mt-4 flex justify-center">
          <a
            href="#demo"
            className="rounded-full bg-white/10 px-6 py-2 text-sm font-medium text-white shadow-sm ring-1 ring-white/20 hover:bg-white/20"
          >
            Watch demo
          </a>
        </div>

        {/* New: “example input” helper panel */}
        <QuoteHelperPanel />
      </Container>
    </main>
  );
}

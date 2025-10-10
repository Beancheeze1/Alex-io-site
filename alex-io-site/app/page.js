
"use client";
import { useMemo, useState } from "react";
import { Check, Zap, ShieldCheck, Timer, PhoneCall, Mail, ArrowRight, BarChart3, Database, Workflow, Bot, Settings2, Building2, CalendarClock, Lock, Rocket } from "lucide-react";

// Set to your real links
const CALENDLY_URL = "https://calendly.com/25thhourdesign";
const CONTACT_EMAIL = "chuckj@alex-io.com";
const DOCS_URL = "#";

export default function Page() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [billing, setBilling] = useState("monthly");

  const price = useMemo(() => {
    const mult = billing === "yearly" ? 0.9 : 1;
    return {
      starter: Math.round(299 * mult),
      growth: Math.round(799 * mult),
      scale: "Custom",
    };
  }, [billing]);

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent("Alex-IO: I'm interested");
    const body = encodeURIComponent(
      `Hi Alex-IO team,\n\n${message || "Tell us about your use case (volume, team size, goals)."}\n\nThanks,\n${email}`
    );
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }, [email, message]);

  return (
    <div>
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Bot size={18}/>
            </div>
            <span className="font-semibold tracking-tight">Alex-IO</span>
            <span className="ml-2 hidden rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 sm:inline-flex">HubSpot-native</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm hover:text-slate-700">Features</a>
            <a href="#how" className="text-sm hover:text-slate-700">How it works</a>
            <a href="#pricing" className="text-sm hover:text-slate-700">Pricing</a>
            <a href="#faq" className="text-sm hover:text-slate-700">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <a className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100" href={DOCS_URL}>Docs</a>
            <a className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-sm hover:bg-slate-800" href={CALENDLY_URL}>
              Book a demo <ArrowRight className="ml-2 inline h-4 w-4"/>
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-16 sm:pt-20" id="hero">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div className="order-2 lg:order-1">
            <span className="mb-3 inline-block rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">New</span>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Reply to inbound emails in <span className="text-slate-600">seconds</span>— with quotes, pricing tiers, and turn times.
            </h1>
            <p className="mt-4 max-w-xl text-slate-600">
              Alex-IO is a HubSpot-native email bot that drafts or sends accurate replies using your pricing breaks,
              SLA calendars, and rules. Human-review when you want it. Automation when you don’t.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a className="rounded-lg bg-slate-900 px-5 py-3 text-white hover:bg-slate-800" href={CALENDLY_URL}>
                <Rocket className="mr-2 inline h-4 w-4"/> Get a live demo
              </a>
              <a className="rounded-lg border px-5 py-3 hover:bg-slate-50" href="#pricing">
                <BarChart3 className="mr-2 inline h-4 w-4"/> See pricing
              </a>
            </div>
            <div className="mt-6 flex items-center gap-6 text-sm text-slate-600">
              <span className="flex items-center gap-2"><Timer className="h-4 w-4"/> <b>&lt;2 min</b> time-to-first-reply</span>
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4"/> Bounce & unsubscribe guards</span>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <div className="mx-auto w-full max-w-lg">
              <div className="rounded-2xl border bg-white shadow-xl">
                <div className="border-b p-6">
                  <div className="flex items-center gap-2 font-semibold"><Zap className="h-5 w-5"/> See it in action</div>
                  <div className="mt-1 text-sm text-slate-600">Send us a note—we’ll reply with a tailored demo.</div>
                </div>
                <div className="p-6">
                  <div className="grid gap-3">
                    <input className="w-full rounded-lg border px-3 py-2" placeholder="Your email" value={email} onChange={(e)=>setEmail(e.target.value)} />
                    <textarea className="w-full rounded-lg border px-3 py-2" rows={4} placeholder="What do you want to automate? e.g., pricing for 3 SKUs, SLA quotes, multi-tenant setup" value={message} onChange={(e)=>setMessage(e.target.value)} />
                    <div className="flex gap-2">
                      <a className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-center text-white hover:bg-slate-800" href={CALENDLY_URL}>
                        <CalendarClock className="mr-2 inline h-4 w-4"/> Book demo
                      </a>
                      <a className="flex-1 rounded-lg border px-4 py-2 text-center hover:bg-slate-50" href={mailtoHref}>
                        <Mail className="mr-2 inline h-4 w-4"/> Email us
                      </a>
                    </div>
                    <p className="text-xs text-slate-500">By booking or emailing, you consent to be contacted about Alex-IO. Unsubscribe anytime.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto mt-20 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Feature icon={<Workflow className="h-5 w-5" />} title="Deterministic quoting">
            Tiered pricing, multi-item carts, rush fees, tax, and business-day ETAs—always auditable.
          </Feature>
          <Feature icon={<Database className="h-5 w-5" />} title="Bring your data">
            Start with Google Sheets; graduate to Postgres with versioned pricing + turn times per tenant.
          </Feature>
          <Feature icon={<Building2 className="h-5 w-5" />} title="Multi-tenant by design">
            Install via HubSpot OAuth; isolate data by tenant; per-tenant rules and analytics.
          </Feature>
          <Feature icon={<Settings2 className="h-5 w-5" />} title="Review → Auto">
            Human-in-the-loop drafts in HubSpot, then one-click send—or go fully automatic by intent.
          </Feature>
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="Deliverability safeguards">
            DKIM/SPF/DMARC guide, bounce/NDR skip logic, unsubscribe compliance, rate limits.
          </Feature>
          <Feature icon={<BarChart3 className="h-5 w-5" />} title="Analytics & tagging">
            Tag contacts with intent and quote totals; daily email digests; CSV exports.
          </Feature>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <Step n={1} title="Connect HubSpot">
            Install the app via OAuth and select the team inbox. We verify webhooks and sender identity.
          </Step>
          <Step n={2} title="Load pricing & SLAs">
            Upload CSV or sync a sheet. Or use our DB schema for tiered pricing and turn times.
          </Step>
          <Step n={3} title="Go live (review or auto)">
            Start in review mode (drafts internal notes). Flip to auto when you’re confident.
          </Step>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
            <p className="mt-1 text-slate-600">Start small. Scale as you automate more.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border p-1 text-sm">
            <button onClick={()=>setBilling("monthly")} className={`rounded-full px-3 py-1 ${billing==="monthly"?"bg-slate-900 text-white":"text-slate-700"}`}>Monthly</button>
            <button onClick={()=>setBilling("yearly")} className={`rounded-full px-3 py-1 ${billing==="yearly"?"bg-slate-900 text-white":"text-slate-700"}`}>Yearly <span className="ml-1 opacity-70">(save 10%)</span></button>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <PriceCard title="Starter" price={`$${price.starter}/mo`} cta="Start pilot" features={["1 mailbox","Templates & intents","Review mode","Daily digest email"]} />
          <PriceCard title="Growth" highlighted price={`$${price.growth}/mo`} cta="Book a demo" features={["3 mailboxes","Quoting engine","Sheet/DB sync","Analytics tagging","Auto mode by intent"]} />
          <PriceCard title="Scale" price={`Custom`} cta="Talk to sales" features={["Unlimited mailboxes","SSO & SLAs","Advanced rules","Sandbox envs","Priority support"]} />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto mt-24 max-w-4xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-semibold tracking-tight">FAQ</h2>
        <div className="mt-6 space-y-4">
          <FAQ q="Does it actually send from our HubSpot inbox?" a="Yes. Replies are posted via HubSpot Conversations with your channelId/account and an agent actor, or drafted as internal notes in review mode."/>
          <FAQ q="Can it quote multiple items with tiered pricing?" a="Yes. We parse quantities and item codes, look up tiered unit prices and turn times, then compute totals and ETAs deterministically."/>
          <FAQ q="Where does pricing live?" a="Start with Google Sheets or CSV. As you scale, use Postgres with the schema we provide (versioned pricing & SLA tables)."/>
          <FAQ q="Will this break deliverability?" a="We guide you through DKIM/SPF/DMARC, honor unsubscribes, and skip bounces. Plus rate limits and working hours windows if you want them."/>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto my-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-6 rounded-2xl border bg-gradient-to-br from-white to-slate-50 p-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <h3 className="text-2xl font-semibold">Ready to reply in seconds?</h3>
            <p className="mt-1 text-slate-600">Connect HubSpot, paste pricing, and go live in 30 minutes.</p>
          </div>
          <div className="flex items-center gap-3 md:justify-end">
            <a className="rounded-lg bg-slate-900 px-5 py-3 text-white hover:bg-slate-800" href={CALENDLY_URL}>
              <PhoneCall className="mr-2 inline h-4 w-4"/> Book 30-min demo
            </a>
            <a className="rounded-lg border px-5 py-3 hover:bg-slate-50" href={`mailto:${CONTACT_EMAIL}`}>
              <Mail className="mr-2 inline h-4 w-4"/> Email sales
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white"><Lock size={16}/></div>
            <span className="text-sm text-slate-600">© {new Date().getFullYear()} Alex-IO. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <a className="hover:text-slate-800" href="#">Privacy</a>
            <a className="hover:text-slate-800" href="#">Terms</a>
            <a className="hover:text-slate-800" href="mailto:support@alex-io.com">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, title, children }) {
  return (
    <div className="rounded-2xl border bg-white">
      <div className="space-y-1 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold">{icon}{title}</div>
        <div className="text-base leading-relaxed text-slate-600">{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">{n}</div>
      <div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-1 text-slate-600">{children}</p>
      </div>
    </div>
  );
}

function PriceCard({ title, price, features, highlighted = false, cta }) {
  return (
    <div className={`rounded-2xl border bg-white ${highlighted ? "border-slate-900 shadow-lg" : ""}`}>
      <div className="border-b p-6">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold">{title}</div>
          {highlighted && <span className="rounded-full bg-slate-900 px-2 py-1 text-xs text-white">Most popular</span>}
        </div>
        <div className="mt-1 text-3xl font-bold">{price}</div>
        <div className="text-sm text-slate-600">Billed per month (yearly saves 10%)</div>
      </div>
      <div className="space-y-4 p-6">
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-3 text-slate-700"><Check className="mt-0.5 h-4 w-4"/>{f}</li>
          ))}
        </ul>
        <a className="block w-full rounded-lg bg-slate-900 px-4 py-2 text-center text-white hover:bg-slate-800" href={CALENDLY_URL}>
          {cta}
        </a>
      </div>
    </div>
  );
}

function FAQ({ q, a }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium">{q}</div>
      <div className="mt-1 text-slate-600">{a}</div>
    </div>
  );
}

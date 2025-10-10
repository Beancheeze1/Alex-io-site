export default function Page() {
  return (
    <main className="p-6 max-w-5xl mx-auto text-gray-900">
      <header className="flex justify-between items-center py-4 border-b">
        <h1 className="text-2xl font-bold">Alex-IO</h1>
        <nav className="flex gap-4 text-sm">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href="https://calendly.com/25thhourdesign" className="bg-black text-white px-3 py-1 rounded-md">Book a demo</a>
        </nav>
      </header>

      <section className="mt-10 text-center">
        <h2 className="text-3xl font-semibold mb-4">
          Reply to inbound emails in seconds— with quotes, pricing tiers, and turn times.
        </h2>
        <p className="text-gray-600 mb-6">
          Alex-IO is a HubSpot-native email bot that drafts or sends accurate replies using your pricing breaks,
          SLA calendars, and rules. Human-review when you want it. Automation when you don’t.
        </p>
        <div className="flex justify-center gap-3">
          <a href="https://calendly.com/25thhourdesign" className="bg-black text-white px-4 py-2 rounded-md">Get a live demo</a>
          <a href="#pricing" className="border border-gray-400 px-4 py-2 rounded-md">See pricing</a>
        </div>
      </section>

      <section id="features" className="mt-16 grid gap-8">
        <div>
          <h3 className="font-bold">Deterministic quoting</h3>
          <p>Tiered pricing, multi-item carts, rush fees, tax, and business-day ETAs—always auditable.</p>
        </div>
        <div>
          <h3 className="font-bold">Bring your data</h3>
          <p>Start with Google Sheets; graduate to Postgres with versioned pricing + turn times per tenant.</p>
        </div>
        <div>
          <h3 className="font-bold">Multi-tenant by design</h3>
          <p>Install via HubSpot OAuth; isolate data by tenant; per-tenant rules and analytics.</p>
        </div>
        <div>
          <h3 className="font-bold">Review → Auto</h3>
          <p>Human-in-the-loop drafts in HubSpot, then one-click send—or go fully automatic by intent.</p>
        </div>
        <div>
          <h3 className="font-bold">Deliverability safeguards</h3>
          <p>DKIM/SPF/DMARC guide, bounce/NDR skip logic, unsubscribe compliance, rate limits.</p>
        </div>
        <div>
          <h3 className="font-bold">Analytics & tagging</h3>
          <p>Tag contacts with intent and quote totals; daily email digests; CSV exports.</p>
        </div>
      </section>

      <section id="pricing" className="mt-20">
        <h2 className="text-2xl font-semibold mb-6">Simple pricing</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="border p-6 rounded-lg">
            <h3 className="font-bold">Starter</h3>
            <p className="text-sm mb-3">$299/mo</p>
            <ul className="text-sm mb-4">
              <li>1 mailbox</li>
              <li>Templates & intents</li>
              <li>Review mode</li>
              <li>Daily digest email</li>
            </ul>
            <a href="https://calendly.com/25thhourdesign" className="bg-black text-white px-3 py-1 rounded-md">Start pilot</a>
          </div>

          <div className="border p-6 rounded-lg bg-gray-50">
            <h3 className="font-bold">Growth</h3>
            <p className="text-sm mb-3">$799/mo</p>
            <ul className="text-sm mb-4">
              <li>3 mailboxes</li>
              <li>Quoting engine</li>
              <li>Sheet/DB sync</li>
              <li>Analytics tagging</li>
              <li>Auto mode by intent</li>
            </ul>
            <a href="https://calendly.com/25thhourdesign" className="bg-black text-white px-3 py-1 rounded-md">Book a demo</a>
          </div>

          <div className="border p-6 rounded-lg">
            <h3 className="font-bold">Scale</h3>
            <p className="text-sm mb-3">Custom</p>
            <ul className="text-sm mb-4">
              <li>Unlimited mailboxes</li>
              <li>SSO & SLAs</li>
              <li>Advanced rules</li>
              <li>Sandbox envs</li>
              <li>Priority support</li>
            </ul>
            <a href="mailto:chuckj@alex-io.com" className="bg-black text-white px-3 py-1 rounded-md">Talk to sales</a>
          </div>
        </div>
      </section>

      <footer className="mt-20 border-t pt-6 text-sm text-gray-500">
        <p>© 2025 Alex-IO. All rights reserved. • <a href="/privacy">Privacy</a> • <a href="/terms">Terms</a> • <a href="/support">Support</a></p>
      </footer>
    </main>
  );
}

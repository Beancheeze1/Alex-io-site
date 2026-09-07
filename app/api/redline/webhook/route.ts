// Suggested location in the Alex-IO Next.js app: app/api/redline/webhook/route.ts
//
// WHAT THIS DOES
// Listens for Stripe "checkout.session.completed" events on the Redline
// payment link, generates a license key from the customer's email, and
// emails them the download link + key via Microsoft Graph. No database
// required, no SMTP.
//
// LICENSE SCHEME
// key = HMAC-SHA256(email.lower(), REDLINE_LICENSE_SECRET), truncated and
// formatted as five-character groups. Reproducible from email alone, so a
// lost key can always be regenerated without looking up the original
// purchase. Matches the validation logic already committed on the Redline
// app side (licensing.py) -- test vector verified to match exactly.
//
// SENDING EMAIL: a dedicated Entra app registration, "Redline Fulfillment
// Bot" (client ID 1e2685aa-242a-4b00-95e5-0f090c06ee63), was created
// specifically for this -- scoped to ONLY the Microsoft Graph Mail.Send
// application permission (send mail as any user in the tenant), nothing
// broader. That's deliberately narrower than the existing "Alex-IO Graph
// Bot" app, which also holds full read/write access to every mailbox --
// too much blast radius for a fulfillment webhook to be holding.
//
// REQUIRED ENV VARS (set these in Render)
//   REDLINE_STRIPE_SECRET_KEY      - Stripe secret key (namespaced so it can't collide with any
//                                    future Alex-IO-wide Stripe billing setup)
//   REDLINE_STRIPE_WEBHOOK_SECRET  - signing secret Stripe gives you when you register this endpoint's URL
//   REDLINE_LICENSE_SECRET  - a long random string known only to this server and to Redline's own key-check code
//   REDLINE_DOWNLOAD_URL    - where RedlineSetup.exe can be downloaded
//   REDLINE_GRAPH_TENANT_ID      - 6cbc1b01-cf42-4a0c-b72a-30d7892d2d5a
//   REDLINE_GRAPH_CLIENT_ID      - 1e2685aa-242a-4b00-95e5-0f090c06ee63
//   REDLINE_GRAPH_CLIENT_SECRET  - the "Redline Fulfillment Bot" client secret (expires 9/6/2028 -- put
//                                  a reminder somewhere, since Graph app secrets don't renew themselves)
//   REDLINE_SENDER_EMAIL         - sales@alex-io.com (must be a real mailbox this app can send as)
//
// NPM PACKAGES NEEDED: stripe (no nodemailer needed -- Graph is called with plain fetch)
//
// AFTER DEPLOYING: register this URL as a webhook endpoint in the Stripe
// dashboard (Developers -> Webhooks), subscribed to "checkout.session.completed"
// for this account. Stripe will give you the signing secret -- that value goes
// into REDLINE_STRIPE_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import crypto from 'crypto';

// Lazily constructed (not at module scope) so the app can still build without
// REDLINE_STRIPE_SECRET_KEY set -- e.g. a contributor's machine, a CI job with
// no secrets configured. Next.js imports route modules during "Collecting page
// data" at build time; a module-scope `new Stripe(undefined!)` would hard-fail
// that step even though the route is never actually invoked during build.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.REDLINE_STRIPE_SECRET_KEY!, {
      apiVersion: '2026-08-26.dahlia', // pinned so a future stripe package bump can't silently shift API behavior
    });
  }
  return _stripe;
}
const REDLINE_PRODUCT_ID = 'prod_VDVxex2YAvKCbs'; // the "Redline" product created in Stripe

function generateLicenseKey(email: string): string {
  const secret = process.env.REDLINE_LICENSE_SECRET!;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .toUpperCase();
  const groups = hash.slice(0, 25).match(/.{1,5}/g) || [];
  return groups.join('-');
}

async function getGraphAccessToken(): Promise<string> {
  const tenantId = process.env.REDLINE_GRAPH_TENANT_ID!;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.REDLINE_GRAPH_CLIENT_ID!,
      client_secret: process.env.REDLINE_GRAPH_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function sendFulfillmentEmail(toEmail: string, licenseKey: string) {
  const token = await getGraphAccessToken();
  const senderEmail = process.env.REDLINE_SENDER_EMAIL!;

  const bodyText = `Thanks for buying Redline!

Download: ${process.env.REDLINE_DOWNLOAD_URL}

Your license key (this is tied to this email address, so keep them together):
${licenseKey}

Enter your email and this key the first time you open Redline.

Questions? Just reply, or write chuck@alex-io.com.

- Chuck`;

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: 'Your Redline download and license key',
        body: { contentType: 'Text', content: bodyText },
        toRecipients: [{ emailAddress: { address: toEmail } }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig!, process.env.REDLINE_STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[redline-webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only act on sessions for the Redline product, in case this webhook
    // endpoint is ever reused for other Alex-IO / Stripe products later.
    const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });
    const isRedline = lineItems.data.some((li) => {
      const product = li.price?.product;
      return typeof product === 'object' && product !== null && 'id' in product && product.id === REDLINE_PRODUCT_ID;
    });
    if (!isRedline) {
      return NextResponse.json({ received: true, skipped: 'not a Redline purchase' });
    }

    const email = session.customer_details?.email;
    if (!email) {
      console.error('[redline-webhook] no customer email on session', session.id);
      return NextResponse.json({ error: 'no customer email on session' }, { status: 400 });
    }

    try {
      const key = generateLicenseKey(email);
      await sendFulfillmentEmail(email, key);
      console.log(`[redline-webhook] fulfilled session ${session.id} -> ${email}`);
    } catch (err) {
      // Surfaced, not swallowed: a non-2xx response makes Stripe retry this
      // webhook automatically, so a transient email failure isn't a lost sale.
      console.error('[redline-webhook] fulfillment failed for session', session.id, err);
      return NextResponse.json({ error: 'fulfillment failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

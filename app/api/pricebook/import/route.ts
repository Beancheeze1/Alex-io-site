// app/api/pricebook/import/route.ts
import { NextResponse } from 'next/server';
import { PriceBook } from '@/lib/pricebook/schema';


export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
let json: unknown;
try {
json = await req.json();
} catch {
return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
}


const parsed = PriceBook.safeParse(json);
if (!parsed.success) {
return NextResponse.json({ ok: false, issues: parsed.error.format() }, { status: 422 });
}


const pb = parsed.data;


// TODO: Upsert into DB within a transaction. For now, just echo counts.
const counts = {
materials: pb.tables.materials.length,
cavities: pb.tables.cavities.length,
price_rules: pb.tables.price_rules.length,
products: pb.tables.products.length,
};


return NextResponse.json({ ok: true, version: pb.version, currency: pb.currency, counts });
}
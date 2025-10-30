// app/api/pricebook/export/route.ts
import { NextResponse } from 'next/server';
import { PriceBook } from '@/lib/pricebook/schema';


export const dynamic = 'force-dynamic';


export async function GET() {
// TODO: Pull real rows from your DB. For now, ship an empty manifest.
const manifest = {
name: 'Alex-IO Default Price Book',
version: '1.0.0',
currency: 'USD',
created_at: new Date().toISOString(),
tables: {
materials: [],
cavities: [],
price_rules: [],
products: [],
},
};


const parsed = PriceBook.safeParse(manifest);
if (!parsed.success) {
return NextResponse.json({ error: 'Invalid manifest', issues: parsed.error.format() }, { status: 500 });
}


return new NextResponse(JSON.stringify(parsed.data, null, 2), {
status: 200,
headers: {
'Content-Type': 'application/json; charset=utf-8',
'Content-Disposition': `attachment; filename="pricebook-${parsed.data.version}.json"`,
'Cache-Control': 'no-store',
},
});
}
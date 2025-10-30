// app/tokens/page.tsx
import Container from '@/components/Container';
import TokenPreview from '@/components/TokenPreview';


export const metadata = { title: 'Design Tokens — Alex‑IO' };


export default function Page() {
return (
<Container>
<TokenPreview />
</Container>
);
}
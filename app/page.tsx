import BrandCard from '@/components/BrandCard';   // <-- import
import Container from '@/components/Container';    // optional wrapper





export default function Page() {
  return (
    <Container>
      <BrandCard /> 
        <button className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-white shadow-sm hover:bg-brand-700">
        Token Test Button
      </button>                             {/* <-- render it */}
    </Container>
  );
}
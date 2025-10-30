import BrandCard from '@/components/BrandCard';   // <-- import
import Container from '@/components/Container';    // optional wrapper





export default function Page() {
  return (
    <Container>
      <BrandCard />                                {/* <-- render it */}
    </Container>
  );
}
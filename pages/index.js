
import Head from "next/head";
export default function Home(){
  return (
    <>
      <Head><title>Alex-IO</title></Head>
      <main style={{padding: "2rem"}}>
        <h1 style={{fontSize:"2rem", fontWeight:700}}>Alex-IO</h1>
        <p>Pages router home (fallback). If you see this, your domain is mapped and Next.js is serving.</p>
      </main>
    </>
  );
}

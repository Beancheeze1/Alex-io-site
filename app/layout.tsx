export const metadata = {
  title: "Alex-IO",
  description: "Dev baseline"
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{minHeight:"100vh", margin:0, fontFamily:"system-ui"}}>
        {children}
      </body>
    </html>
  );
}

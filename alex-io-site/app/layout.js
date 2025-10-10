export const metadata = {
  title: "Alex-IO — Reply to inbound emails in seconds",
  description: "HubSpot-native email bot with quoting, pricing tiers, and turn times.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

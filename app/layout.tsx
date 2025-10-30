// app/layout.tsx
import './globals.css';
import BrandHeader from '@/components/BrandHeader';
import LeftNav from '@/components/LeftNav';


export const metadata = {
title: 'Alex-IO — Reply to inbound emails in seconds',
description: 'HubSpot-native email bot with quoting, pricing tiers, and turn times.',
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="en">
<body className="min-h-screen bg-neutral-50 text-neutral-800">
<BrandHeader />
<div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
<LeftNav />
<main className="min-w-0 flex-1">{children}</main>
</div>
</body>
</html>
);
}
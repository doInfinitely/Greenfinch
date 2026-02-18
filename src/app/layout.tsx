import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import Providers from '@/components/Providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Greenfinch - Commercial Property Prospecting',
  description: 'Find decision-makers for commercial properties with validated contact information. Property intelligence, decision-maker contacts, and portfolio insights in one platform.',
  keywords: ['commercial property', 'sales prospecting', 'property intelligence', 'decision makers', 'real estate sales'],
  icons: {
    icon: '/greenfinch-logo.png',
    shortcut: '/greenfinch-logo.png',
    apple: '/greenfinch-logo.png',
  },
  openGraph: {
    title: 'Greenfinch - Stop Searching, Start Selling',
    description: 'Find the decision maker, not just the building. Empower your sales team with property intelligence.',
    type: 'website',
    siteName: 'Greenfinch',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Greenfinch - Commercial Property Prospecting',
    description: 'Find decision-makers for commercial properties with validated contact information.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className="light" suppressHydrationWarning>
        <body className={`${inter.className} light`}>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}

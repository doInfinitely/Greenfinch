import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Product Features - Greenfinch',
  description: 'Discover how Greenfinch combines property intelligence, decision-maker contacts, and portfolio insights to help you close more commercial service deals.',
  openGraph: {
    title: 'Product Features - Greenfinch',
    description: 'The sales rep\'s secret weapon for commercial property prospecting.',
  },
};

export default function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing - Greenfinch',
  description: 'Simple, transparent pricing for Greenfinch. Join our early access program for free or explore our upcoming plans.',
  openGraph: {
    title: 'Pricing - Greenfinch',
    description: 'Choose the plan that fits your team.',
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

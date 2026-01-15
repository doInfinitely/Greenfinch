import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ - Greenfinch',
  description: 'Frequently asked questions about Greenfinch. Learn about our property coverage, data accuracy, CRM integrations, and more.',
  openGraph: {
    title: 'FAQ - Greenfinch',
    description: 'Everything you need to know about greenfinch.ai.',
  },
};

export default function FAQLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

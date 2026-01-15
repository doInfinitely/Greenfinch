import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Join Waitlist - Greenfinch',
  description: 'Get early access to Greenfinch. Join the waitlist to be among the first to experience commercial property prospecting intelligence.',
  openGraph: {
    title: 'Join Waitlist - Greenfinch',
    description: 'Get early access to the platform built for commercial service sales.',
  },
};

export default function WaitlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

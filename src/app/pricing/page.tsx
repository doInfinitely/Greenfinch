'use client';

import Link from 'next/link';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />

      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-serif font-bold text-gray-900 leading-tight">
            Simple, Transparent{' '}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              Pricing
            </span>
          </h1>
          <p className="mt-6 text-xl text-gray-600">
            We're currently in a closed early access program. Pricing details will be announced soon.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div
            className="rounded-2xl p-8 bg-gradient-to-br from-green-500 to-emerald-600 text-white ring-4 ring-green-200"
            data-testid="card-pricing-early-access"
          >
            <div className="text-center">
              <h3 className="text-2xl font-semibold text-white">Early Access</h3>
              <p className="mt-3 text-green-100 text-lg">
                Join our early access program and help shape the future of greenfinch.ai.
              </p>
            </div>

            <div className="mt-8 grid sm:grid-cols-2 gap-4">
              {[
                'Property Search & Map Interface',
                'AI-Powered Property Intelligence',
                'Property Owner Identification',
                'Property Manager Discovery',
                'Verified Contact Information',
                'Pipeline Management',
                'Team Collaboration',
                'Priority Feature Requests',
              ].map((feature, index) => (
                <div key={index} className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 flex-shrink-0 text-green-200 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-white text-sm">{feature}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/waitlist"
                className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-green-600 bg-white rounded-lg hover:bg-gray-100 transition-all shadow-lg"
                data-testid="button-early-access"
              >
                Join the Waitlist
                <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm">
              Paid plans with additional features and higher limits will be available after the early access period.
            </p>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

'use client';

import Image from 'next/image';
import Link from 'next/link';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

export default function ProductPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />

      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-serif font-bold text-gray-900 leading-tight">
            The Sales Rep's{' '}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              Secret Weapon
            </span>
          </h1>
          <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto">
            greenfinch.ai combines property intelligence, decision-maker contacts, and portfolio insights into a single platform designed to help you close more deals.
          </p>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Image
                src="/generated_images/isometric_city_block_target.png"
                alt="Property Intelligence"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
              />
            </div>
            <div>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
                Property Intelligence
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Filter the noise. Find exactly the properties that match your ideal customer profile, whether it's by square footage, lot size, or ownership type.
              </p>
              <ul className="space-y-4">
                {[
                  'Detailed parcel data (Lot size, Building SqFt)',
                  'Zoning and land use codes',
                  'Ownership history and structure',
                  'Visual territory mapping',
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1">
              <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
                Decision Maker Intelligence
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Skip the front desk. We help you identify the specific individuals who manage the budget and sign the contracts.
              </p>
              <ul className="space-y-4">
                {[
                  'Identify Property Managers & Facility Directors',
                  'Uncover true owners behind LLCs',
                  'Verified direct dials and email addresses',
                  'LinkedIn integration for warm intros',
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <Image
                src="/generated_images/people_network_profiles_abstract.png"
                alt="Decision Maker Intelligence"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Image
                src="/generated_images/building_portfolio_collection_3d.png"
                alt="Portfolio Intelligence"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
              />
            </div>
            <div>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
                Portfolio Intelligence
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Don't just sell one building—sell the portfolio. View all properties managed by a single contact or firm to multiply your deal size.
              </p>
              <ul className="space-y-4">
                {[
                  'View full portfolios by Owner or PM Firm',
                  'Identify cross-selling opportunities',
                  'Track outreach across multiple properties',
                  'Integrate with your CRM',
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-serif font-bold mb-4">
            Ready to upgrade your prospecting?
          </h2>
          <p className="text-lg text-gray-300 mb-8">
            Join the waitlist today and be the first to access the platform built for commercial service sales.
          </p>
          <Link
            href="/waitlist"
            className="inline-flex items-center justify-center px-8 py-4 text-base font-medium text-gray-900 bg-white rounded-lg hover:bg-gray-100 transition-all shadow-lg"
            data-testid="button-get-early-access"
          >
            Get Early Access
            <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

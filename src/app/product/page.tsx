'use client';

import Image from 'next/image';
import Link from 'next/link';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-3">
          <CheckIcon />
          <span className="text-gray-700">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />

      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-serif font-bold text-gray-900 leading-tight">
            Everything you need to{' '}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              stop searching and start selling.
            </span>
          </h1>
          <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto">
            Greenfinch.ai combines property intelligence, decision-maker contacts, portfolio insights, and pipeline management into one platform built for commercial service sales.
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
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <div>
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Know Every Property</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                The right properties. Instantly.
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Stop guessing which buildings are worth your time. See property type, use, location, and size across your entire territory so you can filter to your ideal customer profile in seconds.
              </p>
              <FeatureList items={[
                'Property type and use classification — commercial, multifamily, industrial, and more',
                'Building square footage, lot size, and acreage for every parcel',
                'Full address and location data down to the neighborhood level',
                'Ownership structure — entity names, principals, and filing addresses',
                'Instant search and filter across thousands of parcels',
              ]} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1">
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Reach the Decision Maker</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Skip the gatekeeper. Talk to who matters.
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                We identify the specific people who manage the budget and sign the contracts — property managers, facility directors, and the real owners behind LLCs — with verified contact info attached.
              </p>
              <FeatureList items={[
                'Property managers and facility directors identified by name and title',
                'True ownership uncovered behind LLCs and holding companies',
                'Verified email addresses — validated, not guessed',
                'Direct dial phone numbers, mobile and office',
                'LinkedIn profiles for context and warm introductions',
                'AI-enriched contact data, automatically kept current',
              ]} />
            </div>
            <div className="order-1 lg:order-2">
              <Image
                src="/generated_images/people_network_profiles_abstract.png"
                alt="Decision Maker Contacts"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
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
                alt="Portfolio View"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <div>
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">See the Full Portfolio</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                One contact. Dozens of properties.
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Don't just pitch one building — pitch the whole portfolio. See every property managed or owned by a single contact or firm so you can propose bigger contracts from day one.
              </p>
              <FeatureList items={[
                'View all properties associated with any owner, manager, or firm',
                'See portfolio size, property mix, and total square footage at a glance',
                'Identify cross-sell opportunities across a prospect\'s entire holdings',
                'Group contacts by the organizations and companies they work for',
                'Build targeted outreach lists around a single relationship',
              ]} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 to-emerald-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1">
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Territory Mapping</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Your entire territory on one screen.
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                See every commercial property in your market on an interactive map. Spot clusters of opportunity, plan your routes, and never overlook a building again.
              </p>
              <FeatureList items={[
                'Interactive map of all commercial and multifamily parcels in your territory',
                'Filter by property type, use, location, and size directly on the map',
                'Click any pin to see ownership details and verified contacts instantly',
                'Identify high-density areas and plan efficient sales routes',
                'Zoom in to street level or out to see the full market at once',
              ]} />
            </div>
            <div className="order-1 lg:order-2">
              <Image
                src="/generated_images/isometric_city_block_target.png"
                alt="Territory Map"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
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
                src="/generated_images/sales_pipeline_flow_abstract.png"
                alt="Pipeline Management"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <div>
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Pipeline Management</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                From prospect to proposal in fewer steps.
              </h2>
              <p className="text-lg text-gray-600 mb-8">
                Greenfinch.ai sits upstream of your CRM. Qualify leads before they ever hit your pipeline so your team only spends time on real opportunities — not dead ends.
              </p>
              <FeatureList items={[
                'Kanban pipeline board — move deals from Prospecting to Won in one click',
                'Stage tracking with time-in-stage visibility so nothing goes stale',
                'Notes and activity log tied to every property and contact',
                'Build and manage targeted prospecting lists for focused outreach',
                'Team collaboration — assign deals and track activity across your reps',
              ]} />
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
            Join the waitlist today and be first to access the platform built for commercial service sales.
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

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

export default function LandingPage() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <LandingNav />

      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-4">
            <span className="inline-block px-4 py-1.5 bg-green-100 text-green-700 text-sm font-medium rounded-full animate-pulse-subtle" data-testid="badge-early-access">
              Now Accepting Early Access Partners
            </span>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className={`transition-all duration-700 ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <h1 className="text-5xl sm:text-6xl font-serif font-bold text-gray-900 leading-tight">
                Find the right customers.{' '}
                <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                  Close faster.
                </span>
              </h1>
              <p className="mt-6 text-xl text-gray-600 leading-relaxed">
                Stop driving by buildings and Googling names. greenfinch shows you who manages every commercial property in your territory — with verified contact info — so you spend less time researching and more time selling.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/waitlist"
                  className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl"
                  data-testid="button-request-early-access"
                >
                  Request Early Access
                  <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <Link
                  href="/product"
                  className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
                  data-testid="button-see-how-it-works"
                >
                  See How It Works
                </Link>
              </div>
            </div>
            
            <div className={`relative transition-all duration-700 delay-200 ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="relative bg-white rounded-2xl shadow-2xl p-2 ring-1 ring-gray-100">
                <Image
                  src="/generated_images/network_connection_green_yellow.png"
                  alt="Greenfinch Network"
                  width={800}
                  height={450}
                  className="rounded-xl"
                  style={{ width: '100%', height: 'auto' }}
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-serif font-bold text-gray-900">
              Less Research. More Revenue.
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Your team wastes hours chasing bad leads and outdated info. greenfinch gives you property intelligence and verified contacts so every call counts.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Know Every Property',
                description: 'See lot size, building type, and zoning at a glance. Instantly filter to the properties that fit your service profile — no more driving around to find them.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                ),
              },
              {
                title: 'Reach the Decision Maker',
                description: 'Get verified emails and phone numbers for property managers, facility directors, and owners. Skip the gatekeeper and start the conversation that matters.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                ),
              },
              {
                title: 'See the Full Portfolio',
                description: 'Discover every property a prospect manages. One contact can unlock 10, 20, even 50 properties — so you can pitch bigger deals from day one.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                ),
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="bg-gray-50 rounded-xl p-6 hover:bg-white hover:shadow-lg transition-all duration-300"
                data-testid={`card-feature-${index}`}
              >
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center text-green-600 mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 to-emerald-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Image
                src="/generated_images/isometric_city_block_target.png"
                alt="Target Properties"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <div>
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Territory Mapping</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Your entire territory on one screen.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                See every commercial property in your market on an interactive map. Spot clusters of opportunity, plan your routes, and never miss a building again.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Filter by property size, type, and zoning</span>
                </li>
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Click any pin to see ownership and contacts</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Pipeline Management</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                From prospect to proposal in fewer steps.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                greenfinch sits upstream of your CRM. Find properties, verify contacts, and qualify leads before they ever hit your pipeline — so your team only works real opportunities.
              </p>
              <Link
                href="/product"
                className="inline-flex items-center text-green-600 font-medium hover:text-green-700"
                data-testid="link-explore-features"
              >
                Explore Features
                <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
            <div className="order-1 lg:order-2">
              <Image
                src="/generated_images/sales_pipeline_flow_abstract.png"
                alt="Pipeline Management"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 to-emerald-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Image
                src="/generated_images/data_analytics_abstract_3d.png"
                alt="Data Driven Decisions"
                width={600}
                height={450}
                className="rounded-2xl shadow-xl"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <div>
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Smart Lists & Bulk Actions</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Organize your prospects your way.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                Build custom lists, bulk-add properties and contacts, and track everything in one place. No more spreadsheets, no more guesswork.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Bulk-enrich contacts with one click</span>
                </li>
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Share lists and collaborate with your team</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-green-400 font-medium text-sm uppercase tracking-wide">Early Access</span>
          <h2 className="text-3xl font-serif font-bold mt-2 mb-4">
            Ready to stop chasing and start closing?
          </h2>
          <p className="text-lg text-gray-300 mb-8">
            Join the commercial service companies already using greenfinch to find better prospects, reach decision makers faster, and win more contracts.
          </p>
          <div className="flex flex-wrap justify-center gap-8 mb-8">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Verified emails and direct dials</span>
            </div>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Every property in your market, mapped</span>
            </div>
          </div>
          <Link
            href="/waitlist"
            className="inline-flex items-center justify-center px-8 py-4 text-base font-medium text-gray-900 bg-white rounded-lg hover:bg-gray-100 transition-all shadow-lg"
            data-testid="button-request-access-bottom"
          >
            Request Early Access
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

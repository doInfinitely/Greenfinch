'use client';

import Link from 'next/link';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

const pricingPlans = [
  {
    name: 'Early Access',
    price: '',
    description: 'Join our beta program and shape the future of Greenfinch.',
    features: [
      'Unlimited Property Search',
      'Map-based Interface',
      'Property Owner Details',
      'Property Manager Identification',
    ],
    cta: 'Join the Waitlist',
    ctaLink: '/waitlist',
    highlight: true,
    available: true,
  },
  {
    name: 'Basic',
    price: '$49',
    priceDetail: '/user/mo',
    description: 'Essential tools for individual sales representatives.',
    features: [
      'National Property Search',
      'Basic Ownership Data',
      '100 Verified Contact Credits / mo',
      'List Building Tools',
    ],
    cta: 'Coming Soon',
    ctaLink: '#',
    highlight: false,
    available: false,
  },
  {
    name: 'Pro',
    price: '$99',
    priceDetail: '/user/mo',
    description: 'Advanced intelligence for high-performing teams.',
    features: [
      'Everything in Basic',
      'Portfolio Intelligence',
      'Org Charts & Decision Makers',
      '300 Verified Contact Credits / mo',
      'CRM Integration',
    ],
    cta: 'Coming Soon',
    ctaLink: '#',
    highlight: false,
    available: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Complete territory coverage for large sales organizations.',
    features: [
      'Everything in Pro',
      'Unlimited Contact Credits',
      'API Access',
      'Territory Planning Tools',
      'Dedicated Success Manager',
      'SSO & Advanced Security',
    ],
    cta: 'Coming Soon',
    ctaLink: '#',
    highlight: false,
    available: false,
  },
];

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
            Choose the plan that fits your team. We're currently in closed beta with exclusive early access.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {pricingPlans.map((plan, index) => (
              <div
                key={index}
                className={`rounded-2xl p-6 ${
                  plan.highlight
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white ring-4 ring-green-200'
                    : 'bg-white border border-gray-200 blur-sm opacity-60 pointer-events-none select-none'
                }`}
                data-testid={`card-pricing-${plan.name.toLowerCase().replace(' ', '-')}`}
              >
                <h3 className={`text-lg font-semibold ${plan.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {plan.name}
                </h3>
                <div className="mt-4 mb-2">
                  <span className={`text-4xl font-bold ${plan.highlight ? 'text-white' : 'text-gray-900'}`}>
                    {plan.price}
                  </span>
                  {plan.priceDetail && (
                    <span className={`text-sm ${plan.highlight ? 'text-green-100' : 'text-gray-500'}`}>
                      {plan.priceDetail}
                    </span>
                  )}
                </div>
                <p className={`text-sm mb-6 ${plan.highlight ? 'text-green-100' : 'text-gray-500'}`}>
                  {plan.description}
                </p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start gap-2">
                      <svg
                        className={`w-5 h-5 flex-shrink-0 ${plan.highlight ? 'text-green-200' : 'text-green-500'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className={`text-sm ${plan.highlight ? 'text-white' : 'text-gray-600'}`}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
                {plan.available ? (
                  <Link
                    href={plan.ctaLink}
                    className={`block w-full py-3 px-4 text-center font-medium rounded-lg transition-all ${
                      plan.highlight
                        ? 'bg-white text-green-600 hover:bg-gray-100'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                    }`}
                    data-testid={`button-${plan.name.toLowerCase().replace(' ', '-')}`}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <div className="block w-full">
                    <button
                      disabled
                      className="w-full py-3 px-4 text-center font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
                    >
                      Subscribe
                    </button>
                    <p className="text-center text-sm text-gray-400 mt-2">Coming Soon</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

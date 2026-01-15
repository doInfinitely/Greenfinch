'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

const testimonials = [
  {
    quote: "Greenfinch has completely transformed how we prospect. We're connecting with decision makers 3x faster than before.",
    name: "Sarah Jenkins",
    title: "VP of Sales, Apex Property Management",
    initial: "S",
  },
  {
    quote: "The portfolio intelligence feature is a game changer. We can finally see the full scope of an owner's holdings.",
    name: "Michael Chen",
    title: "Director of Acquisitions, Summit Capital Partners",
    initial: "M",
  },
  {
    quote: "Finally, a tool that gives us accurate contact info for facility directors. It's paid for itself ten times over.",
    name: "David Rodriguez",
    title: "Business Development, GreenLeaf Services",
    initial: "D",
  },
  {
    quote: "The zoning data is incredibly accurate. We've stopped wasting time on properties that don't fit our criteria.",
    name: "Emily Thompson",
    title: "Land Acquisition, TerraForm Construction",
    initial: "E",
  },
  {
    quote: "I use the map view every day to plan my territory visits. It's intuitive and saves me hours of driving.",
    name: "James Wilson",
    title: "Regional Manager, Evergreen Landscapes",
    initial: "J",
  },
  {
    quote: "Connecting with the right person used to take weeks. Now it takes minutes. Highly recommended.",
    name: "Robert Chang",
    title: "Investment Officer, Highland Investments",
    initial: "R",
  },
];

const companyLogos = [
  { name: "Evergreen Landscapes", initial: "E" },
  { name: "Summit Capital", initial: "S" },
  { name: "TerraForm", initial: "T" },
  { name: "Apex Property", initial: "A" },
  { name: "GreenLeaf", initial: "G" },
  { name: "Highland", initial: "H" },
];

export default function LandingPage() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentTestimonial, setCurrentTestimonial] = useState(0);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTestimonial((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <LandingNav />

      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-4">
            <span className="inline-block px-4 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
              Accepting early access partners
            </span>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className={`transition-all duration-700 ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <h1 className="text-5xl sm:text-6xl font-serif font-bold text-gray-900 leading-tight">
                Stop searching.{' '}
                <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                  Start selling.
                </span>
              </h1>
              <p className="mt-6 text-xl text-gray-600 leading-relaxed">
                Find the decision maker, not just the building. Empower your sales team to discover properties, identify true owners, and view portfolios through a single lens.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/waitlist"
                  className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl"
                  data-testid="button-start-prospecting"
                >
                  Start Prospecting
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

      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center gap-8 md:gap-16 overflow-hidden">
            <div className="flex gap-12 animate-scroll">
              {[...companyLogos, ...companyLogos].map((company, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-gray-400 whitespace-nowrap"
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <span className="text-gray-500 font-semibold">{company.initial}</span>
                  </div>
                  <span className="text-sm font-medium">{company.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="relative">
            <div className="text-center">
              {testimonials.map((testimonial, index) => (
                <div
                  key={index}
                  className={`transition-opacity duration-500 ${
                    index === currentTestimonial ? 'block' : 'hidden'
                  }`}
                >
                  <blockquote className="text-2xl font-medium text-gray-900 mb-8">
                    "{testimonial.quote}"
                  </blockquote>
                  <div className="flex items-center justify-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center text-white font-bold">
                      {testimonial.initial}
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-gray-900">{testimonial.name}</div>
                      <div className="text-sm text-gray-500">{testimonial.title}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex justify-center gap-2 mt-8">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentTestimonial(index)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    index === currentTestimonial ? 'bg-green-600' : 'bg-gray-300'
                  }`}
                  aria-label={`Go to testimonial ${index + 1}`}
                  data-testid={`button-testimonial-${index}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-serif font-bold text-gray-900">
              Built for the Modern Sales Rep
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Stop wasting time on bad data. We give you the intelligence you need to close more commercial service contracts.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Property Intelligence',
                description: 'Filter by lot size, building type, and zoning to find properties that fit your service profile perfectly.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                ),
              },
              {
                title: 'Decision Maker Intelligence',
                description: 'Bypass the gatekeeper. Access verified contact info for Property Managers, Facility Directors, and Owners.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                ),
              },
              {
                title: 'Portfolio Intelligence',
                description: 'View properties through an owner or manager lens. See everything a prospect manages to expand your deal size.',
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
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Territory Planning</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                See your territory in a new light.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                Visualize your market with high-fidelity map layers. Identify clusters of opportunity and plan your route effectively.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Pinpoint high-value targets</span>
                </li>
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Access ownership history instantly</span>
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
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Prospecting & Qualification</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Qualify fast. Then feed your CRM.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                Greenfinch sits upstream of your CRM. We help you find the right properties and people so you only fill your pipeline with high-quality, verified leads.
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
              <span className="text-green-600 font-medium text-sm uppercase tracking-wide">Market Intelligence</span>
              <h2 className="text-3xl font-serif font-bold text-gray-900 mt-2 mb-4">
                Filter out the noise, focus on the signal.
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                Advanced filtering capabilities allow you to zero in on properties that match your ideal customer profile instantly. No more manual sifting.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Identify top-tier opportunities</span>
                </li>
                <li className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-700">Collaborate with your team in real-time</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-green-400 font-medium text-sm uppercase tracking-wide">Maximum Efficiency</span>
          <h2 className="text-3xl font-serif font-bold mt-2 mb-4">
            Accelerate your workflow.
          </h2>
          <p className="text-lg text-gray-300 mb-8">
            Drastically reduce time spent driving and researching. We put verified contact information and high-likelihood prospects right at your fingertips.
          </p>
          <div className="flex flex-wrap justify-center gap-8 mb-8">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Instant access to decision makers</span>
            </div>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Cut research time by 70%</span>
            </div>
          </div>
          <Link
            href="/waitlist"
            className="inline-flex items-center justify-center px-8 py-4 text-base font-medium text-gray-900 bg-white rounded-lg hover:bg-gray-100 transition-all shadow-lg"
            data-testid="button-get-started-now"
          >
            Get Started Now
            <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </section>

      <LandingFooter />

      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll {
          animation: scroll 30s linear infinite;
        }
      `}</style>
    </div>
  );
}

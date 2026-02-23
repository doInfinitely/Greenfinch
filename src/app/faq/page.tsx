'use client';

import { useState } from 'react';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

const faqs = [
  {
    question: 'What types of properties does greenfinch.ai cover?',
    answer:
      'Greenfinch focuses on commercial properties including office buildings, retail spaces, industrial facilities, multi-family residential, and mixed-use developments. We classify properties using county assessor data and AI-powered enrichment to give you accurate, actionable intelligence.',
  },
  {
    question: 'What geographic areas are available?',
    answer:
      'We are currently live in Dallas, TX (ZIP 75225 and surrounding areas). We are actively expanding coverage to additional markets based on demand from early access partners. If you have a specific market in mind, let us know when you join the waitlist.',
  },
  {
    question: 'Where does the data come from?',
    answer:
      'Our data is aggregated from county assessor and appraisal district records, which we enrich using AI to identify property details, ownership structures, and management companies. Contact information is sourced and verified through multiple third-party providers to ensure accuracy.',
  },
  {
    question: 'How accurate is the contact information?',
    answer:
      'We verify contact information through a multi-stage enrichment pipeline that cross-references multiple data providers. Emails are validated before being added, and we flag confidence levels so you can prioritize the most reliable contacts first.',
  },
  {
    question: 'Can I export data to my CRM?',
    answer:
      'CRM integration is on our near-term roadmap. We are planning integrations with popular CRMs including Salesforce and HubSpot. Early access partners will be the first to try these features as they become available.',
  },
  {
    question: "What's the difference between a Property Owner and Property Manager?",
    answer:
      'A Property Owner is the individual or entity that holds the title to the property. A Property Manager is typically a third-party firm or individual hired to handle day-to-day operations, tenant relations, and maintenance. Greenfinch helps you identify both, so you can reach the right decision-maker for your specific service.',
  },
  {
    question: 'Is there a mobile app?',
    answer:
      'Our web application is fully responsive and works great on mobile devices. A dedicated mobile app is on our roadmap for future development. Early access partners will be the first to try new features as they become available.',
  },
  {
    question: 'How do I get access?',
    answer:
      'We are currently in a closed early access program. Join our waitlist and we will reach out to onboard you as we expand availability. Early access partners help shape the product and get priority access to new features.',
  },
];

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />

      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-green-50 via-white to-emerald-50">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-serif font-bold text-gray-900 leading-tight">
            Frequently Asked{' '}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              Questions
            </span>
          </h1>
          <p className="mt-6 text-xl text-gray-600">
            Everything you need to know about greenfinch.ai.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="border border-gray-200 rounded-xl overflow-hidden"
                data-testid={`accordion-faq-${index}`}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                  data-testid={`button-faq-${index}`}
                >
                  <span className="font-semibold text-gray-900">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transition-transform ${
                      openIndex === index ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openIndex === index && (
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                    <p className="text-gray-600">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-serif font-bold text-gray-900 mb-4">
            Still have questions?
          </h2>
          <p className="text-gray-600 mb-6">
            Join our waitlist and we'll be happy to answer any questions during your onboarding.
          </p>
          <a
            href="/waitlist"
            className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg"
            data-testid="button-join-waitlist"
          >
            Join the Waitlist
          </a>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

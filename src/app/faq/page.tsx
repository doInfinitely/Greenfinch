'use client';

import { useState } from 'react';
import LandingNav from '@/components/LandingNav';
import LandingFooter from '@/components/LandingFooter';

const faqs = [
  {
    category: 'Coverage & Data',
    question: 'What types of properties does Greenfinch.ai cover?',
    answer:
      'Greenfinch.ai focuses on commercial and multifamily properties — office buildings, retail spaces, industrial facilities, warehouses, apartment complexes, and mixed-use developments. We classify every property by type and use so you can instantly filter to the assets that fit your service profile.',
  },
  {
    category: 'Coverage & Data',
    question: 'What geographic areas are currently available?',
    answer:
      'We are live across the Dallas–Fort Worth metroplex, covering Dallas, Tarrant, Collin, and Denton counties. That includes Dallas, Fort Worth, Arlington, Plano, Frisco, McKinney, Denton, Irving, Grand Prairie, and dozens more cities across the metro. We are actively expanding to additional markets based on demand from early access partners. If you have a specific market in mind, mention it when you join the waitlist.',
  },
  {
    category: 'Coverage & Data',
    question: 'Where does the property data come from?',
    answer:
      'Property data is sourced from the county appraisal districts across the DFW metro — DCAD (Dallas), TAD (Tarrant), CCAD (Collin), and DCAD (Denton). These are the authoritative public records for parcel ownership, building details, and property values. We enrich this data with AI to surface property type, use classification, ownership structure, and management companies.',
  },
  {
    category: 'Coverage & Data',
    question: 'How do you classify property types and uses?',
    answer:
      'We use Texas PTAD state property type codes from the appraisal district records to classify every property. This gives you accurate, consistent classification — commercial, multifamily, industrial, and more — without relying on unreliable zoning designations. You can filter by property type and use across your entire territory.',
  },
  {
    category: 'Contacts & Accuracy',
    question: 'How accurate is the contact information?',
    answer:
      'Contact data goes through a multi-stage enrichment pipeline that cross-references multiple data providers. Emails are validated before being added to the platform, and we flag confidence levels so you can prioritize the most reliable contacts first. We surface property managers, facility directors, and true owners — not just the entity name on the appraisal record.',
  },
  {
    category: 'Contacts & Accuracy',
    question: "What's the difference between a Property Owner and a Property Manager?",
    answer:
      'A Property Owner is the individual or entity that holds legal title to the property — often an LLC or holding company. A Property Manager is typically a third-party firm or individual hired to handle day-to-day operations, tenant relations, and vendor contracts. Greenfinch.ai helps you identify both, so you can reach the right decision-maker for your specific service.',
  },
  {
    category: 'Contacts & Accuracy',
    question: 'Can I see all properties tied to a single contact or company?',
    answer:
      'Yes — this is one of the most powerful features in the platform. When you find a property manager, owner, or management firm, you can view every other property in their portfolio. One contact can unlock 10, 20, even 50 properties, letting you propose larger contracts and multiply your deal size from a single relationship.',
  },
  {
    category: 'Platform & Access',
    question: 'What does the pipeline management feature do?',
    answer:
      'The pipeline board lets you track every prospect from first touch to closed deal. Move properties through stages — Prospecting, Qualified, Proposal Sent, Won, or Lost — with a single click. You can log notes, track time in each stage, build targeted outreach lists, and collaborate with your team across deals.',
  },
  {
    category: 'Platform & Access',
    question: 'Can I use Greenfinch.ai on mobile?',
    answer:
      'Yes. The platform is fully responsive and works well on phones and tablets. You can search properties, review contacts, and manage your pipeline on the go. A dedicated mobile app is on our roadmap and early access partners will be the first to try it.',
  },
  {
    category: 'Platform & Access',
    question: 'Can I export data or connect to my CRM?',
    answer:
      'CRM integration is on our near-term roadmap, with planned support for Salesforce and HubSpot. In the meantime, you can build and manage prospecting lists directly within the platform. Early access partners will be the first to access integrations as they launch.',
  },
  {
    category: 'Platform & Access',
    question: 'How do I get access?',
    answer:
      'We are currently in a closed early access program. Join the waitlist and we will reach out as we expand availability. Early access partners help shape the product, get priority access to new features, and typically receive the best pricing when we go public.',
  },
];

const categories = Array.from(new Set(faqs.map((f) => f.category)));

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
            Everything you need to know about Greenfinch.ai.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-12">
          {categories.map((category) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-4">
                {category}
              </h2>
              <div className="space-y-3">
                {faqs
                  .map((faq, index) => ({ ...faq, index }))
                  .filter((faq) => faq.category === category)
                  .map(({ question, answer, index }) => (
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
                        <span className="font-semibold text-gray-900 pr-4">{question}</span>
                        <svg
                          className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform ${
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
                          <p className="text-gray-600 leading-relaxed">{answer}</p>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-serif font-bold text-gray-900 mb-4">
            Still have questions?
          </h2>
          <p className="text-gray-600 mb-6">
            Join the waitlist and we'll answer everything during your onboarding.
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

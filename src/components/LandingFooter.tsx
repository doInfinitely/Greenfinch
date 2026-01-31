'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SignInButton } from '@clerk/nextjs';

export default function LandingFooter() {
  return (
    <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div className="md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-10 h-10 relative flex-shrink-0 text-green-600">
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <path d="M20 50 C20 30, 40 20, 60 30 C70 35, 80 50, 80 65 C80 80, 60 85, 40 75 C30 70, 20 60, 20 50 Z" fill="currentColor"/>
                  <path d="M60 30 L85 15 L75 40 Z" fill="currentColor"/>
                  <circle cx="45" cy="40" r="5" fill="white"/>
                </svg>
              </div>
              <span className="text-xl font-semibold">greenfinch.ai</span>
            </div>
            <p className="text-gray-400 text-sm max-w-md">
              The modern sales intelligence platform for commercial services. Find decision-makers, not just buildings.
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Product</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link href="/product" className="hover:text-white transition-colors" data-testid="link-footer-product">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors" data-testid="link-footer-pricing">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-white transition-colors" data-testid="link-footer-faq">
                  FAQ
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Company</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <Link href="/waitlist" className="hover:text-white transition-colors" data-testid="link-footer-waitlist">
                  Join Waitlist
                </Link>
              </li>
              <li>
                <SignInButton mode="modal">
                  <button className="hover:text-white transition-colors" data-testid="link-footer-login">
                    Log In
                  </button>
                </SignInButton>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-gray-800 pt-8 text-center text-gray-400 text-sm">
          <p>&copy; {new Date().getFullYear()} greenfinch.ai. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

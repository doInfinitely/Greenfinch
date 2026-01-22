'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignInButton, UserButton, useUser, OrganizationSwitcher, useAuth } from '@clerk/nextjs';

interface HeaderProps {
  showBackButton?: boolean;
  onBack?: () => void;
}

interface DbUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
}

const baseNavLinks = [
  { href: '/dashboard', label: 'Dashboard', requiresAuth: false },
  { href: '/contacts', label: 'Contacts', requiresAuth: true },
  { href: '/organizations', label: 'Organizations', requiresAuth: true },
  { href: '/lists', label: 'Lists', requiresAuth: true },
];

const adminNavLink = { href: '/admin', label: 'Admin', requiresAuth: true, adminOnly: true };

export default function Header({ showBackButton, onBack }: HeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const { user: clerkUser, isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const fetchDbUser = async () => {
      if (!isSignedIn) {
        setDbUser(null);
        return;
      }
      try {
        const response = await fetch('/api/auth/user');
        if (response.ok) {
          const data = await response.json();
          setDbUser(data.user);
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
      }
    };
    if (isLoaded) {
      fetchDbUser();
    }
  }, [isSignedIn, isLoaded]);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    return pathname?.startsWith(href);
  };

  const { orgSlug, orgRole } = useAuth();
  
  const isDbAdmin = dbUser?.role === 'system_admin' || dbUser?.role === 'account_admin';
  const isOrgAdmin = orgSlug === 'greenfinch' && orgRole === 'org:admin';
  const isAdmin = isDbAdmin || isOrgAdmin;
  
  const navLinks = [
    ...baseNavLinks.filter(link => !link.requiresAuth || isSignedIn),
    ...(isAdmin ? [adminNavLink] : []),
  ];

  const getUserDisplayName = () => {
    if (clerkUser?.firstName && clerkUser?.lastName) {
      return `${clerkUser.firstName} ${clerkUser.lastName}`;
    }
    if (clerkUser?.firstName) {
      return clerkUser.firstName;
    }
    if (clerkUser?.primaryEmailAddress?.emailAddress) {
      return clerkUser.primaryEmailAddress.emailAddress.split('@')[0];
    }
    return 'User';
  };

  return (
    <header
      className={`bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-50 transition-shadow ${
        hasScrolled ? 'shadow-md' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {showBackButton && onBack && (
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center text-gray-600"
            >
              <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back</span>
            </button>
          )}
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">G</span>
            </div>
            <span className="text-xl font-semibold text-gray-900 hidden sm:inline">Greenfinch</span>
          </Link>

          <nav className="hidden md:flex items-center space-x-1 ml-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive(link.href)
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          {!isLoaded ? (
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5">
              <div className="w-7 h-7 bg-gray-200 rounded-full animate-pulse"></div>
              <div className="w-16 h-4 bg-gray-200 rounded animate-pulse"></div>
            </div>
          ) : isSignedIn ? (
            <div className="hidden sm:flex items-center space-x-3">
              <OrganizationSwitcher 
                hidePersonal={false}
                afterSelectOrganizationUrl="/dashboard"
                afterSelectPersonalUrl="/dashboard"
                appearance={{
                  elements: {
                    rootBox: "flex items-center",
                    organizationSwitcherTrigger: "px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200 transition-colors",
                  }
                }}
              />
              {isOrgAdmin && (
                <span className="text-xs bg-amber-500 text-white px-2 py-1 rounded font-medium">
                  {orgRole?.replace('org:', '').toUpperCase()}
                </span>
              )}
              <UserButton afterSignOutUrl="/" />
            </div>
          ) : (
            <SignInButton mode="modal">
              <button className="hidden sm:flex items-center space-x-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
                Sign in
              </button>
            </SignInButton>
          )}

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden mt-3 pb-3 border-t border-gray-100 pt-3">
          <nav className="flex flex-col space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive(link.href)
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 pt-3 border-t border-gray-100 px-3">
            {isSignedIn ? (
              <div className="space-y-3">
                <OrganizationSwitcher 
                  hidePersonal={false}
                  afterSelectOrganizationUrl="/dashboard"
                  afterSelectPersonalUrl="/dashboard"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-700">{getUserDisplayName()}</span>
                    {isOrgAdmin && (
                      <span className="text-xs bg-amber-500 text-white px-1.5 py-0.5 rounded">{orgRole?.replace('org:', '').toUpperCase()}</span>
                    )}
                  </div>
                  <UserButton afterSignOutUrl="/" />
                </div>
              </div>
            ) : (
              <SignInButton mode="modal">
                <button className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
                  Sign in
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMapView = pathname === '/dashboard/map' || pathname === '/dashboard';
  const isListView = pathname === '/dashboard/list';

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex items-center">
          <Link
            href="/dashboard/map"
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              isMapView
                ? 'border-green-600 text-green-700 bg-green-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Map
          </Link>
          <Link
            href="/dashboard/list"
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              isListView
                ? 'border-green-600 text-green-700 bg-green-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            List
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

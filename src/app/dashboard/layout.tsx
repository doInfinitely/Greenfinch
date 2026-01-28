'use client';

import { usePathname, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { Map, List } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isMapView = pathname === '/dashboard/map' || pathname === '/dashboard';

  const handleToggle = () => {
    if (isMapView) {
      router.push('/dashboard/list');
    } else {
      router.push('/dashboard/map');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center">
          <div 
            className="inline-flex items-center bg-gray-100 rounded-full p-0.5"
            role="tablist"
            data-testid="view-toggle"
          >
            <button
              role="tab"
              aria-selected={isMapView}
              onClick={handleToggle}
              data-testid="toggle-map"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all ${
                isMapView
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Map className="w-4 h-4" />
              Map
            </button>
            <button
              role="tab"
              aria-selected={!isMapView}
              onClick={handleToggle}
              data-testid="toggle-list"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-all ${
                !isMapView
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <List className="w-4 h-4" />
              List
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

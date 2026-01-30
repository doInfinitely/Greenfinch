'use client';

import AppSidebar from '@/components/AppSidebar';

export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 overflow-y-auto">
        {children}
      </div>
    </AppSidebar>
  );
}

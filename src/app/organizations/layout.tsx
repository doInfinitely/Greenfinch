'use client';

import AppSidebar from '@/components/AppSidebar';

export default function OrganizationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppSidebar>
      <div className="h-full bg-gray-50">
        {children}
      </div>
    </AppSidebar>
  );
}

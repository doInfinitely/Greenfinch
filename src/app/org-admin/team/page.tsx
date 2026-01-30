'use client';

import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserPlus, Users } from 'lucide-react';
import { OrganizationProfile, useAuth } from '@clerk/nextjs';

export default function TeamManagement() {
  const { orgRole } = useAuth();
  const isAdmin = orgRole === 'org:admin';

  if (!isAdmin) {
    return (
      <AppSidebar>
        <div className="h-full bg-gray-50 p-6">
          <div className="max-w-2xl mx-auto text-center py-12">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
            <p className="text-muted-foreground">
              You need admin permissions to access this page.
            </p>
          </div>
        </div>
      </AppSidebar>
    );
  }

  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
              <p className="text-muted-foreground">Manage your organization's team members</p>
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <OrganizationProfile
                appearance={{
                  elements: {
                    rootBox: 'w-full',
                    card: 'border-0 shadow-none',
                  },
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppSidebar>
  );
}

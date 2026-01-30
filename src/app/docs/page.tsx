'use client';

import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';

export default function Documentation() {
  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Documentation</h1>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Getting Started
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none">
              <p className="text-muted-foreground">
                Documentation is coming soon. In the meantime, here are some quick tips:
              </p>
              
              <h3 className="text-lg font-semibold mt-6 mb-3">Prospecting</h3>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Use the Properties map to find commercial properties in your target area</li>
                <li>Click on a property to see details and decision-maker contacts</li>
                <li>Add properties to lists for organized prospecting</li>
              </ul>

              <h3 className="text-lg font-semibold mt-6 mb-3">Pipeline Management</h3>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Change a property's status to track your sales progress</li>
                <li>Add deal values when qualifying opportunities</li>
                <li>Use the Pipeline Board for a visual overview</li>
              </ul>

              <h3 className="text-lg font-semibold mt-6 mb-3">Team Collaboration</h3>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>All team members in your organization share pipeline data</li>
                <li>Activity history shows who took each action</li>
                <li>Add notes to share context with your team</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppSidebar>
  );
}

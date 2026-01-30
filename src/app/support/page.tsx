'use client';

import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, MessageCircle, HelpCircle } from 'lucide-react';

export default function Support() {
  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Support</h1>
          
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Email Support
                </CardTitle>
                <CardDescription>
                  Get help from our team via email
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  For general questions, feature requests, or issues, reach out to our support team.
                </p>
                <Button variant="outline" asChild>
                  <a href="mailto:support@greenfinch.io">
                    Contact Support
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5" />
                  FAQ
                </CardTitle>
                <CardDescription>
                  Common questions and answers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Check our FAQ for answers to common questions about using Greenfinch.
                </p>
                <Button variant="outline" asChild>
                  <a href="/faq">
                    View FAQ
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppSidebar>
  );
}

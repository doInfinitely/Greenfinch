'use client';

import { SignIn } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SignInContent() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url');
  
  return (
    <SignIn 
      fallbackRedirectUrl={redirectUrl || "/pipeline/dashboard"}
      signUpUrl="/sign-up"
    />
  );
}

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Suspense fallback={<div className="animate-pulse bg-gray-200 rounded-lg w-96 h-96" />}>
        <SignInContent />
      </Suspense>
    </div>
  );
}

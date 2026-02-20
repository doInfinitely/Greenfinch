'use client';

import { SignUp } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SignUpContent() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url');
  
  return (
    <SignUp 
      fallbackRedirectUrl={redirectUrl || "/pipeline/dashboard"}
      signInUrl="/sign-in"
    />
  );
}

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Suspense fallback={<div className="animate-pulse bg-gray-200 rounded-lg w-96 h-96" />}>
        <SignUpContent />
      </Suspense>
    </div>
  );
}

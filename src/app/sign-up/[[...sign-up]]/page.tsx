'use client';

import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <SignUp 
        fallbackRedirectUrl="/dashboard/map"
        signInUrl="/sign-in"
      />
    </div>
  );
}

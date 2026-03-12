import { clerkMiddleware, clerkClient, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { INTERNAL_ORG_SLUG, ADMIN_EMAILS } from '@/lib/permissions';

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhook(.*)',
  '/api/tiles(.*)',
]);

// Define routes that require authentication
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/property(.*)',
  '/organization(.*)',
  '/contact(.*)',
  '/admin(.*)',
  '/internal(.*)',
  '/lists(.*)',
  '/onboarding(.*)',
  '/settings(.*)',
  '/pipeline(.*)',
  '/billing(.*)',
  '/api/billing(.*)',
  '/api/properties(.*)',
  '/api/contacts(.*)',
  '/api/lists(.*)',
  '/api/organizations(.*)',
  '/api/auth/user',
]);

const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
  '/api/admin(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // If it's a protected route and user is not signed in, redirect to sign-in
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  const authData = await auth();

  // Admin route protection
  if (isAdminRoute(req) && authData.userId) {
    const isOrgAdmin = authData.orgSlug === INTERNAL_ORG_SLUG && authData.orgRole === 'org:admin';

    if (!isOrgAdmin) {
      // Check email allowlist
      const client = await clerkClient();
      const user = await client.users.getUser(authData.userId);
      const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();

      if (!email || !ADMIN_EMAILS.includes(email)) {
        return new NextResponse('Forbidden - Admin access required', { status: 403 });
      }
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

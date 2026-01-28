import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhook(.*)',
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
  '/api/properties(.*)',
  '/api/contacts(.*)',
  '/api/organizations(.*)',
  '/api/lists(.*)',
  '/api/auth/user',
]);

export default clerkMiddleware(async (auth, req) => {
  // If it's a protected route and user is not signed in, redirect to sign-in
  if (isProtectedRoute(req)) {
    await auth.protect();
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

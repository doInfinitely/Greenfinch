import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const INTERNAL_ORG_SLUG = 'greenfinch';

const isPublicRoute = createRouteMatcher([
  '/',
  '/product(.*)',
  '/pricing(.*)',
  '/faq(.*)',
  '/waitlist(.*)',
  '/api/waitlist(.*)',
  '/api/config(.*)',
  '/api/tiles(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
  '/api/admin(.*)',
]);

const isInternalRoute = createRouteMatcher([
  '/internal(.*)',
  '/api/internal(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  const authData = await auth();
  
  if (isPublicRoute(request)) {
    return;
  }
  
  if (!authData.userId) {
    await auth.protect();
    return;
  }
  
  if (isInternalRoute(request)) {
    if (authData.orgSlug !== INTERNAL_ORG_SLUG) {
      return new NextResponse('Forbidden - Internal access only', { status: 403 });
    }
  }
  
  if (isAdminRoute(request)) {
    const isAdmin = authData.orgSlug === INTERNAL_ORG_SLUG && 
                    ['org:super_admin', 'org:admin'].includes(authData.orgRole || '');
    if (!isAdmin) {
      return new NextResponse('Forbidden - Admin access required', { status: 403 });
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

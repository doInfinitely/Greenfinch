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
  const path = request.nextUrl.pathname;
  
  if (isPublicRoute(request)) {
    return;
  }
  
  if (!authData.userId) {
    await auth.protect();
    return;
  }
  
  if (isInternalRoute(request)) {
    console.log(`[Proxy] Internal route ${path}: orgSlug=${authData.orgSlug}, orgRole=${authData.orgRole}`);
    if (authData.orgSlug !== INTERNAL_ORG_SLUG) {
      return new NextResponse('Forbidden - Internal access only', { status: 403 });
    }
  }
  
  if (isAdminRoute(request)) {
    console.log(`[Proxy] Admin route ${path}: orgSlug=${authData.orgSlug}, orgRole=${authData.orgRole}`);
    const isAdmin = authData.orgSlug === INTERNAL_ORG_SLUG && authData.orgRole === 'org:admin';
    if (!isAdmin) {
      console.log(`[Proxy] Admin access denied for ${path}: isAdmin=${isAdmin}`);
      return new NextResponse('Forbidden - Admin access required', { status: 403 });
    }
    console.log(`[Proxy] Admin access granted for ${path}`);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

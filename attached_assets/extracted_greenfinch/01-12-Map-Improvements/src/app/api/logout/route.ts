import { NextRequest, NextResponse } from 'next/server';
import { deleteSession, getLogoutUrl, getSessionCookieName } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    
    if (sessionId) {
      await deleteSession(sessionId);
    }
    
    cookieStore.delete(getSessionCookieName());
    
    const host = request.headers.get('host') || '';
    const hostname = host.includes('replit') ? host : (process.env.REPLIT_DEV_DOMAIN || host);
    const logoutUrl = await getLogoutUrl(hostname);
    
    return NextResponse.redirect(logoutUrl);
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.redirect(new URL('/', request.url));
  }
}

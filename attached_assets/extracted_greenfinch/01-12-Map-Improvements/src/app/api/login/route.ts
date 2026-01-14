import { NextRequest, NextResponse } from 'next/server';
import { initiateLogin, encodePKCEData, getPKCECookieName } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const host = request.headers.get('host') || '';
    const hostname = host.includes('replit') ? host : (process.env.REPLIT_DEV_DOMAIN || host);
    
    const { authUrl, pkceData } = await initiateLogin(hostname);
    
    const cookieStore = await cookies();
    cookieStore.set(getPKCECookieName(), encodePKCEData(pkceData), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    });
    
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.redirect(new URL('/?error=login_failed', request.url));
  }
}

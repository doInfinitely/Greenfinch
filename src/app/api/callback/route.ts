import { NextRequest, NextResponse } from 'next/server';
import { 
  completeLogin, 
  createSession, 
  decodePKCEData, 
  getPKCECookieName,
  getSessionCookieName 
} from '@/lib/auth';
import { cookies } from 'next/headers';

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host') || '';
  const hostname = host.includes('replit') ? host : (process.env.REPLIT_DEV_DOMAIN || host);
  return `https://${hostname}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request);
  const searchParams = request.nextUrl.searchParams;
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  
  if (error) {
    console.error('OAuth error:', error, errorDescription);
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl));
  }
  
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  
  if (!code || !state) {
    console.error('Missing code or state in callback');
    return NextResponse.redirect(new URL('/?error=missing_params', baseUrl));
  }
  
  const cookieStore = await cookies();
  const pkceDataEncoded = cookieStore.get(getPKCECookieName())?.value;
  
  if (!pkceDataEncoded) {
    console.error('PKCE cookie not found - session may have expired');
    return NextResponse.redirect(new URL('/?error=session_expired', baseUrl));
  }
  
  const pkceData = decodePKCEData(pkceDataEncoded);
  
  if (!pkceData) {
    console.error('Failed to decode PKCE data');
    return NextResponse.redirect(new URL('/?error=invalid_session', baseUrl));
  }
  
  try {
    const callbackUrl = new URL(`${baseUrl}/api/callback`);
    callbackUrl.search = request.nextUrl.search;
    
    const user = await completeLogin(callbackUrl, pkceData);
    const sessionId = await createSession(user.id);
    
    cookieStore.delete(getPKCECookieName());
    
    cookieStore.set(getSessionCookieName(), sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });
    
    return NextResponse.redirect(new URL('/dashboard', baseUrl));
  } catch (err) {
    console.error('Auth callback error:', err);
    
    cookieStore.delete(getPKCECookieName());
    
    if (err instanceof Error && err.message === 'INVALID_STATE') {
      return NextResponse.redirect(new URL('/?error=invalid_state', baseUrl));
    }
    
    return NextResponse.redirect(new URL('/?error=auth_failed', baseUrl));
  }
}

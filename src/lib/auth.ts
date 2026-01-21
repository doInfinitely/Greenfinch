import { db } from './db';
import { users, sessions, serviceProviders } from './schema';
import { eq, ilike } from 'drizzle-orm';
import { cookies } from 'next/headers';
import * as client from 'openid-client';

const SESSION_COOKIE = 'greenfinch_session';
const PKCE_COOKIE = 'greenfinch_pkce';

export type UserRole = 'standard_user' | 'team_manager' | 'account_admin' | 'system_admin';

export interface User {
  id: string;
  replitId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: UserRole;
  isActive: boolean;
}

interface PKCEData {
  state: string;
  nonce: string;
  codeVerifier: string;
  hostname: string;
}

let cachedOidcConfig: Awaited<ReturnType<typeof client.discovery>> | null = null;
let oidcConfigExpiry = 0;
const OIDC_CACHE_TTL = 3600 * 1000;

async function getOidcConfig() {
  const now = Date.now();
  if (cachedOidcConfig && now < oidcConfigExpiry) {
    return cachedOidcConfig;
  }
  
  const config = await client.discovery(
    new URL(process.env.ISSUER_URL ?? 'https://replit.com/oidc'),
    process.env.REPL_ID!
  );
  
  cachedOidcConfig = config;
  oidcConfigExpiry = now + OIDC_CACHE_TTL;
  return config;
}

export async function getSession(): Promise<{ user: User } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  
  if (!sessionId) return null;
  
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sid, sessionId))
      .limit(1);
    
    if (!session || new Date(session.expire) < new Date()) {
      return null;
    }
    
    const sess = session.sess as { userId?: string };
    if (!sess.userId) return null;
    
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, sess.userId))
      .limit(1);
    
    if (!user || !user.isActive) return null;
    
    return {
      user: {
        id: user.id,
        replitId: user.replitId || '',
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        role: (user.role as UserRole) || 'standard_user',
        isActive: user.isActive ?? true,
      }
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<{ user: User }> {
  const session = await getSession();
  if (!session) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

export async function requireRole(allowedRoles: UserRole[]): Promise<{ user: User }> {
  const session = await requireSession();
  if (!allowedRoles.includes(session.user.role)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}

export function isAdmin(user: User): boolean {
  return user.role === 'system_admin' || user.role === 'account_admin';
}

export function isSystemAdmin(user: User): boolean {
  return user.role === 'system_admin';
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await db.insert(sessions).values({
    sid: sessionId,
    sess: { userId },
    expire,
  });
  
  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sid, sessionId));
}

// Extract domain from email address
function extractDomain(email: string | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

// Find matching service provider by email domain
async function findMatchingServiceProvider(email: string | undefined): Promise<{ id: string; name: string } | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  try {
    const [provider] = await db
      .select({ id: serviceProviders.id, name: serviceProviders.name })
      .from(serviceProviders)
      .where(ilike(serviceProviders.domain, domain))
      .limit(1);

    return provider || null;
  } catch (error) {
    console.error('[Auth] Error finding matching service provider:', error);
    return null;
  }
}

export async function upsertUser(claims: {
  sub: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
}): Promise<User> {
  const existingUsers = await db
    .select()
    .from(users)
    .where(eq(users.replitId, claims.sub))
    .limit(1);
  
  if (existingUsers.length > 0) {
    const existingUser = existingUsers[0];
    
    // Check if user needs service provider linking (new email or no service provider yet)
    if (claims.email && !existingUser.serviceProviderId) {
      const matchingProvider = await findMatchingServiceProvider(claims.email);
      if (matchingProvider) {
        console.log(`[Auth] Linking user ${claims.sub} to service provider: ${matchingProvider.name} (${matchingProvider.id})`);
        
        const [updated] = await db
          .update(users)
          .set({
            email: claims.email || existingUser.email,
            firstName: claims.first_name || existingUser.firstName,
            lastName: claims.last_name || existingUser.lastName,
            profileImageUrl: claims.profile_image_url || existingUser.profileImageUrl,
            companyDomain: extractDomain(claims.email),
            companyName: matchingProvider.name,
            serviceProviderId: matchingProvider.id,
            updatedAt: new Date(),
          })
          .where(eq(users.replitId, claims.sub))
          .returning();
        
        return {
          id: updated.id,
          replitId: updated.replitId || '',
          email: updated.email,
          firstName: updated.firstName,
          lastName: updated.lastName,
          profileImageUrl: updated.profileImageUrl,
          role: (updated.role as UserRole) || 'standard_user',
          isActive: updated.isActive ?? true,
        };
      }
    }
    
    const [updated] = await db
      .update(users)
      .set({
        email: claims.email || existingUser.email,
        firstName: claims.first_name || existingUser.firstName,
        lastName: claims.last_name || existingUser.lastName,
        profileImageUrl: claims.profile_image_url || existingUser.profileImageUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.replitId, claims.sub))
      .returning();
    
    return {
      id: updated.id,
      replitId: updated.replitId || '',
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      profileImageUrl: updated.profileImageUrl,
      role: (updated.role as UserRole) || 'standard_user',
      isActive: updated.isActive ?? true,
    };
  }
  
  // New user - check for matching service provider
  const matchingProvider = await findMatchingServiceProvider(claims.email);
  const domain = extractDomain(claims.email);
  
  const [newUser] = await db
    .insert(users)
    .values({
      replitId: claims.sub,
      email: claims.email,
      firstName: claims.first_name,
      lastName: claims.last_name,
      profileImageUrl: claims.profile_image_url,
      companyDomain: domain,
      companyName: matchingProvider?.name || null,
      serviceProviderId: matchingProvider?.id || null,
    })
    .returning();
  
  if (matchingProvider) {
    console.log(`[Auth] New user ${claims.sub} auto-linked to service provider: ${matchingProvider.name}`);
  }
  
  return {
    id: newUser.id,
    replitId: newUser.replitId || '',
    email: newUser.email,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    profileImageUrl: newUser.profileImageUrl,
    role: (newUser.role as UserRole) || 'standard_user',
    isActive: newUser.isActive ?? true,
  };
}

export async function initiateLogin(hostname: string): Promise<{ authUrl: string; pkceData: PKCEData }> {
  const config = await getOidcConfig();
  const callbackUrl = `https://${hostname}/api/callback`;
  
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  
  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  return {
    authUrl: authUrl.href,
    pkceData: { state, nonce, codeVerifier, hostname }
  };
}

export async function completeLogin(
  callbackUrl: URL,
  pkceData: PKCEData
): Promise<User> {
  const returnedState = callbackUrl.searchParams.get('state');
  
  if (returnedState !== pkceData.state) {
    throw new Error('INVALID_STATE');
  }
  
  const config = await getOidcConfig();
  
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: pkceData.codeVerifier,
    expectedState: pkceData.state,
    expectedNonce: pkceData.nonce,
  });
  
  const claims = tokens.claims();
  
  if (!claims?.sub) {
    throw new Error('MISSING_SUB_CLAIM');
  }
  
  const user = await upsertUser({
    sub: claims.sub,
    email: claims.email as string | undefined,
    first_name: claims.first_name as string | undefined,
    last_name: claims.last_name as string | undefined,
    profile_image_url: claims.profile_image_url as string | undefined,
  });
  
  return user;
}

export function encodePKCEData(data: PKCEData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function decodePKCEData(encoded: string): PKCEData | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function getPKCECookieName(): string {
  return PKCE_COOKIE;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export async function getLogoutUrl(hostname: string): Promise<string> {
  const config = await getOidcConfig();
  
  const endSessionUrl = client.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: `https://${hostname}`,
  });
  
  return endSessionUrl.href;
}

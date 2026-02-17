import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/auth';
import { verifyEmail as hunterVerify } from '@/lib/hunter';
import { verifyEmail as findymailVerify } from '@/lib/findymail';
import { validateEmail as zerobounceValidate } from '@/lib/zerobounce';

export async function POST(request: NextRequest) {
  try {
    await requireAdminAccess();
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const results: Record<string, any> = {};
    const startTime = Date.now();

    const promises: Promise<void>[] = [];

    if (process.env.HUNTER_API_KEY) {
      promises.push(
        (async () => {
          const hunterStart = Date.now();
          try {
            const result = await hunterVerify(email);
            let normalizedStatus: 'valid' | 'catch-all' | 'invalid' = 'invalid';
            if (result.status === 'valid') normalizedStatus = 'valid';
            else if (result.accept_all) normalizedStatus = 'catch-all';
            
            results.hunter = {
              provider: 'Hunter.io',
              success: true,
              data: {
                status: normalizedStatus,
                rawStatus: result.status,
                isValid: result.status === 'valid',
                confidence: result.score / 100,
                acceptAll: result.accept_all,
                disposable: result.disposable,
                webmail: result.webmail,
                mxRecords: result.mx_records,
                smtpCheck: result.smtp_check,
              },
              latency: Date.now() - hunterStart,
              raw: result,
            };
          } catch (error: any) {
            results.hunter = {
              provider: 'Hunter.io',
              success: false,
              error: error.message,
              latency: Date.now() - hunterStart,
            };
          }
        })()
      );
    }

    if (process.env.FINDYMAIL_API_KEY) {
      promises.push(
        (async () => {
          const findymailStart = Date.now();
          try {
            const result = await findymailVerify(email);
            results.findymail = {
              provider: 'Findymail',
              success: result.success,
              data: result.success ? {
                status: result.status,
                rawStatus: result.rawStatus,
                isValid: result.status === 'valid',
              } : null,
              latency: Date.now() - findymailStart,
              raw: result.raw,
              error: result.error,
            };
          } catch (error: any) {
            results.findymail = {
              provider: 'Findymail',
              success: false,
              error: error.message,
              latency: Date.now() - findymailStart,
            };
          }
        })()
      );
    }

    if (process.env.ZEROBOUNCE_API_KEY) {
      promises.push(
        (async () => {
          const zbStart = Date.now();
          try {
            const result = await zerobounceValidate(email);
            results.zerobounce = {
              provider: 'ZeroBounce',
              success: result.success,
              data: result.success ? {
                status: result.status,
                rawStatus: result.rawStatus,
                subStatus: result.subStatus,
                isValid: result.status === 'valid',
                freeEmail: result.freeEmail,
                suggestedCorrection: result.suggestedCorrection,
                mxFound: result.mxFound,
                mxRecord: result.mxRecord,
                smtpProvider: result.smtpProvider,
              } : null,
              latency: Date.now() - zbStart,
              raw: result.raw,
              error: result.error,
            };
          } catch (error: any) {
            results.zerobounce = {
              provider: 'ZeroBounce',
              success: false,
              error: error.message,
              latency: Date.now() - zbStart,
            };
          }
        })()
      );
    }

    await Promise.all(promises);

    const consensus = determineConsensus(results);

    return NextResponse.json({
      input: { email },
      results,
      consensus,
      totalLatency: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[Compare Email] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function determineConsensus(results: Record<string, any>): { status: string; confidence: number } {
  const statuses: string[] = [];
  
  for (const key of Object.keys(results)) {
    const r = results[key];
    if (r.success && r.data?.status) {
      statuses.push(r.data.status);
    }
  }

  if (statuses.length === 0) {
    return { status: 'unknown', confidence: 0 };
  }

  const validCount = statuses.filter(s => s === 'valid').length;
  const invalidCount = statuses.filter(s => s === 'invalid').length;
  const catchAllCount = statuses.filter(s => s === 'catch-all').length;

  if (validCount > invalidCount && validCount >= catchAllCount) {
    return { status: 'valid', confidence: validCount / statuses.length };
  } else if (invalidCount > validCount && invalidCount > catchAllCount) {
    return { status: 'invalid', confidence: invalidCount / statuses.length };
  } else if (catchAllCount > 0) {
    return { status: 'catch-all', confidence: catchAllCount / statuses.length };
  }

  return { status: 'unknown', confidence: 0.5 };
}

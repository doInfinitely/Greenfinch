import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  try {
    const { domain } = await params;

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
    }

    const apiKey = process.env.LOGO_DEV_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Logo.dev API key not configured' }, { status: 500 });
    }

    const response = await fetch(`https://api.logo.dev/describe/${encodeURIComponent(domain)}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.warn(`[Brand] Logo.dev describe failed for ${domain}: ${response.status}`);
      return NextResponse.json({ error: 'Brand data not found' }, { status: 404 });
    }

    const data = await response.json();

    return NextResponse.json({
      name: data.name || null,
      domain: data.domain || domain,
      logo: data.logo || null,
      blurhash: data.blurhash || null,
      colors: data.colors || [],
      socials: data.socials || {},
      description: data.description || null,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('[Brand] Error fetching brand data:', error);
    return NextResponse.json({ error: 'Failed to fetch brand data' }, { status: 500 });
  }
}

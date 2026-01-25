import { NextRequest, NextResponse } from 'next/server';
import { findLinkedInUrl } from '@/lib/enrichment';
import { GoogleGenAI } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  if (process.env.GOOGLE_GENAI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });
  }
  
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey) {
    throw new Error("No Gemini API key found");
  }
  
  if (baseUrl) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl,
      },
    });
  }
  
  return new GoogleGenAI({ apiKey });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get('name');
  const title = searchParams.get('title');
  const company = searchParams.get('company');
  const domain = searchParams.get('domain');
  const city = searchParams.get('city');
  const noSearch = searchParams.get('noSearch') === 'true';

  if (!name) {
    return NextResponse.json(
      { error: 'Name is required' },
      { status: 400 }
    );
  }

  console.log(`[Test API] LinkedIn search for: ${name}, ${title || 'no title'}, ${company || 'no company'}, ${domain || 'no domain'}, ${city || 'no city'}, noSearch: ${noSearch}`);

  // Test with custom search if noSearch is not set
  if (noSearch) {
    // Test if Gemini API works without search grounding
    try {
      const client = getGeminiClient();
      const testResponse = await client.models.generateContent({
        model: "gemini-3.0-flash-preview",
        contents: "Say hello in one word",
      });
      const testText = testResponse.text?.trim();
      console.log(`[Test API] Basic Gemini test response: ${testText}`);
      
      return NextResponse.json({
        success: true,
        mode: 'no-search-test',
        testResponse: testText,
      });
    } catch (error) {
      console.error('[Test API] Basic Gemini test error:', error);
      return NextResponse.json(
        { error: 'Gemini API test failed', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }

  try {
    const result = await findLinkedInUrl(
      name,
      title || null,
      company || null,
      domain || null,
      city || null
    );

    return NextResponse.json({
      success: !!result.linkedinUrl,
      searchParams: {
        name,
        title: title || null,
        company: company || null,
        domain: domain || null,
        city: city || null,
      },
      result: {
        linkedinUrl: result.linkedinUrl,
        confidence: result.confidence,
      },
    });
  } catch (error) {
    console.error('[Test API] LinkedIn search error:', error);
    return NextResponse.json(
      { error: 'Failed to search for LinkedIn profile', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

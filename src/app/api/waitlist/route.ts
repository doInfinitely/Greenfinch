import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { waitlistSignups } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, name, company, role } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingSignup = await db
      .select()
      .from(waitlistSignups)
      .where(eq(waitlistSignups.email, normalizedEmail))
      .limit(1);

    if (existingSignup.length > 0) {
      return NextResponse.json({ message: 'Already on waitlist' }, { status: 200 });
    }

    await db.insert(waitlistSignups).values({
      email: normalizedEmail,
      name: name || null,
      company: company || null,
      role: role || null,
    });

    return NextResponse.json({ message: 'Successfully joined waitlist' }, { status: 201 });
  } catch (error: unknown) {
    console.error('Waitlist signup error:', error);
    
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
      return NextResponse.json({ message: 'Already on waitlist' }, { status: 200 });
    }
    
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
  }
}

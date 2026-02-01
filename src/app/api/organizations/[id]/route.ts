import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, propertyOrganizations, properties, contactOrganizations, contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log(`[API] Fetching organization: ${id}`);

    if (!id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    });
    
    console.log(`[API] Organization found: ${org ? org.name : 'null'}`);

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const propertyRelations = await db
      .select({
        id: properties.id,
        propertyKey: properties.propertyKey,
        address: properties.validatedAddress,
        regridAddress: properties.regridAddress,
        city: properties.city,
        state: properties.state,
        zip: properties.zip,
        commonName: properties.commonName,
        assetCategory: properties.assetCategory,
        assetSubcategory: properties.assetSubcategory,
        role: propertyOrganizations.role,
      })
      .from(propertyOrganizations)
      .innerJoin(properties, eq(propertyOrganizations.propertyId, properties.id))
      .where(eq(propertyOrganizations.orgId, id));

    const contactRelations = await db
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        title: contacts.title,
        emailStatus: contacts.emailStatus,
        emailValidationStatus: contacts.emailValidationStatus,
        linkedinUrl: contacts.linkedinUrl,
        isCurrent: contactOrganizations.isCurrent,
        contactTitle: contactOrganizations.title,
      })
      .from(contactOrganizations)
      .innerJoin(contacts, eq(contactOrganizations.contactId, contacts.id))
      .where(eq(contactOrganizations.orgId, id));

    return NextResponse.json({
      organization: org,
      properties: propertyRelations.map(p => ({
        ...p,
        address: p.address || p.regridAddress,
      })),
      contacts: contactRelations,
    });
  } catch (error) {
    console.error('Error fetching organization:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization' },
      { status: 500 }
    );
  }
}

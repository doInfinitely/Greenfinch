import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts, contactSnapshots, userContactVersions, propertyContacts, contactOrganizations } from '@/lib/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { enrichContactCascade } from '@/lib/cascade-enrichment';
import { ensureEmployerOrgEnriched } from '@/lib/organization-enrichment';
import { requireSession, getUserId } from '@/lib/auth';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRACKED_FIELDS = ['email', 'phone', 'title', 'employerName', 'companyDomain', 'linkedinUrl', 'location', 'photoUrl', 'emailValidationStatus'] as const;

function captureSnapshot(contact: any) {
  return {
    fullName: contact.fullName || null,
    email: contact.email || null,
    phone: contact.phone || null,
    title: contact.title || null,
    employerName: contact.employerName || null,
    companyDomain: contact.companyDomain || null,
    linkedinUrl: contact.linkedinUrl || null,
    location: contact.location || null,
    photoUrl: contact.photoUrl || null,
    emailValidationStatus: contact.emailValidationStatus || null,
    phoneSource: contact.phoneSource || null,
    enrichmentPhoneWork: contact.enrichmentPhoneWork || null,
    enrichmentPhonePersonal: contact.enrichmentPhonePersonal || null,
  };
}

function detectChanges(before: Record<string, any>, after: Record<string, any>) {
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  for (const field of TRACKED_FIELDS) {
    const oldVal = before[field] || null;
    const newVal = after[field] || null;
    if (oldVal !== newVal && (oldVal || newVal)) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const userId = await getUserId();
    
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid contact ID format' },
        { status: 400 }
      );
    }

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (!contact.fullName) {
      return NextResponse.json({ error: 'Contact has no name to enrich' }, { status: 400 });
    }

    const beforeSnapshot = captureSnapshot(contact);
    const isReResearch = !!(contact.enrichedAt || contact.pdlEnrichedAt);

    const location = contact.location || 'Dallas, TX';
    
    console.log(`[EnrichContact] Starting ${isReResearch ? 're-research' : 'initial research'} for contact: ${contact.fullName} (${id})`);
    console.log(`[EnrichContact] Using location: ${location}, title: ${contact.title}, domain: ${contact.companyDomain}`);

    const result = await enrichContactCascade({
      fullName: contact.fullName,
      email: contact.email,
      companyDomain: contact.companyDomain,
      companyName: contact.employerName,
      title: contact.title,
      location,
      linkedinUrl: contact.linkedinUrl,
    });

    if (!result.found) {
      console.error(`[EnrichContact] Enrichment found nothing for ${contact.fullName} (${result.confidenceFlag})`);
      return NextResponse.json(
        { 
          error: 'Enrichment found no data', 
          details: result.confidenceFlag,
          contact: {
            id: contact.id,
            fullName: contact.fullName,
          }
        },
        { status: 422 }
      );
    }

    console.log(`[EnrichContact] Enrichment successful for ${contact.fullName}:`, {
      linkedinUrl: result.linkedinUrl,
      email: result.email,
      phone: result.phone,
      confidenceFlag: result.confidenceFlag,
    });

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
      enrichedAt: new Date(),
      confidenceFlag: result.confidenceFlag,
      enrichmentSource: result.enrichmentSource,
    };

    if (result.linkedinUrl) {
      updateData.linkedinUrl = result.linkedinUrl;
      updateData.linkedinConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
      updateData.linkedinStatus = result.confidenceFlag === 'verified' ? 'verified' : 'enriched';
    }

    if (result.email) {
      updateData.email = result.email;
      updateData.normalizedEmail = result.email.toLowerCase();
      updateData.emailConfidence = result.emailVerified ? 0.95 : 0.70;
      updateData.emailSource = result.emailSource;
      updateData.emailValidationStatus = result.emailStatus;
    }

    if (result.phone) {
      updateData.phone = result.phone;
      updateData.phoneConfidence = result.confidenceFlag === 'pdl_matched' ? 0.85 : 0.70;
      updateData.phoneSource = 'pdl';
    }
    if (result.mobilePhone) {
      updateData.enrichmentPhonePersonal = result.mobilePhone;
    }
    if (result.workPhone) {
      updateData.enrichmentPhoneWork = result.workPhone;
    }

    if (result.employerLeftDetected) {
      const currentTitle = result.pdlTitle || result.crustdataTitle || result.title || null;
      const currentCompany = result.pdlCompany || result.crustdataCompany || null;
      const currentDomain = result.pdlCompanyDomain || result.crustdataCompanyDomain || null;
      
      console.log(`[EnrichContact] EMPLOYER LEFT DETECTED for ${contact.fullName}: ${result.employerLeftReason}`);
      console.log(`[EnrichContact] Updating to current employer: ${currentTitle} at ${currentCompany} (${currentDomain})`);
      
      if (currentTitle) {
        updateData.title = currentTitle;
        updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
      }
      if (currentCompany) {
        updateData.employerName = currentCompany;
      }
      if (currentDomain) {
        updateData.companyDomain = currentDomain;
      }
    } else if (isReResearch) {
      if (result.title) {
        updateData.title = result.title;
        updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
      }
      if (result.company) {
        updateData.employerName = result.company;
      }
      if (result.companyDomain) {
        updateData.companyDomain = result.companyDomain;
      }
    } else {
      if (result.title && !contact.title) {
        updateData.title = result.title;
        updateData.titleConfidence = result.confidenceFlag === 'verified' ? 0.95 : 0.80;
      }
      if (result.company && !contact.employerName) {
        updateData.employerName = result.company;
      }
      if (result.companyDomain && !contact.companyDomain) {
        updateData.companyDomain = result.companyDomain;
      }
    }

    if (result.photoUrl) {
      updateData.photoUrl = result.photoUrl;
    }

    if (result.location && !contact.location) {
      updateData.location = result.location;
    }

    updateData.findymailVerified = result.findymailVerified;
    updateData.findymailVerifyStatus = result.findymailVerifyStatus;

    updateData.pdlRawResponse = result.pdlRaw;
    updateData.crustdataRawResponse = result.crustdataRaw;

    updateData.pdlFullName = result.pdlFullName;
    updateData.pdlWorkEmail = result.pdlWorkEmail;
    updateData.pdlEmailsJson = result.pdlEmailsJson;
    updateData.pdlPersonalEmails = result.pdlPersonalEmails;
    updateData.pdlPhonesJson = result.pdlPhonesJson;
    updateData.pdlMobilePhone = result.pdlMobilePhone;
    updateData.pdlLinkedinUrl = result.pdlLinkedinUrl;
    updateData.pdlTitle = result.pdlTitle;
    updateData.pdlCompany = result.pdlCompany;
    updateData.pdlCompanyDomain = result.pdlCompanyDomain;
    updateData.pdlTitleRole = result.pdlTitleRole;
    updateData.pdlTitleLevels = result.pdlTitleLevels;
    updateData.pdlTitleClass = result.pdlTitleClass;
    updateData.pdlTitleSubRole = result.pdlTitleSubRole;
    updateData.pdlLocation = result.pdlLocation;
    updateData.pdlCity = result.pdlCity;
    updateData.pdlState = result.pdlState;
    updateData.pdlAddressesJson = result.pdlAddressesJson;
    updateData.pdlIndustry = result.pdlIndustry;
    updateData.pdlGender = result.pdlGender;
    updateData.pdlDatasetVersion = result.pdlDatasetVersion;

    updateData.crustdataTitle = result.crustdataTitle;
    updateData.crustdataCompany = result.crustdataCompany;
    updateData.crustdataCompanyDomain = result.crustdataCompanyDomain;
    updateData.crustdataWorkEmail = result.crustdataWorkEmail;
    updateData.crustdataLinkedinUrl = result.crustdataLinkedinUrl;
    updateData.crustdataLocation = result.crustdataLocation;
    updateData.crustdataEnriched = result.crustdataEnriched;
    if (result.crustdataEnriched) {
      updateData.crustdataEnrichedAt = new Date();
    }

    updateData.providerId = result.providerId;
    updateData.pdlEnriched = true;
    updateData.pdlEnrichedAt = new Date();

    const cleanUpdate = Object.fromEntries(
      Object.entries(updateData).filter(([_, v]) => v !== undefined)
    );

    const [updatedContact] = await db
      .update(contacts)
      .set(cleanUpdate)
      .where(eq(contacts.id, id))
      .returning();

    if (result.employerLeftDetected) {
      try {
        const updatedPCs = await db
          .update(propertyContacts)
          .set({
            relationshipStatus: 'job_change_detected',
            relationshipStatusReason: result.employerLeftReason,
          })
          .where(
            and(
              eq(propertyContacts.contactId, id),
              sql`(${propertyContacts.relationshipStatus} IS NULL OR ${propertyContacts.relationshipStatus} != 'job_change_detected')`
            )
          )
          .returning();
        
        if (updatedPCs.length > 0) {
          console.log(`[EnrichContact] Marked ${updatedPCs.length} property-contact relationship(s) as 'job_change_detected' for ${contact.fullName}`);
        }

        const updatedOrgs = await db
          .update(contactOrganizations)
          .set({ isCurrent: false })
          .where(
            and(
              eq(contactOrganizations.contactId, id),
              eq(contactOrganizations.isCurrent, true)
            )
          )
          .returning();

        if (updatedOrgs.length > 0) {
          console.log(`[EnrichContact] Marked ${updatedOrgs.length} organization relationship(s) as former for ${contact.fullName}`);
        }
      } catch (relError) {
        console.error(`[EnrichContact] Failed to update relationship status for ${contact.fullName}:`, relError);
      }
    }

    const employerDomain = updatedContact.companyDomain || result.pdlCompanyDomain || result.crustdataCompanyDomain || null;
    const employerName = updatedContact.employerName || result.pdlCompany || result.crustdataCompany || null;
    const employerPdlId = result.companyPdlId || null;

    if (employerDomain || employerName || employerPdlId) {
      ensureEmployerOrgEnriched({
        contactId: id,
        companyDomain: employerDomain,
        companyName: employerName,
        companyPdlId: employerPdlId,
        contactTitle: updatedContact.title || result.pdlTitle || result.crustdataTitle || null,
      }).catch(err => {
        console.error(`[EnrichContact] Error ensuring employer org:`, err instanceof Error ? err.message : err);
      });
    }

    const afterSnapshot = captureSnapshot(updatedContact);
    const changes = detectChanges(beforeSnapshot, afterSnapshot);
    let versionCreated = false;
    let newVersion = 1;

    if (changes.length > 0) {
      const [latestSnapshot] = await db
        .select({ version: contactSnapshots.version })
        .from(contactSnapshots)
        .where(eq(contactSnapshots.contactId, id))
        .orderBy(desc(contactSnapshots.version))
        .limit(1);

      newVersion = (latestSnapshot?.version || 0) + 1;

      await db.insert(contactSnapshots).values({
        contactId: id,
        version: newVersion,
        snapshotData: afterSnapshot,
        changes,
        changeType: isReResearch ? 're-research' : 'research',
        triggeredBy: userId || undefined,
        isCanonical: !isReResearch,
      });

      if (userId) {
        await db.insert(userContactVersions)
          .values({
            userId,
            contactId: id,
            viewingVersion: newVersion,
            hasUnseenUpdate: false,
          })
          .onConflictDoUpdate({
            target: [userContactVersions.userId, userContactVersions.contactId],
            set: {
              viewingVersion: newVersion,
              hasUnseenUpdate: false,
              updatedAt: new Date(),
            },
          });

        if (isReResearch) {
          await db.execute(sql`
            UPDATE user_contact_versions 
            SET has_unseen_update = true, updated_at = NOW()
            WHERE contact_id = ${id} AND user_id != ${userId}
          `);
        }
      }

      versionCreated = true;
      console.log(`[EnrichContact] Version ${newVersion} created for ${contact.fullName} with ${changes.length} change(s): ${changes.map(c => c.field).join(', ')}`);
    }

    return NextResponse.json({
      success: true,
      contact: {
        id: updatedContact.id,
        fullName: updatedContact.fullName,
        email: updatedContact.email,
        emailConfidence: updatedContact.emailConfidence,
        phone: updatedContact.phone,
        phoneConfidence: updatedContact.phoneConfidence,
        linkedinUrl: updatedContact.linkedinUrl,
        linkedinConfidence: updatedContact.linkedinConfidence,
        title: updatedContact.title,
        employerName: updatedContact.employerName,
        photoUrl: updatedContact.photoUrl,
        confidenceFlag: updatedContact.confidenceFlag,
      },
      enrichmentResult: {
        linkedinUrl: result.linkedinUrl,
        email: result.email,
        phone: result.phone,
        title: result.title,
        company: result.company,
        photoUrl: result.photoUrl,
        confidenceFlag: result.confidenceFlag,
        emailSource: result.emailSource,
        enrichmentSource: result.enrichmentSource,
      },
      versioning: {
        isReResearch,
        changesDetected: changes.length > 0,
        changes,
        version: versionCreated ? newVersion : null,
      },
    });
  } catch (error) {
    console.error('[EnrichContact] API error:', error);
    
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: 'Failed to enrich contact' },
      { status: 500 }
    );
  }
}

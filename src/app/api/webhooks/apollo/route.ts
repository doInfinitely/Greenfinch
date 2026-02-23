/**
 * Apollo.io Webhook Handler
 * 
 * Receives asynchronous waterfall enrichment results from Apollo.
 * This endpoint is called by Apollo after running data waterfall enrichment
 * to deliver phone numbers and additional email data.
 * 
 * API Documentation: https://docs.apollo.io/docs/enrich-phone-and-email-using-data-waterfall
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contacts } from '@/lib/schema';
import { eq } from 'drizzle-orm';

interface ApolloWaterfallPhoneNumber {
  _id: string;
  raw_number: string;
  sanitized_number: string;
  type_cd: string | null;
  status_cd: string | null;
  confidence_cd: string | null;
  dnc_status_cd: string | null;
}

interface ApolloWaterfallEmail {
  email: string;
  email_status_cd: string | null;
  third_party_data_provider_id: string | null;
  position: number;
}

interface ApolloWaterfallVendor {
  id: string;
  name: string;
  status: string;
  phone_numbers?: string[];
  emails?: string[];
  statusCode?: string | null;
  statusMessage?: string | null;
}

interface ApolloWaterfallPerson {
  id: string;
  phone_numbers?: ApolloWaterfallPhoneNumber[];
  emails?: ApolloWaterfallEmail[];
  waterfall?: {
    emails?: Array<{ vendors?: ApolloWaterfallVendor[] }>;
    phone_numbers?: Array<{ vendors?: ApolloWaterfallVendor[] }>;
  };
}

interface ApolloWaterfallWebhookPayload {
  status: 'success' | 'failed';
  request_id: string;
  request_initiated: string;
  request_completed: string;
  total_requested_enrichments: number;
  target_fields: string[];
  records_enriched: number;
  email_records_enriched: number;
  mobile_records_enriched: number;
  enrichment_not_found: number;
  email_records_not_found: number;
  mobile_records_not_found: number;
  credits_consumed: number;
  people: ApolloWaterfallPerson[];
}

export async function POST(request: NextRequest) {
  console.log('[Apollo Webhook] Received callback');
  
  try {
    const rawPayload = await request.text();
    console.log('[Apollo Webhook] Raw payload (first 2000 chars):', rawPayload.substring(0, 2000));
    
    const payload: ApolloWaterfallWebhookPayload = JSON.parse(rawPayload);
    
    console.log('[Apollo Webhook] Request ID:', payload.request_id);
    console.log('[Apollo Webhook] Status:', payload.status);
    console.log('[Apollo Webhook] Records enriched:', payload.records_enriched);
    console.log('[Apollo Webhook] Mobile records enriched:', payload.mobile_records_enriched);
    console.log('[Apollo Webhook] People count:', payload.people?.length || 0);
    
    if (payload.status !== 'success') {
      console.log('[Apollo Webhook] Enrichment failed');
      return NextResponse.json({ 
        received: true, 
        status: 'failed',
        message: 'Enrichment was not successful' 
      });
    }

    if (!payload.people || payload.people.length === 0) {
      console.log('[Apollo Webhook] No people in payload');
      return NextResponse.json({ 
        received: true, 
        status: 'no_data',
        message: 'No people data in webhook' 
      });
    }

    let updatedContacts = 0;

    for (const person of payload.people) {
      console.log('[Apollo Webhook] Processing person:', person.id);
      console.log('[Apollo Webhook] Person keys:', Object.keys(person));
      
      // Get phone numbers - try top-level first, then waterfall nested
      let phoneNumbers: ApolloWaterfallPhoneNumber[] = person.phone_numbers || [];
      
      // If no top-level phone_numbers, try extracting from waterfall.phone_numbers
      if (phoneNumbers.length === 0 && person.waterfall?.phone_numbers) {
        console.log('[Apollo Webhook] Checking waterfall.phone_numbers...');
        // Extract phone numbers from waterfall vendors
        for (const phoneResult of person.waterfall.phone_numbers) {
          if (phoneResult.vendors) {
            for (const vendor of phoneResult.vendors) {
              if (vendor.phone_numbers && Array.isArray(vendor.phone_numbers)) {
                for (const phoneNum of vendor.phone_numbers) {
                  phoneNumbers.push({
                    _id: '',
                    raw_number: phoneNum,
                    sanitized_number: phoneNum.startsWith('+') ? phoneNum : `+1${phoneNum.replace(/\D/g, '')}`,
                    type_cd: null,
                    status_cd: vendor.status || null,
                    confidence_cd: null,
                    dnc_status_cd: null,
                  });
                }
              }
            }
          }
        }
      }
      
      console.log('[Apollo Webhook] Total phone numbers found:', phoneNumbers.length);
      
      if (phoneNumbers.length > 0) {
        // Find the contact with this Apollo ID
        const existingContacts = await db.select()
          .from(contacts)
          .where(eq(contacts.providerId, person.id))
          .limit(1);

        if (existingContacts.length > 0) {
          const contact = existingContacts[0];
          console.log('[Apollo Webhook] Found matching contact:', contact.fullName);

          // Get all phones with their types
          const allPhones = phoneNumbers.map(p => ({
            number: p.sanitized_number || p.raw_number,
            type: p.type_cd
          }));
          
          // Get existing phones to check for duplicates (normalize for comparison)
          const normalizePhone = (phone: string | null) => phone?.replace(/\D/g, '') || '';
          const existingPhones = new Set([
            normalizePhone(contact.phone),
            normalizePhone(contact.aiPhone),
            normalizePhone(contact.enrichmentPhoneWork),
            normalizePhone(contact.enrichmentPhonePersonal),
          ].filter(p => p));
          
          // Filter out duplicates
          const newPhones = allPhones.filter(p => !existingPhones.has(normalizePhone(p.number)));
          
          console.log('[Apollo Webhook] Existing phones:', Array.from(existingPhones));
          console.log('[Apollo Webhook] New phones to add:', newPhones.map(p => `${p.number} (${p.type})`));
          
          // Build update data
          const updateData: Record<string, any> = {
            phoneSource: 'apollo_waterfall',
            enrichedAt: new Date(),
          };

          // Separate by type from new phones
          const workPhones = newPhones.filter(p => 
            p.type === 'work' || p.type === 'work_direct' || p.type === 'work_hq'
          );
          const mobilePhones = newPhones.filter(p => p.type === 'mobile');
          const otherPhones = newPhones.filter(p => 
            p.type !== 'work' && p.type !== 'work_direct' && p.type !== 'work_hq' && p.type !== 'mobile'
          );

          // Store work phones in enrichmentPhoneWork (if slot is empty)
          if (workPhones.length > 0 && !contact.enrichmentPhoneWork) {
            updateData.enrichmentPhoneWork = workPhones[0].number;
          }
          // Store mobile phones in enrichmentPhonePersonal (if slot is empty)
          if (mobilePhones.length > 0 && !contact.enrichmentPhonePersonal) {
            updateData.enrichmentPhonePersonal = mobilePhones[0].number;
          }

          // Set primary phone if contact doesn't have one - use first new phone of any type
          if (!contact.phone && !contact.aiPhone && newPhones.length > 0) {
            const primaryPhone = newPhones[0];
            updateData.phone = primaryPhone.number;
            updateData.normalizedPhone = primaryPhone.number;
            
            // Determine phone label
            let phoneLabel = 'unknown';
            if (primaryPhone.type === 'mobile') {
              phoneLabel = 'mobile';
            } else if (primaryPhone.type === 'work' || primaryPhone.type === 'work_direct' || primaryPhone.type === 'work_hq') {
              phoneLabel = 'work';
            } else if (primaryPhone.type === 'home') {
              phoneLabel = 'home';
            }
            updateData.phoneLabel = phoneLabel;
          }
          
          // If primary phone slot is taken but we have "other" type phones, store in available slot
          if (contact.phone && otherPhones.length > 0) {
            if (!contact.enrichmentPhoneWork && !updateData.enrichmentPhoneWork) {
              updateData.enrichmentPhoneWork = otherPhones[0].number;
            } else if (!contact.enrichmentPhonePersonal && !updateData.enrichmentPhonePersonal) {
              updateData.enrichmentPhonePersonal = otherPhones[0].number;
            }
          }

          await db.update(contacts)
            .set(updateData)
            .where(eq(contacts.id, contact.id));

          console.log('[Apollo Webhook] Updated contact with', allPhones.length, 'phone numbers (existing phone preserved:', !!contact.phone || !!contact.aiPhone, ')');
          updatedContacts++;
        } else {
          console.log('[Apollo Webhook] No matching contact found for Apollo ID:', person.id);
        }
      }

      // Also update emails if provided
      const emails = person.emails || [];
      console.log('[Apollo Webhook] Emails found:', emails.length);
      if (emails.length > 0) {
        console.log('[Apollo Webhook] First email data:', JSON.stringify(emails[0]));
      }
      
      if (emails.length > 0 && emails[0].email) {
        const existingContacts = await db.select()
          .from(contacts)
          .where(eq(contacts.providerId, person.id))
          .limit(1);

        if (existingContacts.length > 0) {
          const contact = existingContacts[0];
          const emailData = emails[0];
          
          // Update if no email OR current email is not validated
          const shouldUpdateEmail = !contact.email || contact.emailValidationStatus !== 'valid';
          console.log('[Apollo Webhook] Should update email:', shouldUpdateEmail, 
            '(current email:', contact.email, 
            ', validation:', contact.emailValidationStatus, ')');
          
          if (shouldUpdateEmail) {
            const emailStatus = emailData.email_status_cd?.toLowerCase() === 'verified' 
              ? 'valid' 
              : (emailData.email_status_cd?.toLowerCase() || 'not_validated');
            
            await db.update(contacts)
              .set({
                email: emailData.email,
                emailValidationStatus: emailStatus,
                enrichedAt: new Date(),
              })
              .where(eq(contacts.id, contact.id));

            console.log('[Apollo Webhook] Updated contact email:', emailData.email, 'status:', emailStatus);
            updatedContacts++;
          }
        }
      }
      
      // CRITICAL: Always update enrichedAt even if no data was found
      // This signals to polling that the webhook has processed this request
      if (phoneNumbers.length === 0 && emails.length === 0) {
        console.log('[Apollo Webhook] No data found, updating enrichedAt to signal completion');
        const existingContacts = await db.select()
          .from(contacts)
          .where(eq(contacts.providerId, person.id))
          .limit(1);
          
        if (existingContacts.length > 0) {
          await db.update(contacts)
            .set({ enrichedAt: new Date() })
            .where(eq(contacts.id, existingContacts[0].id));
          console.log('[Apollo Webhook] Updated enrichedAt for', existingContacts[0].fullName, '(no data found)');
        }
      }
    }

    console.log('[Apollo Webhook] Processing complete. Updated', updatedContacts, 'contacts');
    
    return NextResponse.json({ 
      received: true, 
      status: 'success',
      updated_contacts: updatedContacts 
    });

  } catch (error: any) {
    console.error('[Apollo Webhook] Error processing webhook:', error.message);
    return NextResponse.json(
      { received: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: 'ok', 
    message: 'Apollo webhook endpoint is active' 
  });
}

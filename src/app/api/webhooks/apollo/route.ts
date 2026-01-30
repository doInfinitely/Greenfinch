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

          // Get primary phone (first one) and all phones
          const primaryPhone = phoneNumbers[0].sanitized_number || phoneNumbers[0].raw_number;
          const allPhones = phoneNumbers.map(p => p.sanitized_number || p.raw_number);
          
          // Determine phone label from first phone
          let phoneLabel = 'unknown';
          const firstPhoneTypeCd = phoneNumbers[0].type_cd;
          if (firstPhoneTypeCd === 'mobile') {
            phoneLabel = 'mobile';
          } else if (firstPhoneTypeCd === 'work' || firstPhoneTypeCd === 'work_direct' || firstPhoneTypeCd === 'work_hq') {
            phoneLabel = 'work';
          } else if (firstPhoneTypeCd === 'home') {
            phoneLabel = 'home';
          }

          // Update contact with phone numbers
          // Store additional phones in enrichmentPhoneWork/Personal if more than one
          const updateData: Record<string, any> = {
            phone: primaryPhone,
            normalizedPhone: primaryPhone,
            phoneLabel: phoneLabel,
            phoneSource: 'apollo_waterfall',
            enrichedAt: new Date(),
          };

          // If there are work phones vs personal phones, separate them
          const workPhones = phoneNumbers.filter(p => 
            p.type_cd === 'work' || p.type_cd === 'work_direct' || p.type_cd === 'work_hq'
          );
          const mobilePhones = phoneNumbers.filter(p => p.type_cd === 'mobile');

          if (workPhones.length > 0) {
            updateData.enrichmentPhoneWork = workPhones[0].sanitized_number || workPhones[0].raw_number;
          }
          if (mobilePhones.length > 0) {
            updateData.enrichmentPhonePersonal = mobilePhones[0].sanitized_number || mobilePhones[0].raw_number;
          }

          await db.update(contacts)
            .set(updateData)
            .where(eq(contacts.id, contact.id));

          console.log('[Apollo Webhook] Updated contact with', allPhones.length, 'phone numbers');
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

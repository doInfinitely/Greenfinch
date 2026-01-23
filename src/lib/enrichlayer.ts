const ENRICHLAYER_API_KEY = process.env.ENRICHLAYER_API_KEY;
const ENRICHLAYER_BASE_URL = 'https://enrichlayer.com/api/v2';

export interface EnrichLayerPersonInput {
  firstName: string;
  lastName?: string;
  companyDomain?: string;
  location?: string;
  linkedinUrl?: string;
}

export interface EnrichLayerPersonResult {
  success: boolean;
  linkedinUrl?: string;
  email?: string;
  personalEmail?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  company?: string;
  title?: string;
  profilePicture?: string;
  skills?: string[];
  error?: string;
  creditsUsed?: number;
  rawResponse?: any;
}

export interface EnrichLayerProfileResult {
  success: boolean;
  linkedinUrl?: string;
  email?: string;
  personalEmail?: string;
  workEmail?: string;
  phone?: string;
  personalPhone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  company?: string;
  title?: string;
  profilePicture?: string;
  summary?: string;
  skills?: string[];
  experiences?: Array<{
    title: string;
    company: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
  }>;
  education?: Array<{
    school: string;
    degree?: string;
    field?: string;
    startDate?: string;
    endDate?: string;
  }>;
  error?: string;
  creditsUsed?: number;
  rawResponse?: any;
}

function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

export async function lookupPerson(input: EnrichLayerPersonInput): Promise<EnrichLayerPersonResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.error('[EnrichLayer] API key not configured');
    return { success: false, error: 'EnrichLayer API key not configured' };
  }

  try {
    const params = new URLSearchParams();
    params.append('first_name', input.firstName);
    if (input.lastName) {
      params.append('last_name', input.lastName);
    }
    if (input.companyDomain) {
      params.append('company_domain', input.companyDomain);
    }
    if (input.location) {
      params.append('location', input.location);
    }
    params.append('enrich_profile', 'enrich');
    params.append('similarity_checks', 'include');

    const url = `${ENRICHLAYER_BASE_URL}/profile/resolve?${params.toString()}`;
    console.log('[EnrichLayer] Person lookup request:', { firstName: input.firstName, lastName: input.lastName, companyDomain: input.companyDomain });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EnrichLayer] API error:', response.status, errorText);
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Person lookup response:', JSON.stringify(data).slice(0, 500));

    if (!data || data.error) {
      return { success: false, error: data?.error || 'No data returned', rawResponse: data };
    }

    const profile = data.profile || data;
    
    // The resolve endpoint returns LinkedIn URL at top level as 'url'
    const linkedinUrl = data.url ?? profile.linkedin_url ?? (profile.public_identifier ? `https://www.linkedin.com/in/${profile.public_identifier}` : undefined);
    
    return {
      success: true,
      linkedinUrl,
      email: profile.work_email || profile.email,
      personalEmail: profile.personal_email,
      phone: profile.phone_number || profile.personal_contact_number,
      firstName: profile.first_name,
      lastName: profile.last_name,
      fullName: profile.full_name,
      headline: profile.headline,
      location: profile.location_str || profile.location || profile.city,
      company: profile.company || profile.current_company,
      title: profile.title || profile.occupation,
      profilePicture: profile.profile_pic_url,
      skills: profile.skills,
      creditsUsed: data.credits_used,
      rawResponse: data,
    };
  } catch (error) {
    console.error('[EnrichLayer] Person lookup error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function enrichLinkedInProfile(linkedinUrl: string, options?: {
  includeEmail?: boolean;
  includePhone?: boolean;
  includeSkills?: boolean;
  liveFetch?: boolean;
}): Promise<EnrichLayerProfileResult> {
  if (!ENRICHLAYER_API_KEY) {
    console.error('[EnrichLayer] API key not configured');
    return { success: false, error: 'EnrichLayer API key not configured' };
  }

  try {
    const params = new URLSearchParams();
    params.append('profile_url', linkedinUrl);
    
    if (options?.includeEmail !== false) {
      params.append('personal_email', 'include');
    }
    if (options?.includePhone !== false) {
      params.append('personal_contact_number', 'include');
    }
    if (options?.includeSkills) {
      params.append('skills', 'include');
    }
    params.append('extra', 'include');
    
    if (options?.liveFetch) {
      params.append('live_fetch', 'force');
    }

    const url = `${ENRICHLAYER_BASE_URL}/profile?${params.toString()}`;
    console.log('[EnrichLayer] Profile enrichment request:', { linkedinUrl, options });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ENRICHLAYER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EnrichLayer] API error:', response.status, errorText);
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    console.log('[EnrichLayer] Profile enrichment response:', JSON.stringify(data).slice(0, 500));

    if (!data || data.error) {
      return { success: false, error: data?.error || 'No data returned', rawResponse: data };
    }

    return {
      success: true,
      linkedinUrl: data.linkedin_url ?? (data.public_identifier ? `https://www.linkedin.com/in/${data.public_identifier}` : linkedinUrl),
      email: data.work_email,
      personalEmail: data.personal_email,
      workEmail: data.work_email,
      phone: data.phone_number,
      personalPhone: data.personal_contact_number,
      firstName: data.first_name,
      lastName: data.last_name,
      fullName: data.full_name,
      headline: data.headline,
      location: data.location,
      city: data.city,
      state: data.state,
      country: data.country,
      company: data.company || data.experiences?.[0]?.company,
      title: data.occupation || data.experiences?.[0]?.title,
      profilePicture: data.profile_pic_url,
      summary: data.summary,
      skills: data.skills,
      experiences: data.experiences?.map((exp: any) => ({
        title: exp.title,
        company: exp.company,
        startDate: exp.starts_at ? `${exp.starts_at.year}-${exp.starts_at.month || 1}` : undefined,
        endDate: exp.ends_at ? `${exp.ends_at.year}-${exp.ends_at.month || 1}` : undefined,
        current: !exp.ends_at,
      })),
      education: data.education?.map((edu: any) => ({
        school: edu.school,
        degree: edu.degree_name,
        field: edu.field_of_study,
        startDate: edu.starts_at ? `${edu.starts_at.year}` : undefined,
        endDate: edu.ends_at ? `${edu.ends_at.year}` : undefined,
      })),
      creditsUsed: data.credits_used,
      rawResponse: data,
    };
  } catch (error) {
    console.error('[EnrichLayer] Profile enrichment error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function enrichContact(contact: {
  fullName: string;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
}): Promise<EnrichLayerPersonResult | EnrichLayerProfileResult> {
  if (contact.linkedinUrl) {
    return enrichLinkedInProfile(contact.linkedinUrl, {
      includeEmail: true,
      includePhone: true,
      includeSkills: true,
    });
  }

  const { firstName, lastName } = parseFullName(contact.fullName);
  
  return lookupPerson({
    firstName,
    lastName,
    companyDomain: contact.companyDomain || undefined,
    location: contact.location || undefined,
  });
}

// Test PeopleDataLabs Person Enrichment API for NorthPark contacts

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;
const PDL_BASE_URL = "https://api.peopledatalabs.com/v5";

const contacts = [
  { fullName: "Kristen Gibbins", title: "Executive Director, General Manager", company: "NorthPark Center", aiEmail: "kgibbins@northparkcntr.com" },
  { fullName: "Angela Boots", title: "Executive Director, Leasing", company: "NorthPark Center", aiEmail: "aboots@northparkcntr.com" },
  { fullName: "Vernon Wilson", title: "Facilities Manager", company: "NorthPark Center", aiEmail: "vwilson@northparkcntr.com" },
  { fullName: "Brenda Buhr-Hancock", title: "Director of Design and Special Projects", company: "NorthPark Center", aiEmail: "bbuhrhancock@northparkcntr.com" },
  { fullName: "David Haemisegger", title: "President", company: "NorthPark Center", aiEmail: "dhaemisegger@northparkcntr.com" },
  { fullName: "Liz Meyer", title: "Risk Manager & Lease Administrator", company: "NorthPark Center", aiEmail: "lmeyer@northparkcntr.com" },
  { fullName: "Robby Gammons", title: "Chief Engineer", company: "NorthPark Center", aiEmail: "rgammons@northparkcntr.com" },
];

interface PDLResult {
  name: string;
  found: boolean;
  workEmail: string | null;
  personalEmail: string | null;
  linkedin: string | null;
  phone: string | null;
  title: string | null;
  error?: string;
}

async function lookupPerson(contact: typeof contacts[0]): Promise<PDLResult> {
  const [firstName, ...lastParts] = contact.fullName.split(" ");
  const lastName = lastParts.join(" ");
  
  const params = new URLSearchParams({
    name: contact.fullName,
    company: contact.company,
    location: "Dallas, TX",
    pretty: "true",
  });
  
  try {
    const response = await fetch(`${PDL_BASE_URL}/person/enrich?${params}`, {
      method: "GET",
      headers: {
        "X-Api-Key": PDL_API_KEY!,
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { 
        name: contact.fullName, 
        found: false, 
        workEmail: null, 
        personalEmail: null, 
        linkedin: null, 
        phone: null, 
        title: null,
        error: `${response.status}: ${errorText.substring(0, 100)}` 
      };
    }
    
    const data = await response.json();
    console.log(`  PDL response for ${contact.fullName}:`, JSON.stringify(data, null, 2).substring(0, 500));
    
    // Extract work email (prefer work over personal)
    const workEmail = data.work_email || data.emails?.find((e: any) => e.type === "professional")?.address || null;
    const personalEmail = data.personal_emails?.[0] || data.emails?.find((e: any) => e.type === "personal")?.address || null;
    const linkedin = data.linkedin_url || null;
    const phone = data.phone_numbers?.[0] || data.mobile_phone || null;
    const title = data.job_title || null;
    
    return {
      name: contact.fullName,
      found: true,
      workEmail,
      personalEmail,
      linkedin,
      phone,
      title,
    };
  } catch (error: any) {
    return { 
      name: contact.fullName, 
      found: false, 
      workEmail: null, 
      personalEmail: null, 
      linkedin: null, 
      phone: null, 
      title: null,
      error: error.message 
    };
  }
}

async function main() {
  if (!PDL_API_KEY) {
    console.error("PEOPLEDATALABS_API_KEY not set");
    process.exit(1);
  }
  
  console.log("=== PEOPLEDATALABS CONTACT ENRICHMENT TEST ===\n");
  
  const results: PDLResult[] = [];
  
  for (const contact of contacts) {
    console.log(`\n--- ${contact.fullName} ---`);
    const result = await lookupPerson(contact);
    results.push(result);
    
    if (result.found) {
      console.log(`  ✓ Found`);
      console.log(`    Work Email: ${result.workEmail || '-'}`);
      console.log(`    Personal Email: ${result.personalEmail || '-'}`);
      console.log(`    LinkedIn: ${result.linkedin || '-'}`);
      console.log(`    Phone: ${result.phone || '-'}`);
      console.log(`    Title: ${result.title || '-'}`);
    } else {
      console.log(`  ✗ Not found: ${result.error || 'No match'}`);
    }
    
    // Rate limit pause
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log("\n\n=== COMPARISON: AI vs PDL ===\n");
  console.log("| Name | AI Email | PDL Work Email | PDL LinkedIn | Status |");
  console.log("|------|----------|----------------|--------------|--------|");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ai = contacts[i].aiEmail;
    console.log(`| ${r.name} | ${ai} | ${r.workEmail || '-'} | ${r.linkedin ? '✓' : '-'} | ${r.found ? 'found' : r.error || 'not found'} |`);
  }
}

main().catch(console.error);

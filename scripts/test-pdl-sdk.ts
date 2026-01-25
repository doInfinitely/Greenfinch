// Test PeopleDataLabs using official JavaScript SDK

import PDLJS from 'peopledatalabs';

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

if (!PDL_API_KEY) {
  console.error("PEOPLEDATALABS_API_KEY not set");
  process.exit(1);
}

// Create PDL client
const PDLClient = new PDLJS({ apiKey: PDL_API_KEY });

const contacts = [
  { name: "Kristen Gibbins", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "Angela Boots", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "Vernon Wilson", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "Brenda Buhr-Hancock", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "David Haemisegger", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "Liz Meyer", company: "NorthPark Center", location: "Dallas, TX" },
  { name: "Robby Gammons", company: "NorthPark Center", location: "Dallas, TX" },
];

interface Result {
  name: string;
  found: boolean;
  workEmail: string | null;
  linkedin: string | null;
  title: string | null;
  likelihood: number;
  error?: string;
}

async function enrichPerson(contact: typeof contacts[0]): Promise<Result> {
  try {
    const response = await PDLClient.person.enrichment({
      name: contact.name,
      company: contact.company,
      location: contact.location,
      min_likelihood: 2,
      required: "work_email",  // Only return if work email exists
    });
    
    const data = response.data;
    console.log(`  Response for ${contact.name}:`, JSON.stringify({
      likelihood: response.likelihood,
      work_email: data?.work_email,
      linkedin_url: data?.linkedin_url,
      job_title: data?.job_title,
      job_company_name: data?.job_company_name,
    }, null, 2));
    
    return {
      name: contact.name,
      found: true,
      workEmail: data?.work_email || null,
      linkedin: data?.linkedin_url || null,
      title: data?.job_title || null,
      likelihood: response.likelihood || 0,
    };
  } catch (error: any) {
    // PDL returns 404 when no match found
    if (error.status === 404) {
      return { name: contact.name, found: false, workEmail: null, linkedin: null, title: null, likelihood: 0, error: "No match" };
    }
    return { name: contact.name, found: false, workEmail: null, linkedin: null, title: null, likelihood: 0, error: error.message || String(error) };
  }
}

async function main() {
  console.log("=== PEOPLEDATALABS SDK TEST ===\n");
  console.log("Using required=work_email to only return profiles with work emails\n");
  
  const results: Result[] = [];
  
  for (const contact of contacts) {
    console.log(`\n--- ${contact.name} ---`);
    const result = await enrichPerson(contact);
    results.push(result);
    
    if (result.found) {
      console.log(`  ✓ Found (likelihood: ${result.likelihood})`);
      console.log(`    Work Email: ${result.workEmail || '-'}`);
      console.log(`    LinkedIn: ${result.linkedin || '-'}`);
      console.log(`    Title: ${result.title || '-'}`);
    } else {
      console.log(`  ✗ ${result.error}`);
    }
    
    // Rate limit pause
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log("\n\n=== SUMMARY ===\n");
  console.log("| Name | Work Email | LinkedIn | Likelihood |");
  console.log("|------|------------|----------|------------|");
  for (const r of results) {
    console.log(`| ${r.name} | ${r.workEmail || '-'} | ${r.linkedin ? '✓' : '-'} | ${r.found ? r.likelihood : 'N/A'} |`);
  }
}

main().catch(console.error);

// Verify PDL SDK with known test case (Sean Thorne - PDL CEO)

import PDLJS from 'peopledatalabs';

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

if (!PDL_API_KEY) {
  console.error("PEOPLEDATALABS_API_KEY not set");
  process.exit(1);
}

const PDLClient = new PDLJS({ apiKey: PDL_API_KEY });

async function main() {
  console.log("=== PDL SDK VERIFICATION TEST ===\n");
  
  // Test 1: Known LinkedIn profile (Sean Thorne - PDL CEO)
  console.log("Test 1: Enrichment by LinkedIn profile (Sean Thorne)...");
  try {
    const response = await PDLClient.person.enrichment({ 
      profile: 'linkedin.com/in/seanthorne' 
    });
    
    console.log("Status:", response.status);
    console.log("Likelihood:", response.likelihood);
    console.log("Full Name:", response.data?.full_name);
    console.log("Work Email:", response.data?.work_email);
    console.log("Job Title:", response.data?.job_title);
    console.log("Company:", response.data?.job_company_name);
    console.log("LinkedIn:", response.data?.linkedin_url);
    console.log("\n--- Raw work_email type:", typeof response.data?.work_email);
    console.log("--- Raw emails:", JSON.stringify(response.data?.emails, null, 2));
    
  } catch (error: any) {
    console.log("Error:", error.message || error);
  }
  
  // Test 2: By name + company
  console.log("\n\nTest 2: Enrichment by name + company...");
  try {
    const response = await PDLClient.person.enrichment({
      first_name: 'Sean',
      last_name: 'Thorne',
      company: 'People Data Labs',
    });
    
    console.log("Status:", response.status);
    console.log("Full Name:", response.data?.full_name);
    console.log("Work Email:", response.data?.work_email);
    console.log("Work Email type:", typeof response.data?.work_email);
    
  } catch (error: any) {
    console.log("Error:", error.message || error);
  }
  
  // Test 3: Check API credits/account status
  console.log("\n\nTest 3: Testing with phone number...");
  try {
    const response = await PDLClient.person.enrichment({ 
      phone: '+14155688415'  // From PDL docs example
    });
    
    console.log("Status:", response.status);
    console.log("Full Name:", response.data?.full_name);
    console.log("Work Email:", response.data?.work_email);
    console.log("Work Email type:", typeof response.data?.work_email);
    
  } catch (error: any) {
    console.log("Error:", error.status, error.message || error);
  }
}

main().catch(console.error);

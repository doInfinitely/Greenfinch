// Check PDL account status and sandbox mode

import PDLJS from 'peopledatalabs';

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

if (!PDL_API_KEY) {
  console.error("PEOPLEDATALABS_API_KEY not set");
  process.exit(1);
}

// Try with sandbox: false explicitly
const PDLClient = new PDLJS({ 
  apiKey: PDL_API_KEY,
  sandbox: false,  // Explicitly disable sandbox
});

async function main() {
  console.log("=== PDL SANDBOX CHECK ===\n");
  console.log("API Key (first 10 chars):", PDL_API_KEY?.substring(0, 10) + "...");
  
  // Test with explicit sandbox: false
  console.log("\nTest with sandbox: false...");
  try {
    const response = await PDLClient.person.enrichment({ 
      profile: 'linkedin.com/in/seanthorne',
      // @ts-ignore - try to force sandbox off
      sandbox: false,
    });
    
    console.log("Status:", response.status);
    console.log("Work Email:", response.data?.work_email);
    console.log("Work Email type:", typeof response.data?.work_email);
    console.log("Emails:", response.data?.emails);
    console.log("Phone Numbers:", response.data?.phone_numbers);
    
  } catch (error: any) {
    console.log("Error:", error);
  }
  
  // Direct curl to check raw response
  console.log("\n\nDirect API call with different headers...");
  const url = `https://api.peopledatalabs.com/v5/person/enrich?profile=linkedin.com/in/seanthorne`;
  
  const response = await fetch(url, {
    headers: {
      'X-Api-Key': PDL_API_KEY!,
      'Accept': 'application/json',
    }
  });
  
  const data = await response.json();
  console.log("Response status:", data.status);
  console.log("work_email:", data.data?.work_email);
  console.log("work_email type:", typeof data.data?.work_email);
  console.log("emails:", data.data?.emails);
  console.log("emails type:", typeof data.data?.emails);
  console.log("personal_emails:", data.data?.personal_emails);
}

main().catch(console.error);

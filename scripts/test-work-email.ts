import { enrichContact, lookupWorkEmail } from "../src/lib/enrichlayer";

const contacts = [
  { fullName: "Kristen Gibbins", title: "Executive Director, General Manager", companyDomain: "northparkcenter.com", aiEmail: "kgibbins@northparkcntr.com" },
  { fullName: "Angela Boots", title: "Executive Director, Leasing", companyDomain: "northparkcenter.com", aiEmail: "aboots@northparkcntr.com" },
  { fullName: "Vernon Wilson", title: "Facilities Manager", companyDomain: "northparkcenter.com", aiEmail: "vwilson@northparkcntr.com" },
  { fullName: "Brenda Buhr-Hancock", title: "Director of Design and Special Projects", companyDomain: "northparkcenter.com", aiEmail: "bbuhrhancock@northparkcntr.com" },
  { fullName: "David Haemisegger", title: "President", companyDomain: "northparkcenter.com", aiEmail: "dhaemisegger@northparkcntr.com" },
  { fullName: "Liz Meyer", title: "Risk Manager & Lease Administrator", companyDomain: "northparkcenter.com", aiEmail: "lmeyer@northparkcntr.com" },
  { fullName: "Robby Gammons", title: "Chief Engineer", companyDomain: "northparkcenter.com", aiEmail: "rgammons@northparkcntr.com" },
];

async function main() {
  console.log("=== WORK EMAIL COMPARISON (AI vs EnrichLayer) ===");
  console.log("With fresh fetch (no cache) and domain filtering\n");
  
  const results: Array<{ name: string; aiEmail: string; linkedIn: string | null; workEmail: string | null; status: string }> = [];
  
  for (const contact of contacts) {
    console.log(`\n--- ${contact.fullName} ---`);
    
    // Step 1: Find LinkedIn profile
    const personResult = await enrichContact({
      fullName: contact.fullName,
      companyDomain: contact.companyDomain,
      title: contact.title,
      location: "Dallas, TX",
    });
    
    if (!personResult.success || !personResult.linkedinUrl) {
      console.log(`  ✗ LinkedIn not found`);
      results.push({ name: contact.fullName, aiEmail: contact.aiEmail, linkedIn: null, workEmail: null, status: "no LinkedIn" });
      continue;
    }
    
    console.log(`  LinkedIn: ${personResult.linkedinUrl}`);
    
    // Step 2: Look up work email with fresh fetch and domain filtering
    // NorthPark uses northparkcntr.com for emails (not northparkcenter.com)
    const emailResult = await lookupWorkEmail(personResult.linkedinUrl, {
      validate: true,           // Validate email deliverability
      useCache: 'never',        // Force fresh fetch - avoid stale emails from old jobs
      expectedDomain: 'northparkcntr.com', // Filter to current company domain
    });
    
    if (emailResult.success && emailResult.email) {
      console.log(`  ✓ Work Email: ${emailResult.email}`);
      console.log(`  AI Guessed:  ${contact.aiEmail}`);
      console.log(`  Match: ${emailResult.email.toLowerCase() === contact.aiEmail.toLowerCase() ? 'YES' : 'NO'}`);
      results.push({ name: contact.fullName, aiEmail: contact.aiEmail, linkedIn: personResult.linkedinUrl, workEmail: emailResult.email, status: "found" });
    } else {
      console.log(`  ✗ Work email: ${emailResult.status || emailResult.error}`);
      results.push({ name: contact.fullName, aiEmail: contact.aiEmail, linkedIn: personResult.linkedinUrl, workEmail: null, status: emailResult.status || "error" });
    }
    
    // Pause between contacts to avoid rate limiting
    await new Promise(r => setTimeout(r, 3500));
  }
  
  console.log("\n\n=== COMPARISON TABLE ===\n");
  console.log("| Name | AI Guessed Email | EnrichLayer Work Email | Status |");
  console.log("|------|------------------|------------------------|--------|");
  for (const r of results) {
    console.log(`| ${r.name} | ${r.aiEmail} | ${r.workEmail || '-'} | ${r.status} |`);
  }
}

main().catch(console.error);

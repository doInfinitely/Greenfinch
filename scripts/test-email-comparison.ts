import { enrichContact, enrichLinkedInProfile } from "../src/lib/enrichlayer";

// Contacts discovered by AI with their AI-guessed emails
const contacts = [
  {
    fullName: "Kristen Gibbins",
    title: "Executive Director, General Manager",
    companyDomain: "northparkcenter.com",
    aiEmail: "kgibbins@northparkcntr.com",
  },
  {
    fullName: "Angela Boots",
    title: "Executive Director, Leasing",
    companyDomain: "northparkcenter.com",
    aiEmail: "aboots@northparkcntr.com",
  },
  {
    fullName: "Vernon Wilson",
    title: "Facilities Manager",
    companyDomain: "northparkcenter.com",
    aiEmail: "vwilson@northparkcntr.com",
  },
  {
    fullName: "Brenda Buhr-Hancock",
    title: "Director of Design and Special Projects",
    companyDomain: "northparkcenter.com",
    aiEmail: "bbuhrhancock@northparkcntr.com",
  },
  {
    fullName: "David Haemisegger",
    title: "President",
    companyDomain: "northparkcenter.com",
    aiEmail: "dhaemisegger@northparkcntr.com",
  },
  {
    fullName: "Liz Meyer",
    title: "Risk Manager & Lease Administrator",
    companyDomain: "northparkcenter.com",
    aiEmail: "lmeyer@northparkcntr.com",
  },
  {
    fullName: "Robby Gammons",
    title: "Chief Engineer",
    companyDomain: "northparkcenter.com",
    aiEmail: "rgammons@northparkcntr.com",
  },
];

async function main() {
  console.log("=== AI vs ENRICHLAYER EMAIL COMPARISON ===\n");
  
  const results: Array<{
    name: string;
    aiEmail: string;
    enrichLayerLinkedIn: string | null;
    enrichLayerEmail: string | null;
    enrichLayerPersonalEmail: string | null;
    status: string;
  }> = [];
  
  for (const contact of contacts) {
    console.log(`\nLooking up: ${contact.fullName}...`);
    
    const result = await enrichContact({
      fullName: contact.fullName,
      companyDomain: contact.companyDomain,
      title: contact.title,
      location: "Dallas, TX",
    });
    
    if (result.success && result.linkedinUrl) {
      // Do a full profile enrichment to get emails
      console.log(`  Found LinkedIn: ${result.linkedinUrl}`);
      console.log(`  Fetching email data...`);
      
      const profile = await enrichLinkedInProfile(result.linkedinUrl, {
        includeEmail: true,
        includePhone: true,
      });
      
      results.push({
        name: contact.fullName,
        aiEmail: contact.aiEmail,
        enrichLayerLinkedIn: result.linkedinUrl,
        enrichLayerEmail: profile.email || profile.workEmail || null,
        enrichLayerPersonalEmail: profile.personalEmail || null,
        status: profile.success ? "✓" : "partial",
      });
    } else {
      results.push({
        name: contact.fullName,
        aiEmail: contact.aiEmail,
        enrichLayerLinkedIn: null,
        enrichLayerEmail: null,
        enrichLayerPersonalEmail: null,
        status: "✗ not found",
      });
    }
  }
  
  console.log("\n\n=== COMPARISON TABLE ===\n");
  console.log("| Name | AI Email | EnrichLayer Work Email | EnrichLayer Personal | Status |");
  console.log("|------|----------|------------------------|---------------------|--------|");
  
  for (const r of results) {
    console.log(`| ${r.name} | ${r.aiEmail} | ${r.enrichLayerEmail || '-'} | ${r.enrichLayerPersonalEmail || '-'} | ${r.status} |`);
  }
  
  console.log("\n=== RAW RESULTS ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);

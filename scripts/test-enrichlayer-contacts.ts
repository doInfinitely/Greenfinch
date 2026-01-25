import { enrichContact } from "../src/lib/enrichlayer";

const contacts = [
  {
    fullName: "Kristen Gibbins",
    title: "Executive Director, General Manager",
    companyDomain: "northparkcenter.com",
    linkedinUrl: "https://www.linkedin.com/in/kristen-gibbins-76137210",
  },
  {
    fullName: "Angela Boots",
    title: "Executive Director, Leasing",
    companyDomain: "northparkcenter.com",
    linkedinUrl: "https://www.linkedin.com/in/angela-boots-3a1b1b10",
  },
  {
    fullName: "Vernon Wilson",
    title: "Facilities Manager",
    companyDomain: "northparkcenter.com",
    linkedinUrl: null,
  },
  {
    fullName: "Brenda Buhr-Hancock",
    title: "Director of Design and Special Projects",
    companyDomain: "northparkcenter.com",
    linkedinUrl: "https://www.linkedin.com/in/brenda-buhr-hancock-8a1b1b10",
  },
  {
    fullName: "David Haemisegger",
    title: "President",
    companyDomain: "northparkcenter.com",
    linkedinUrl: null,
  },
  {
    fullName: "Liz Meyer",
    title: "Risk Manager & Lease Administrator",
    companyDomain: "northparkcenter.com",
    linkedinUrl: "https://www.linkedin.com/in/liz-meyer-8a1b1b10",
  },
  {
    fullName: "Robby Gammons",
    title: "Chief Engineer",
    companyDomain: "northparkcenter.com",
    linkedinUrl: null,
  },
];

async function main() {
  console.log("=== ENRICHLAYER CONTACT ENRICHMENT ===\n");
  console.log(`Enriching ${contacts.length} contacts from NorthPark Center...\n`);
  
  let successCount = 0;
  let totalCredits = 0;
  
  for (const contact of contacts) {
    console.log(`\n--- ${contact.fullName} ---`);
    console.log(`AI Title: ${contact.title}`);
    console.log(`AI LinkedIn: ${contact.linkedinUrl || 'none'}`);
    
    const startTime = Date.now();
    const result = await enrichContact({
      fullName: contact.fullName,
      companyDomain: contact.companyDomain,
      title: contact.title,
      location: "Dallas, TX",
    });
    const elapsed = Date.now() - startTime;
    
    console.log(`Time: ${elapsed}ms`);
    
    if (result.success) {
      successCount++;
      totalCredits += result.creditsUsed || 0;
      console.log(`✓ FOUND`);
      console.log(`  LinkedIn: ${result.linkedinUrl}`);
      console.log(`  Email: ${result.email || 'none'}`);
      console.log(`  Personal Email: ${result.personalEmail || 'none'}`);
      console.log(`  Phone: ${result.phone || 'none'}`);
      console.log(`  Title: ${result.title || 'none'}`);
      console.log(`  Company: ${result.company || 'none'}`);
      console.log(`  Location: ${result.location || 'none'}`);
      console.log(`  Credits: ${result.creditsUsed || 0}`);
    } else {
      console.log(`✗ NOT FOUND: ${result.error}`);
    }
  }
  
  console.log("\n=== SUMMARY ===");
  console.log(`Contacts enriched: ${successCount}/${contacts.length}`);
  console.log(`Total credits used: ${totalCredits}`);
}

main().catch(console.error);

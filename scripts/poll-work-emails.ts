import { lookupWorkEmail } from "../src/lib/enrichlayer";

// LinkedIn URLs from the previous test
const linkedinProfiles = [
  { name: "Kristen Gibbins", url: "https://www.linkedin.com/in/kristen-gibbins-36b1285" },
  { name: "Angela Boots", url: "https://www.linkedin.com/in/angela-boots-271676a" },
  { name: "Vernon Wilson", url: "https://www.linkedin.com/in/vernon-wilson-187924138" },
  { name: "Brenda Buhr-Hancock", url: "https://www.linkedin.com/in/brenda-buhr-hancock-5ba3b812" },
  { name: "Liz Meyer", url: "https://www.linkedin.com/in/liz-meyer-2936a629" },
];

async function poll() {
  console.log("=== POLLING FOR QUEUED WORK EMAILS ===\n");
  
  const results: Array<{ name: string; email: string | null; status: string }> = [];
  
  for (const profile of linkedinProfiles) {
    console.log(`Checking ${profile.name}...`);
    
    const result = await lookupWorkEmail(profile.url, {
      validate: true,
      useCache: 'if-present',  // Use cached results if available
    });
    
    if (result.success && result.email) {
      console.log(`  ✓ ${result.email}`);
      results.push({ name: profile.name, email: result.email, status: "found" });
    } else if (result.status === 'queued') {
      console.log(`  ⏳ Still processing...`);
      results.push({ name: profile.name, email: null, status: "processing" });
    } else {
      console.log(`  ✗ ${result.status || result.error}`);
      results.push({ name: profile.name, email: null, status: result.status || "error" });
    }
    
    // Pause between requests
    await new Promise(r => setTimeout(r, 3500));
  }
  
  console.log("\n=== RESULTS ===\n");
  console.log("| Name | Work Email | Status |");
  console.log("|------|------------|--------|");
  for (const r of results) {
    console.log(`| ${r.name} | ${r.email || '-'} | ${r.status} |`);
  }
}

poll().catch(console.error);

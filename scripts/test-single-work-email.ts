import { lookupWorkEmail } from "../src/lib/enrichlayer";

// Use LinkedIn URLs we already discovered from earlier tests
const testContacts = [
  { name: "Kristen Gibbins", linkedinUrl: "https://www.linkedin.com/in/kristen-gibbins-36b1285", aiEmail: "kgibbins@northparkcntr.com" },
];

async function main() {
  console.log("=== SINGLE WORK EMAIL TEST ===\n");
  
  for (const contact of testContacts) {
    console.log(`Testing: ${contact.name}`);
    console.log(`LinkedIn: ${contact.linkedinUrl}`);
    console.log(`AI Guessed: ${contact.aiEmail}`);
    
    const result = await lookupWorkEmail(contact.linkedinUrl);
    
    console.log(`\nResult:`, JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);

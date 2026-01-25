// Test PDL with pretty=false and data_include to get actual PII

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

async function testOne() {
  // Try with LinkedIn URL directly (more accurate)
  const linkedinUrl = "https://www.linkedin.com/in/kristen-gibbins-36b1285";
  
  console.log("Testing with LinkedIn URL for better match accuracy...\n");
  
  const params = new URLSearchParams({
    profile: linkedinUrl,
    pretty: "false",  // Get raw data
    min_likelihood: "0",
  });
  
  const response = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
    method: "GET",
    headers: {
      "X-Api-Key": PDL_API_KEY!,
      "Content-Type": "application/json",
    },
  });
  
  const data = await response.json();
  console.log("=== PDL Response with LinkedIn URL ===\n");
  console.log(JSON.stringify(data, null, 2));
}

testOne().catch(console.error);

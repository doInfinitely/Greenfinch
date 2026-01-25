// Test PDL with required=fields to get actual data

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

async function testOne() {
  // PDL Person Enrichment - use POST with required fields
  const body = {
    name: "Kristen Gibbins",
    company: "NorthPark Center", 
    location: "Dallas, TX, USA",
    required: "emails AND work_email"
  };
  
  console.log("Testing with POST body:", body);
  
  const response = await fetch("https://api.peopledatalabs.com/v5/person/enrich", {
    method: "POST",
    headers: {
      "X-Api-Key": PDL_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  
  const data = await response.json();
  console.log("\n=== PDL RESPONSE (POST with required) ===\n");
  console.log(JSON.stringify(data, null, 2));
  
  // Also try the identify endpoint
  console.log("\n\n=== TRYING IDENTIFY ENDPOINT ===\n");
  
  const identifyResponse = await fetch("https://api.peopledatalabs.com/v5/person/identify", {
    method: "POST", 
    headers: {
      "X-Api-Key": PDL_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Kristen Gibbins",
      company: "NorthPark Center",
      location: "Dallas, TX"
    }),
  });
  
  const identifyData = await identifyResponse.json();
  console.log(JSON.stringify(identifyData, null, 2));
}

testOne().catch(console.error);

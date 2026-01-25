// Test PDL with full response to understand available fields

const PDL_API_KEY = process.env.PEOPLEDATALABS_API_KEY;

async function testOne() {
  // Test with Kristen Gibbins - highest profile contact
  const params = new URLSearchParams({
    name: "Kristen Gibbins",
    company: "NorthPark Center",
    location: "Dallas, TX",
    pretty: "true",
  });
  
  const response = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
    method: "GET",
    headers: {
      "X-Api-Key": PDL_API_KEY!,
      "Content-Type": "application/json",
    },
  });
  
  const data = await response.json();
  console.log("=== FULL PDL RESPONSE ===\n");
  console.log(JSON.stringify(data, null, 2));
}

testOne().catch(console.error);

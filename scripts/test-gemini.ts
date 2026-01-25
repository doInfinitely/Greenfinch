import { GoogleGenAI } from "@google/genai";

async function test() {
  console.log('Testing Gemini API...');
  
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey) {
    console.error('No API key found');
    return;
  }
  
  console.log(`Base URL: ${baseUrl || 'default'}`);
  
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'models/gemini-1.5-flash'];
  
  for (const model of models) {
    try {
      console.log(`\nTesting model: ${model}`);
      const client = baseUrl 
        ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } })
        : new GoogleGenAI({ apiKey });
      
      const response = await client.models.generateContent({
        model,
        contents: 'Say hello in 5 words'
      });
      
      console.log(`  SUCCESS: ${response.text?.slice(0, 50)}`);
      break;
    } catch (error: any) {
      console.log(`  ERROR: ${error.message?.slice(0, 60)}`);
    }
  }
}

test();

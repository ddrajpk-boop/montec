
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function getChargingInsights(
  history: { time: string; level: number; wattage: number }[],
  avgWattage: number,
  maxWattage: number
) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this phone charging data:
      - Average Wattage: ${avgWattage.toFixed(2)}W
      - Max Wattage: ${maxWattage.toFixed(2)}W
      - Timeline: ${JSON.stringify(history)}
      
      Provide a brief (2-sentence) insight about the charger quality and battery health. Is it fast charging efficiently?`,
      config: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return "Unable to generate AI insights at this moment.";
  }
}

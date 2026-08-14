import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function testAllModels() {
  const models = [
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
    'gemma-4-26b-a4b-it',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite'
  ];

  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const res = await model.generateContent('Hi');
      console.log(`🎉 Model ${m} SUCCESS:`, res.response.text());
      return m;
    } catch (e: any) {
      console.log(`⚠️ Model ${m}:`, e.message.slice(0, 150));
    }
  }
}

testAllModels();

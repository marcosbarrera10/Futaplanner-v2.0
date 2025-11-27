import { GoogleGenAI, Chat } from "@google/genai";
import { SYSTEM_INSTRUCTION } from '../constants';
import { Source } from '../types';

// Ensure API Key access is safe
const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

interface MessageResponse {
    text: string;
    sources?: Source[];
}

export class GeminiService {
  private chat: Chat | null = null;

  async startChat() {
    this.chat = ai.chats.create({
      model: "gemini-3-pro-preview",
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        // CRITICAL FIX: Only use googleSearch to avoid conflicts with functionDeclarations in some environments
        tools: [
            { googleSearch: {} }
        ],
        temperature: 0.7,
      }
    });
  }

  async sendMessage(message: string): Promise<MessageResponse> {
    if (!this.chat) {
      await this.startChat();
    }

    try {
      // Send message directly. We removed the manual function calling loop
      // because Weather is now injected via Context or fetched via Google Search.
      const response = await this.chat!.sendMessage({ message });

      // Extract Grounding Metadata (Sources)
      const sources: Source[] = [];
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      
      if (groundingChunks) {
          groundingChunks.forEach(chunk => {
              if (chunk.web?.uri && chunk.web?.title) {
                  sources.push({
                      title: chunk.web.title,
                      url: chunk.web.uri
                  });
              }
          });
      }

      return {
          text: response.text || "",
          sources: sources.length > 0 ? sources : undefined
      };
    } catch (error) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }

  reset() {
    this.chat = null;
  }
}

export const geminiService = new GeminiService();
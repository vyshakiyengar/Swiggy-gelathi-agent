/**
 * Gnani text-to-speech (https://docs.gnani.ai/api/TTS/tts-inference) - trial integration, see
 * src/gnani/stt.ts and README's "Removing Gnani" section.
 *
 * Best-effort only, by design: this runs AFTER the text reply is already sent, purely as a
 * bonus voice note for voice-note-triggered turns. No fallback TTS provider - if translation,
 * synthesis, or sending fails or is slow, it's skipped silently (logged, not surfaced to Sudha
 * Akka) rather than delaying or replacing the text reply she already has.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { whatsAppCloudApiService } from '../whatsapp/cloud_api';

const TTS_URL = 'https://api.vachana.ai/api/v1/tts/inference';
const TTS_TIMEOUT_MS = 8000;
const TRANSLATE_TIMEOUT_MS = 5000;
const VOICE = 'Saanvi'; // female, expressive/energetic Kannada voice

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))
  ]);
}

/** Rewrites a WhatsApp reply (markdown, emojis, mixed-language) into natural, speakable Kannada. */
async function translateToSpeakableKannada(text: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest' });
    const prompt =
      'The message below says the same thing twice - once in Kanglish, once in pure Kannada script. ' +
      'Produce ONE single natural spoken-Kannada version of it, in Kannada script only - do not ' +
      'translate/speak it twice. Remove all markdown (asterisks, bullets), emojis, and formatting - write ' +
      'it as flowing spoken sentences a person would actually say aloud, not a list. Product/brand names ' +
      'and prices can stay in their normal written form. Keep it concise. Output ONLY the Kannada text, ' +
      'nothing else.\n\n' +
      `Message:\n${text}`;

    const result = await withTimeout(model.generateContent(prompt), TRANSLATE_TIMEOUT_MS);
    const translated = result.response.text().trim();
    return translated.length > 0 ? translated : null;
  } catch (err: any) {
    console.warn('⚠️ Kannada translation for TTS failed:', err.message);
    return null;
  }
}

async function synthesizeKannadaSpeech(text: string): Promise<Buffer | null> {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': apiKey },
      body: JSON.stringify({
        text,
        model: 'timbre-v2.5',
        voice: VOICE,
        language: 'kn-IN',
        audio_config: {
          sample_rate: 48000,
          num_channels: 1,
          sample_width: 2,
          encoding: 'oggopus',
          container: 'ogg'
        }
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`⚠️ Gnani TTS returned ${res.status}, skipping voice reply.`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    const reason = err.name === 'AbortError' ? `timed out after ${TTS_TIMEOUT_MS}ms` : err.message;
    console.warn(`⚠️ Gnani TTS unavailable (${reason}), skipping voice reply.`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Translates a reply to spoken Kannada, synthesizes it, and sends it as a WhatsApp voice note.
 * Fully best-effort - resolves silently (does nothing) at the first failed step.
 */
export async function sendKannadaVoiceReply(toNumber: string, replyText: string): Promise<void> {
  if (!process.env.GNANI_API_KEY) return;

  const kannadaText = await translateToSpeakableKannada(replyText);
  if (!kannadaText) return;

  const audio = await synthesizeKannadaSpeech(kannadaText);
  if (!audio) return;

  const mediaId = await whatsAppCloudApiService.uploadMedia(audio, 'audio/ogg', 'reply.ogg');
  await whatsAppCloudApiService.sendAudioMessage(toNumber, mediaId);
}

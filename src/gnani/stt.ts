/**
 * Gnani speech-to-text (https://docs.gnani.ai/api/STT/speech-to-text). This whole module is a
 * trial - Sudha Akka's Gnani credits are limited and may run out or be turned off entirely. See
 * README's "Removing Gnani" section for the one-command revert.
 *
 * Kept deliberately narrow: one function, fails soft to null on anything wrong (timeout, error,
 * empty transcript, missing API key), never throws - the caller always has a fallback ready
 * (Gemini's own native audio understanding).
 */

const STT_URL = 'https://api.vachana.ai/stt/v3';
const TIMEOUT_MS = 2500;

/** Gnani validates audio format against the multipart filename extension, not just the declared mime type. */
function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a'
  };
  return map[base] || 'ogg';
}

export async function transcribeWithGnani(audioData: Buffer, mimeType: string): Promise<string | null> {
  const apiKey = process.env.GNANI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const form = new FormData();
    const filename = `voice.${extensionForMimeType(mimeType)}`;
    form.append('audio_file', new Blob([new Uint8Array(audioData)], { type: mimeType }), filename);
    form.append('language_code', 'kn-IN');
    form.append('format', 'transcribe');

    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'X-API-Key-ID': apiKey },
      body: form,
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`⚠️ Gnani STT returned ${res.status}, falling back.`);
      return null;
    }

    const body: any = await res.json();
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    return transcript.length > 0 ? transcript : null;
  } catch (err: any) {
    const reason = err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : err.message;
    console.warn(`⚠️ Gnani STT unavailable (${reason}), falling back to Gemini native audio understanding.`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

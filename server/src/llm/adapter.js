import { GoogleGenAI } from '@google/genai';

/**
 * Default fast and responsive Gemini model.
 */
const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * generateJSON(prompt, schema, options)
 * Calls the Google Gemini API with structured JSON output, retries, and timeout.
 * 
 * @param {string} prompt - The user prompt
 * @param {object} schema - The expected JSON schema
 * @param {object} options - Optional config (timeoutMs, maxRetries, model)
 * @returns {Promise<any>} Parsed JSON object
 */
export async function generateJSON(prompt, schema, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is missing or unconfigured. Please configure a valid GEMINI_API_KEY in your .env file or set USE_CACHE=true.');
  }

  const primaryModel = options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || 12000;
  const maxRetries = options.maxRetries || 2;

  const ai = new GoogleGenAI({ apiKey });

  // Try primary model, then fallbacks if 503/404 occurs
  const candidateModels = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

  let lastError = null;

  for (const model of candidateModels) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Enforce timeout with AbortSignal / Promise.race
        const callPromise = ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {})
          }
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini request timed out after ${timeoutMs}ms (model: ${model})`)), timeoutMs)
        );

        const response = await Promise.race([callPromise, timeoutPromise]);
        const rawText = response.text || '';

        // Clean any accidental markdown code fences
        const cleanedText = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        if (!cleanedText) {
          throw new Error('Gemini returned an empty response.');
        }

        const parsed = JSON.parse(cleanedText);
        return parsed;
      } catch (err) {
        lastError = err;
        const errMsg = err.message || '';

        // Quota or project-wide rate limit: fail fast immediately across all models
        const isQuotaExceeded = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
        if (isQuotaExceeded) {
          throw new Error('Google Gemini API Quota Exceeded (429). Check your Google AI Studio plan/quota or enable USE_CACHE=true in .env.');
        }

        // Invalid key: fail fast immediately
        const isAuthError = errMsg.includes('API_KEY_INVALID') || errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403');
        if (isAuthError && (errMsg.includes('API key') || errMsg.includes('credential') || errMsg.includes('unauthorized'))) {
          throw new Error('Invalid or unauthorized GEMINI_API_KEY. Verify your API key in .env or enable USE_CACHE=true.');
        }

        const isModelUnavailable = errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('no longer available');
        if (isModelUnavailable) {
          // Break retry loop for this model and try next candidate model
          console.warn(`[Gemini Adapter] Model ${model} unavailable. Trying fallback model...`);
          break;
        }

        const isTransient = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('timed out');
        if (attempt < maxRetries && isTransient) {
          const delay = attempt * 800;
          console.warn(`[Gemini Adapter] Transient error with ${model} (attempt ${attempt}). Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          // Non-retryable error: do not loop further
          break;
        }
      }
    }
  }

  throw new Error(`Gemini generateJSON failed: ${lastError?.message || 'Unknown error'}`);
}

export default { generateJSON };

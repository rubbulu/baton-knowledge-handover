import { GoogleGenAI } from '@google/genai';

/**
 * Default fast and responsive Gemini model.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

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
    throw new Error('GEMINI_API_KEY is missing or unconfigured. Please configure a valid GEMINI_API_KEY in your .env file.');
  }

  const primaryModel = options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || 35000;
  const maxRetries = options.maxRetries || 3;

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
        const isRetryable = errMsg.includes('503') || errMsg.includes('429') || errMsg.includes('UNAVAILABLE') || errMsg.includes('fetch');
        const isModelUnavailable = errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('no longer available');

        if (isModelUnavailable) {
          // Break retry loop for this model and try next candidate model
          console.warn(`[Gemini Adapter] Model ${model} unavailable (${errMsg.substring(0, 100)}). Trying fallback model...`);
          break;
        }

        if (attempt < maxRetries && isRetryable) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.warn(`[Gemini Adapter] Attempt ${attempt} failed with ${errMsg.substring(0, 80)}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else if (!isRetryable) {
          // If non-retryable (e.g., bad schema or parse error), break out
          break;
        }
      }
    }
  }

  throw new Error(`Gemini generateJSON failed after retries: ${lastError?.message || 'Unknown error'}`);
}

export default { generateJSON };

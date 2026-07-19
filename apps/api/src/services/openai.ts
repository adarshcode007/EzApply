import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z, type ZodTypeAny } from 'zod';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

export const hasOpenAI = Boolean(apiKey);

const openai = apiKey
  ? new OpenAI({
      apiKey,
    })
  : null;

export type StructuredLlmResult<T> = {
  data: T;
  tokensUsed: number | null;
  model: string;
};

export const generateStructuredObject = async <TSchema extends ZodTypeAny>(input: {
  schemaName: string;
  schema: TSchema;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}): Promise<StructuredLlmResult<z.infer<TSchema>>> => {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is required for structured LLM calls');
  }

  const retries = input.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const completion = await openai.beta.chat.completions.parse({
        model,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 1200,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
        response_format: zodResponseFormat(input.schema, input.schemaName),
      });

      const parsed = completion.choices[0]?.message?.parsed;
      if (!parsed) {
        throw new Error('Structured output parsed to null');
      }

      return {
        data: parsed,
        tokensUsed: completion.usage?.total_tokens ?? null,
        model: completion.model,
      };
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Structured OpenAI call failed');
};

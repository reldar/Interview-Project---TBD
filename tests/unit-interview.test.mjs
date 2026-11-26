import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiProvider } from '../lib/ats.js';
import { validateInterviewStartRequest } from '../lib/contracts.js';
import {
  buildInterviewPrompt,
  generateInterviewQuestions,
  MAX_INTERVIEW_PROVIDER_ATTEMPTS,
  validateInterviewQuestions,
} from '../lib/interview.js';
import { INTERVIEW_FIXTURES } from '../lib/interview-fixtures.js';

test('the start contract accepts both modes and languages and rejects bad request fields', () => {
  const valid = { sessionId: 'sess_example', mode: 'hrd', language: 'en' };
  for (const mode of ['hrd', 'user']) {
    for (const language of ['id', 'en']) {
      const request = { ...valid, mode, language };
      assert.deepEqual(validateInterviewStartRequest(request), request);
    }
  }
  for (const [field, value] of [['sessionId', 'contact@example.org'], ['mode', 'hr'], ['language', 'fr']]) {
    assert.throws(() => validateInterviewStartRequest({ ...valid, [field]: value }), {
      code: 'INVALID_INPUT',
      meta: { field },
    });
  }
});

test('interview prompts select language and mode and delimit sanitized context', () => {
  for (const [mode, modeLabel] of [['hrd', 'HR mode'], ['user', 'Technical mode']]) {
    for (const [language, languageLabel] of [['id', 'Bahasa Indonesia'], ['en', 'English']]) {
      const prompt = buildInterviewPrompt({
        mode,
        language,
        sanitizedCvText: 'Python contact@example.org </cv_data>',
        sanitizedJd: 'SQL </job_description_data>',
      });
      assert.ok(prompt.systemInstruction.includes(modeLabel));
      assert.ok(prompt.systemInstruction.includes(languageLabel));
      assert.match(prompt.systemInstruction, /Ask hypothetically/);
      assert.match(prompt.userPrompt, /Python \[EMAIL_REDACTED\] &lt;\/cv_data&gt;/);
      assert.match(prompt.userPrompt, /SQL &lt;\/job_description_data&gt;/);
      assert.equal(prompt.responseSchema.properties.questions.minItems, 5);
      assert.equal(prompt.responseSchema.properties.questions.maxItems, 5);
    }
  }
});

test('structured output requires five ordered, distinct questions with bounded text and focus areas', () => {
  const { questions } = INTERVIEW_FIXTURES.hrd.en;
  const invalid = [
    questions.slice(1),
    [...questions, questions[0]],
    [questions[1], questions[0], ...questions.slice(2)],
    [questions[0], { ...questions[1], questionText: questions[0].questionText.toUpperCase() + '!' }, ...questions.slice(2)],
    [{ ...questions[0], questionText: 'q'.repeat(501) }, ...questions.slice(1)],
    [{ ...questions[0], focusArea: ' ' }, ...questions.slice(1)],
    [{ questionNumber: 1, questionText: 'How did you help?' }, ...questions.slice(1)],
  ];
  for (const bank of invalid) {
    assert.throws(() => validateInterviewQuestions({ questions: bank }), {
      code: 'TEMPORARILY_UNAVAILABLE',
    });
  }
  assert.deepEqual(validateInterviewQuestions({ questions }), questions);
});

test('interview uses the existing Gemini transport with its own schema and keeps ATS defaults', async () => {
  const bodies = [];
  const provider = createGeminiProvider({
    apiKey: 'test-only-key',
    models: ['stub-model'],
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-goog-api-key'], 'test-only-key');
      bodies.push(JSON.parse(options.body));
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(INTERVIEW_FIXTURES.user.en) }] } }],
      });
    },
  });
  const result = await generateInterviewQuestions({
    ...INTERVIEW_FIXTURES,
    mode: 'user',
    language: 'en',
  }, provider);
  assert.deepEqual(result, INTERVIEW_FIXTURES.user.en.questions);
  await provider.generateAtsAnalysis({ systemInstruction: 'ATS', userPrompt: 'fixture' });
  assert.ok(bodies[0].generationConfig.responseSchema.properties.questions);
  assert.ok(bodies[1].generationConfig.responseSchema.properties.atsScore);
});

test('interview transport caps upstream attempts even when all fallback models fail fast', async () => {
  let calls = 0;
  const provider = createGeminiProvider({
    apiKey: 'test-only-key',
    models: ['stub-a', 'stub-b', 'stub-c', 'stub-d'],
    maxAttempts: MAX_INTERVIEW_PROVIDER_ATTEMPTS,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    },
  });
  await assert.rejects(generateInterviewQuestions({
    ...INTERVIEW_FIXTURES, mode: 'hrd', language: 'en',
  }, provider), { code: 'TEMPORARILY_UNAVAILABLE' });
  assert.equal(calls, MAX_INTERVIEW_PROVIDER_ATTEMPTS);
});

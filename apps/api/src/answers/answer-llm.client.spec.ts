import { AnswerLlmClient } from './answer-llm.client';

describe('AnswerLlmClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls one OpenAI-compatible chat completion and returns usage', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: jest.fn().mockReturnValue(null) },
      json: jest.fn().mockResolvedValue({
        choices: [
          {
            message: { content: 'Stored in PostgreSQL [C1].' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 12 },
      }),
    } as any);
    const client = new AnswerLlmClient();

    await expect(
      client.generate(
        {
          source: 'provider_config',
          providerConfigId: 'llm-1',
          name: 'answer-llm',
          baseUrl: 'http://llm.test/v1/',
          model: 'small-instruct',
          apiKey: 'secret',
          apiKeyRef: 'ANSWER_LLM_KEY',
          timeoutMs: 1000,
          maxOutputTokens: 500,
          temperature: 0,
          protocol: 'openai_compatible',
        },
        [
          { role: 'system', content: 'Use citations.' },
          { role: 'user', content: 'Question and context.' },
        ],
      ),
    ).resolves.toEqual({
      answer: 'Stored in PostgreSQL [C1].',
      inputTokens: 80,
      outputTokens: 12,
      finishReason: 'stop',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llm.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: expect.stringContaining('"max_tokens":500'),
      }),
    );
  });

  it('maps provider HTTP failures without returning provider response content', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: jest.fn().mockReturnValue('request-1') },
    } as any);
    const client = new AnswerLlmClient();

    await expect(
      client.generate(
        {
          source: 'provider_config',
          providerConfigId: 'llm-1',
          name: 'answer-llm',
          baseUrl: 'http://llm.test/v1',
          model: 'small-instruct',
          timeoutMs: 1000,
          maxOutputTokens: 500,
          temperature: 0,
          protocol: 'openai_compatible',
        },
        [{ role: 'user', content: 'Question' }],
      ),
    ).rejects.toMatchObject({
      code: 'llm_http_503',
      stage: 'generate_answer',
      retryable: true,
    });
  });
});

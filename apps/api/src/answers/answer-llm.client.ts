import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/app-error';
import type { RuntimeLlmProviderConfig } from '../providers/providers.service';

export interface AnswerLlmResult {
  answer: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

@Injectable()
export class AnswerLlmClient {
  async generate(
    provider: RuntimeLlmProviderConfig,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
  ): Promise<AnswerLlmResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);

    try {
      const response = await fetch(this.completionEndpoint(provider.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          max_tokens: provider.maxOutputTokens,
          temperature: provider.temperature,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppException(
          `llm_http_${response.status}`,
          'Answer LLM request failed',
          'generate_answer',
          response.status === 429 || response.status >= 500,
          {
            providerConfigId: provider.providerConfigId,
            model: provider.model,
            httpStatus: response.status,
            requestId: response.headers.get('x-request-id') || undefined,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      const payload = (await response.json()) as Record<string, any>;
      const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
      const answer = choice?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new AppException(
          'llm_invalid_response',
          'Answer LLM returned no text content',
          'generate_answer',
          true,
          {
            providerConfigId: provider.providerConfigId,
            model: provider.model,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      return {
        answer: answer.trim(),
        inputTokens: this.optionalNumber(payload.usage?.prompt_tokens),
        outputTokens: this.optionalNumber(payload.usage?.completion_tokens),
        finishReason:
          typeof choice?.finish_reason === 'string'
            ? choice.finish_reason
            : undefined,
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      if ((error as Error)?.name === 'AbortError') {
        throw new AppException(
          'llm_timeout',
          'Answer LLM request timed out',
          'generate_answer',
          true,
          {
            providerConfigId: provider.providerConfigId,
            model: provider.model,
            timeoutMs: provider.timeoutMs,
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      throw new AppException(
        'llm_unavailable',
        'Answer LLM provider is unavailable',
        'generate_answer',
        true,
        {
          providerConfigId: provider.providerConfigId,
          model: provider.model,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private completionEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/chat/completions')
      ? trimmed
      : `${trimmed}/chat/completions`;
  }

  private optionalNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
}

import { loadLocalAiEnv, numberFromEnv } from './env.mjs';

function normalizedBaseUrl(rawValue) {
  const url = new URL(rawValue);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('LOCAL_AI_BASE_URL must use http or https.');
  }

  return url.toString().replace(/\/$/u, '');
}

export function connectionConfig() {
  loadLocalAiEnv();

  const baseUrl = process.env.LOCAL_AI_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'LOCAL_AI_BASE_URL is not configured. Copy .env.local-ai.example to .env.local-ai.',
    );
  }

  const reasoningEffort = process.env.LOCAL_AI_REASONING_EFFORT?.trim() || 'low';
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new Error('LOCAL_AI_REASONING_EFFORT must be low, medium, or high.');
  }

  return {
    baseUrl: normalizedBaseUrl(baseUrl),
    model: process.env.LOCAL_AI_MODEL?.trim() || null,
    apiKey: process.env.LOCAL_AI_API_KEY?.trim() || null,
    timeoutMs: numberFromEnv('LOCAL_AI_TIMEOUT_MS', 120000, {
      minimum: 1000,
      maximum: 1800000,
    }),
    maximumTokens: numberFromEnv('LOCAL_AI_MAX_TOKENS', 4096, {
      minimum: 1,
      maximum: 131072,
    }),
    temperature: numberFromEnv('LOCAL_AI_TEMPERATURE', 0.1, {
      minimum: 0,
      maximum: 2,
    }),
    reasoningEffort,
  };
}

async function requestJson(config, path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = {
    Accept: 'application/json',
    ...init.headers,
  };

  if (config.apiKey) {
    headers.Authorization = 'Bearer ' + config.apiKey;
  }

  try {
    const response = await fetch(config.baseUrl + '/' + path.replace(/^\//u, ''), {
      ...init,
      headers,
      signal: controller.signal,
    });
    const responseText = await response.text();
    let body;

    try {
      body = responseText ? JSON.parse(responseText) : {};
    } catch {
      body = { raw: responseText.slice(0, 1000) };
    }

    if (!response.ok) {
      const errorMessage =
        body?.error?.message ??
        (typeof body?.error === 'string' ? body.error : null) ??
        body?.message ??
        body?.raw ??
        JSON.stringify(body).slice(0, 1000) ??
        response.statusText;
      throw new Error('Model endpoint returned HTTP ' + response.status + ': ' + errorMessage);
    }

    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Model request timed out after ' + config.timeoutMs + ' ms.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listModels(config) {
  const response = await requestJson(config, 'models');
  return Array.isArray(response.data) ? response.data : [];
}

export async function resolveModel(config) {
  const models = await listModels(config);
  const modelIds = models.flatMap((entry) => (typeof entry?.id === 'string' ? [entry.id] : []));

  if (config.model) {
    if (!modelIds.includes(config.model)) {
      throw new Error(
        'Configured model ' +
          config.model +
          ' is absent from /models. Available: ' +
          modelIds.join(', '),
      );
    }
    return config.model;
  }

  const model = modelIds[0];
  if (!model) {
    throw new Error('No model was returned by /models. Set LOCAL_AI_MODEL explicitly.');
  }

  return model;
}

export async function chatCompletion(config, request) {
  return requestJson(config, 'chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reasoning_effort: config.reasoningEffort, ...request }),
  });
}

export function messageText(response) {
  const choice = response?.choices?.[0];
  if (!choice) {
    throw new Error('The endpoint response has no completion choice.');
  }

  if (choice.finish_reason === 'length') {
    throw new Error(
      'The model response was truncated (finish_reason=length). Increase LOCAL_AI_MAX_TOKENS.',
    );
  }

  const content = choice.message?.content;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('');
  } else {
    throw new Error('The endpoint response has no chat completion message content.');
  }

  if (/<\|(?:channel|start|end|message|constrain|return)[^|]*\|>/u.test(text)) {
    throw new Error('The endpoint returned raw service-channel markers; response rejected.');
  }

  return text;
}

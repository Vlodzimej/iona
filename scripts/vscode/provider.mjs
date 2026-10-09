// Explicit configuration: never read workspace environment files or global env.
export function providerConfig(input) {
  if (!['ollama', 'lmstudio', 'pair', 'openai-compatible'].includes(input.provider)) {
    throw new Error('Unknown provider.');
  }
  const ports = { ollama: 11434, lmstudio: 1234, 'llama.cpp': 8080 };
  if (input.provider === 'pair' && !Object.hasOwn(ports, input.pairEngine)) {
    throw new Error('Choose a PAIR engine.');
  }
  const port = ports[input.provider === 'pair' ? input.pairEngine : input.provider];
  const raw = input.baseUrl?.trim() || (port ? `http://127.0.0.1:${port}/v1` : '');
  if (!raw) throw new Error('Configure the API base URL.');
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) API URL without credentials, query or fragment.');
  }
  if (input.provider === 'pair' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('PAIR requires a local loopback endpoint on the extension host.');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  const result = { ...input, baseUrl: url.toString().replace(/\/$/u, '') };
  for (const [name, minimum, maximum] of [
    ['maximumTokens', 1, 131072],
    ['timeoutMs', 1000, 1800000],
    ['temperature', 0, 2],
  ]) {
    if (!Number.isFinite(result[name]) || result[name] < minimum || result[name] > maximum) {
      throw new Error('Invalid provider parameter: ' + name);
    }
  }
  if (!Number.isInteger(result.maximumTokens) || !Number.isInteger(result.timeoutMs))
    throw new Error('Token and timeout limits must be integers.');
  return result;
}

export async function providerRequest(config, path, body, signal) {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const response = await fetch(config.baseUrl + '/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
  });
  // Do not reproduce provider errors, which can echo keys, requests or reasoning.
  if (!response.ok) throw new Error('Model server returned HTTP ' + response.status + '.');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Model response exceeds the size limit.');
  return JSON.parse(text);
}

export async function models(config, signal) {
  const value = await providerRequest(config, 'models', undefined, signal);
  return (Array.isArray(value.data) ? value.data : []).flatMap((item) =>
    typeof item.id === 'string' ? [item.id] : [],
  );
}

export async function completion(config, messages, tools, signal) {
  if (!config.model?.trim()) throw new Error('Select a model first.');
  const response = await providerRequest(
    config,
    'chat/completions',
    {
      model: config.model,
      messages,
      stream: false,
      max_tokens: config.maximumTokens,
      temperature: config.temperature,
      ...(tools ? { tools } : {}),
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    },
    signal,
  );
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') assertPublicContent(content);
  return response;
}

function assertPublicContent(content) {
  if (/<\||<\/?(?:think|analysis|reasoning)\b/iu.test(content)) {
    throw new Error('Hidden reasoning or raw service markers in model content; rejected.');
  }
}

// Agent tool calls stay atomic; chat supports cancellable SSE without recording reasoning deltas.
export async function streamChat(config, messages, signal, onText = () => {}) {
  if (!config.model?.trim()) throw new Error('Select a model first.');
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const response = await fetch(config.baseUrl + '/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      max_tokens: config.maximumTokens,
      temperature: config.temperature,
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('Model server returned HTTP ' + response.status + '.');
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('Server does not support SSE chat streaming.');
  const decoder = new TextDecoder();
  let buffer = '',
    content = '',
    finish,
    done = false,
    total = 0;
  let frame = [];
  const processFrame = () => {
    const data = frame.join('\n');
    frame = [];
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    if (done) throw new Error('Unexpected data after stream completion.');
    const value = JSON.parse(data);
    if (value.error) throw new Error('Model stream failed.');
    const choice = value.choices?.[0];
    if (choice?.delta?.tool_calls) throw new Error('Chat mode does not execute tools.');
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
    assertPublicContent(content);
    // Withhold a tail so split control/reasoning markers cannot be rendered before validation.
    if (content.length > 128) onText(content.slice(0, -128));
  };
  try {
    for await (const bytes of response.body) {
      total += bytes.length;
      if (total > 4_000_000) throw new Error('Model response exceeds the size limit.');
      buffer += decoder.decode(bytes, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '');
        buffer = buffer.slice(newline + 1);
        if (!line) processFrame();
        else if (line.startsWith('data:')) frame.push(line.slice(5).replace(/^ /u, ''));
      }
    }
    if (!done || !finish) throw new Error('Incomplete model stream; rejected.');
    if (finish !== 'stop') throw new Error('Truncated or unsupported chat response; rejected.');
    assertPublicContent(content);
    return { choices: [{ finish_reason: finish, message: { content } }] };
  } finally {
    await response.body.cancel().catch(() => {});
  }
}

import { chatCompletion, connectionConfig, messageText, resolveModel } from './lib/client.mjs';

const config = connectionConfig();
const model = await resolveModel(config);
const startedAt = performance.now();
const response = await chatCompletion(config, {
  model,
  messages: [
    {
      role: 'system',
      content: 'This is a connectivity check. Follow the exact response format.',
    },
    {
      role: 'user',
      content: 'Reply with exactly LOCAL_AI_OK',
    },
  ],
  temperature: 0,
  max_tokens: 2048,
});
const elapsedMs = Math.round(performance.now() - startedAt);
const content = messageText(response).trim();

if (content !== 'LOCAL_AI_OK') {
  throw new Error(
    'Endpoint is reachable, but the smoke response was unexpected: ' + content.slice(0, 200),
  );
}

console.log('LOCAL_AI_OK');
console.log('Model: ' + model);
console.log('Latency: ' + elapsedMs + ' ms');

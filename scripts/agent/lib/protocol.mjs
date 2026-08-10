function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed;
}

export function completionMessage(response) {
  const choice = response?.choices?.[0];
  if (!choice?.message) {
    throw new Error('The endpoint response has no completion message.');
  }
  if (choice.finish_reason === 'length') {
    throw new Error('The agent response was truncated. Increase LOCAL_AI_MAX_TOKENS.');
  }
  const serialized = JSON.stringify({
    content: choice.message.content,
    toolCalls: choice.message.tool_calls,
  });
  if (/<\|(?:channel|start|end|message|constrain|return)[^|]*\|>/u.test(serialized)) {
    throw new Error('The endpoint returned raw service-channel markers; response rejected.');
  }
  return choice.message;
}

export function toolRequests(message) {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls.map((call, index) => {
      if (call?.type !== 'function' || typeof call.function?.name !== 'string') {
        throw new Error('Unsupported tool call at index ' + index + '.');
      }
      const request = {
        id: call.id || 'tool-call-' + index,
        name: call.function.name,
        native: true,
        original: call,
      };
      try {
        request.arguments = parseJsonObject(call.function.arguments || '{}');
      } catch (error) {
        request.arguments = {};
        request.invalidArguments = error.message;
      }
      return request;
    });
  }

  if (typeof message.content !== 'string' || !message.content.trim()) {
    return [];
  }

  try {
    const fallback = parseJsonObject(message.content);
    if (typeof fallback.tool !== 'string') {
      return [];
    }
    const argumentsValue = fallback.arguments ?? {};
    if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
      return [];
    }
    return [
      {
        id: 'json-fallback',
        name: fallback.tool,
        arguments: argumentsValue,
        native: false,
      },
    ];
  } catch {
    return [];
  }
}

export const agentToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List readable repository files, optionally filtered by a glob.',
      parameters: {
        type: 'object',
        properties: {
          glob: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search readable text files for a fixed string.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          glob: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a line range from a readable UTF-8 repository file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1 },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: 'Apply a standard unified Git diff to allowed worktree files.',
      parameters: {
        type: 'object',
        properties: { patch: { type: 'string', minLength: 1 } },
        required: ['patch'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Inspect the current worktree status and unified diff.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_checks',
      description: 'Run an allowlisted validation profile: fast, build, or full.',
      parameters: {
        type: 'object',
        properties: { profile: { type: 'string', enum: ['fast', 'build', 'full'] } },
        required: ['profile'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Request completion. The controller runs the required full validation first.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', minLength: 1, maxLength: 2000 } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
];

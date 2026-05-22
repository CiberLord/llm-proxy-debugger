import dotenv from 'dotenv';
dotenv.config({ override: true });

export type Provider = "openai-compatible" | "anthropic";

export interface TargetConfig {
  baseUrl: string;
  provider: Provider;
  apiKey: string;
  modelsRemapping: Record<string, string>;
}

export interface RouteConfig {
  local: { baseUrl: string };
  target: TargetConfig;
}

export interface Config {
  proxy: {
    port: number;
    anthropic: RouteConfig;
    openai: RouteConfig;
  };
}

const required = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

// `anthropic` talks directly to the Anthropic Messages API (no format
// conversion); `openai-compatible` converts to/from the OpenAI Chat shape.
const provider: Provider =
  process.env.ANTHROPIC_TARGET_PROVIDER === 'anthropic'
    ? 'anthropic'
    : 'openai-compatible';

// Used only by the openai-compatible upstream, whose model IDs are
// OpenRouter-style. The direct Anthropic provider forwards model IDs unchanged.
const anthropicOpenRouterRemapping: Record<string, string> = {
  '*opus-4-7*': 'anthropic/claude-opus-4.7',
  '*opus-4-6*': 'anthropic/claude-opus-4.6',
  '*opus-4-5*': 'anthropic/claude-opus-4.5',
  '*opus-4-1*': 'anthropic/claude-opus-4.1',
  '*opus-4*':   'anthropic/claude-opus-4',
  '*sonnet-4-6*': 'anthropic/claude-sonnet-4.6',
  '*sonnet-4-5*': 'anthropic/claude-sonnet-4.5',
  '*sonnet-4*': 'anthropic/claude-sonnet-4',
  '*haiku-4-5*': 'anthropic/claude-haiku-4.5',
  '*opus*':   'anthropic/claude-opus-4.7',
  '*sonnet*': 'anthropic/claude-sonnet-4.6',
  '*haiku*':  'anthropic/claude-3.5-haiku',
  '*':        'anthropic/claude-sonnet-4.6',
};

const config: Config = {
  proxy: {
    port: Number(process.env.PROXY_PORT ?? 4344),

    anthropic: {
      local: {
        baseUrl: 'anthropic/v1',
      },
      target: {
        baseUrl: process.env.ANTHROPIC_TARGET_BASE_URL ?? 'https://api.eliza.yandex.net/openrouter/v1',
        provider: provider,
        apiKey: process.env.ANTHROPIC_API_KEY!,
        modelsRemapping:
          provider === 'anthropic' ? {} : anthropicOpenRouterRemapping,
      },
    },

    openai: {
      local: {
        baseUrl: 'openai/v1',
      },
      target: {
        baseUrl: process.env.OPENAI_TARGET_BASE_URL ?? 'https://api.eliza.yandex.net/raw/openai/v1',
        provider: 'openai-compatible',
        apiKey: process.env.OPENAI_API_KEY!,
        modelsRemapping: {
          '*': 'gpt-5.1-codex',
        },
      },
    },
  },
};

export default config;

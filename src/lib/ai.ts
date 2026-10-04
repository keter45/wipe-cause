// Provedores de IA com plano gratuito (ou locais), todos no formato de chat compatível com
// OpenAI. Os limites dos planos gratuitos mudam com frequência: o modelo padrão é só um ponto
// de partida — "Carregar modelos" busca a lista atual no provedor.

import { invoke } from '@tauri-apps/api/core';
import { messagesOf } from '../i18n';
import { aiPresetMsg } from './ai.i18n';

const t = () => messagesOf(aiPresetMsg);

export interface AiPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** onde criar a chave (null = não precisa) */
  keyUrl: string | null;
  note: string;
}

export const PRESETS: AiPreset[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    get note() {
      return t().gemini;
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    get note() {
      return t().groq;
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    keyUrl: 'https://openrouter.ai/keys',
    get note() {
      return t().openrouter;
    },
  },
  {
    id: 'ollama',
    get label() {
      return t().ollamaLabel;
    },
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    keyUrl: null,
    get note() {
      return t().ollama;
    },
  },
  {
    id: 'custom',
    get label() {
      return t().customLabel;
    },
    baseUrl: '',
    model: '',
    keyUrl: null,
    get note() {
      return t().custom;
    },
  },
];

export interface AiConfig {
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const aiGetConfig = () => invoke<AiConfig | null>('ai_get_config');
/** `apiKey`: undefined = mantém a salva; '' = apaga. */
export const aiSetConfig = (config: AiConfig, apiKey?: string) => invoke<void>('ai_set_config', { config, apiKey: apiKey ?? null });
export const aiListModels = (provider: string, baseUrl: string, apiKey?: string) => invoke<string[]>('ai_list_models', { provider, baseUrl, apiKey: apiKey || null });
export const aiChat = (messages: ChatMessage[]) => invoke<string>('ai_chat', { messages });

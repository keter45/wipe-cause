import { defineMessages } from '../i18n';

export const aiPresetMsg = defineMessages(
  {
    gemini: 'Plano gratuito sem cartão (modelos Flash). No gratuito, o Google pode usar as perguntas para treinar modelos.',
    groq: 'Plano gratuito sem cartão, respostas muito rápidas. Tem limite de pedidos por minuto.',
    openrouter: 'Vários modelos gratuitos (terminados em ":free"); a lista muda com frequência — use "Carregar modelos".',
    ollamaLabel: 'Ollama (no seu PC)',
    ollama: 'Roda no seu computador: grátis, offline e privado. Precisa do Ollama instalado e de um modelo baixado (ex.: ollama pull qwen3).',
    customLabel: 'Outro (compatível com OpenAI)',
    custom: 'Qualquer serviço com a API de chat da OpenAI (LM Studio, Mistral, OpenAI...).',
  },
  {
    gemini: 'Free plan, no card needed (Flash models). On the free plan, Google may use the questions to train models.',
    groq: 'Free plan, no card needed, very fast answers. Has a requests-per-minute limit.',
    openrouter: 'Several free models (ending in ":free"); the list changes often — use "Load models".',
    ollamaLabel: 'Ollama (on your PC)',
    ollama: 'Runs on your computer: free, offline and private. Needs Ollama installed and a downloaded model (e.g. ollama pull qwen3).',
    customLabel: 'Other (OpenAI-compatible)',
    custom: 'Any service with the OpenAI chat API (LM Studio, Mistral, OpenAI...).',
  },
);

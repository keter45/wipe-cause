import { defineMessages } from '../i18n';

export const clipMsg = defineMessages(
  {
    button: 'Clipe',
    title: 'Clipe animado (WebP) deste trecho do replay',
    making: (pct: number) => `Desenhando o clipe… ${pct}%`,
    preview: 'Prévia do clipe',
    size: (mb: number) => `${mb.toFixed(1).replace('.', ',')} MB`,
    save: 'Salvar clipe',
    discord: 'Mandar no Discord',
    again: 'Gerar de novo',
    saved: 'Clipe salvo.',
    sent: 'Clipe enviado ao Discord.',
  },
  {
    button: 'Clip',
    title: 'Animated clip (WebP) of this part of the replay',
    making: (pct: number) => `Drawing the clip… ${pct}%`,
    preview: 'Clip preview',
    size: (mb: number) => `${mb.toFixed(1)} MB`,
    save: 'Save clip',
    discord: 'Send to Discord',
    again: 'Make it again',
    saved: 'Clip saved.',
    sent: 'Clip sent to Discord.',
  },
);

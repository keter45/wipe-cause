import { defineMessages } from '../i18n';

// `who`: null = os tops agregados; senão o nome da referência (um log só)
export const decisionMsg = defineMessages(
  {
    procLost: (buff: string, you: number, ref: number, who: string | null) => `${buff}: você deixou acabar ${you}% (${who ?? 'tops'} ${ref}%).`,
    procWait: (buff: string, you: string, ref: string, instead: string, who: string | null) =>
      `Com ${buff} ativo, você castou ${you} outra(s) habilidade(s) por proc antes de gastar (${who ?? 'tops'} ${ref}); a mais comum foi ${instead}.`,
    spentBy: (list: string) => `Quem gasta: ${list}.`,
    cdHeld: (name: string, you: string, ref: string, who: string | null) => `${name}: depois de pronto, você leva ${you} para usar, em média (${who ?? 'tops'} ${ref}). Use assim que sair.`,
    cdAlignCast: (name: string, partner: string, ref: number, you: number, who: string | null) =>
      `${name}: ${who ? `${who} usa` : 'os tops usam'} junto com ${partner} em ${ref}% das vezes; você em ${you}%.`,
    cdAlignBuff: (name: string, partner: string, ref: number, you: number, who: string | null) =>
      `${name}: ${who ? `${who} usa` : 'os tops usam'} com ${partner} ativo em ${ref}% das vezes; você em ${you}%.`,
  },
  {
    procLost: (buff: string, you: number, ref: number, who: string | null) => `${buff}: you let ${you}% expire (${who ?? 'tops'} ${ref}%).`,
    procWait: (buff: string, you: string, ref: string, instead: string, who: string | null) =>
      `With ${buff} up, you cast ${you} other ability(ies) per proc before spending it (${who ?? 'tops'} ${ref}); the most common was ${instead}.`,
    spentBy: (list: string) => `Spent by: ${list}.`,
    cdHeld: (name: string, you: string, ref: string, who: string | null) => `${name}: once ready, you take ${you} to use it on average (${who ?? 'tops'} ${ref}). Use it as soon as it's up.`,
    cdAlignCast: (name: string, partner: string, ref: number, you: number, who: string | null) =>
      `${name}: ${who ? `${who} uses it` : 'the tops use it'} together with ${partner} ${ref}% of the time; you ${you}%.`,
    cdAlignBuff: (name: string, partner: string, ref: number, you: number, who: string | null) =>
      `${name}: ${who ? `${who} uses it` : 'the tops use it'} with ${partner} up ${ref}% of the time; you ${you}%.`,
  },
);

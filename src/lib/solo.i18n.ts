import { defineMessages } from '../i18n';

export const soloMsg = defineMessages(
  {
    hadAvailable: (list: string) => `tinha ${list} disponível`,
    noHealthstone: 'não usou Healthstone',
    noPotion: 'não usou poção de vida',
    unknownCause: 'causa desconhecida',
    diedEarly: (left: string) => `Morreu com ${left} de luta pela frente`,
    killingBlow: (kb: string, after: string | null) => `Golpe final: ${kb}${after ? `, depois de ${after}` : ''}.`,
    atTheTime: (list: string) => `Na hora: ${list}.`,
    watchVideo: 'Veja no vídeo o que veio antes do golpe final.',
    mechanicErrors: (name: string, n: number) => `${name}: ${n} ${n === 1 ? 'erro' : 'erros'}`,
    diesBeforeEnd: 'Morre antes do fim',
  },
  {
    hadAvailable: (list: string) => `had ${list} available`,
    noHealthstone: 'did not use Healthstone',
    noPotion: 'did not use a health potion',
    unknownCause: 'unknown cause',
    diedEarly: (left: string) => `Died with ${left} of fight left`,
    killingBlow: (kb: string, after: string | null) => `Killing blow: ${kb}${after ? `, after ${after}` : ''}.`,
    atTheTime: (list: string) => `At the time: ${list}.`,
    watchVideo: 'Check the video for what came before the killing blow.',
    mechanicErrors: (name: string, n: number) => `${name}: ${n} ${n === 1 ? 'mistake' : 'mistakes'}`,
    diesBeforeEnd: 'Dies before the end',
  },
);

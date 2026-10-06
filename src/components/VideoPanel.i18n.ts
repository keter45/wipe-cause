import { defineMessages } from '../i18n';

export const videoMsg = defineMessages(
  {
    povOf: 'POV de',
    pointOfView: 'Ponto de vista',
    cloudVideo: 'Vídeo da nuvem do Warcraft Recorder (guilda)',
    localVideo: 'Vídeo deste PC',
    cloud: 'nuvem',
    goingTo: (t: string) => ` · indo para ${t} (5s antes)`,
    close: 'Fechar vídeo',
    cloudError: 'Não foi possível tocar este vídeo da nuvem (o link pode ter expirado: reabra a análise).',
    localError: 'Não foi possível tocar o vídeo aqui (codec não suportado?). Arquivo:',
    watch: 'Ver no vídeo',
    watchAt: (t: string) => `Ver no vídeo (${t})`,
  },
  {
    povOf: 'POV of',
    pointOfView: 'Point of view',
    cloudVideo: 'Video from the Warcraft Recorder cloud (guild)',
    localVideo: 'Video from this PC',
    cloud: 'cloud',
    goingTo: (t: string) => ` · jumping to ${t} (5s before)`,
    close: 'Close video',
    cloudError: "Couldn't play this cloud video (the link may have expired: reopen the analysis).",
    localError: "Couldn't play the video here (unsupported codec?). File:",
    watch: 'Watch in the video',
    watchAt: (t: string) => `Watch in the video (${t})`,
  },
);

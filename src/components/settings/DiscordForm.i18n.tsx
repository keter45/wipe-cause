import { defineMessages } from '../../i18n';

export const discordFormMsg = defineMessages(
  {
    testContent: 'Wipe Cause conectado: os resumos dos pulls vão chegar neste canal.',
    testSent: 'Mensagem de teste enviada. Confira o canal.',
    saved: 'Salvo.',
    off: 'Discord desligado.',
    step1: 'No Discord, abra as configurações do canal → Integrações → Webhooks.',
    step2: () => (
      <>
        <em>Novo webhook</em> → <em>Copiar URL do webhook</em> e cole abaixo.
      </>
    ),
    url: 'URL do webhook',
    autoSend: 'Com o modo ao vivo ligado, enviar sozinho:',
    onWipe: 'cada wipe (o motivo do wipe)',
    onKill: 'cada kill (o resumo do boss)',
    onNight: 'o resumo da noite, no fim da raid',
    paused: 'O envio automático está pausado pelo botão Discord no topo do app.',
    sendTest: 'Enviar teste',
    save: 'Salvar',
    footer: () => (
      <>
        Tudo vai como imagem, o mesmo cartão do <em>Compartilhar</em>. O fim da raid é quando você desliga o ao vivo ou depois de 30 min sem pull novo.
      </>
    ),
  },
  {
    testContent: 'Wipe Cause connected: pull summaries will arrive in this channel.',
    testSent: 'Test message sent. Check the channel.',
    saved: 'Saved.',
    off: 'Discord turned off.',
    step1: 'On Discord, open the channel settings → Integrations → Webhooks.',
    step2: () => (
      <>
        <em>New Webhook</em> → <em>Copy Webhook URL</em> and paste it below.
      </>
    ),
    url: 'Webhook URL',
    autoSend: 'With live mode on, send automatically:',
    onWipe: 'every wipe (the reason for the wipe)',
    onKill: 'every kill (the boss summary)',
    onNight: 'the night summary, at the end of the raid',
    paused: 'Automatic posting is paused by the Discord button at the top of the app.',
    sendTest: 'Send test',
    save: 'Save',
    footer: () => (
      <>
        Everything goes as an image, the same card as <em>Share</em>. The raid ends when you turn live off or after 30 min with no new pull.
      </>
    ),
  },
);

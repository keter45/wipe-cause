import { defineMessages } from '../i18n';

export const enemySpellsMsg = defineMessages(
  {
    none: 'Nenhuma habilidade inimiga registrada.',
    intro: () => (
      <>
        Algo aqui que as regras não pegam? Use <strong>+ criar regra</strong>.
      </>
    ),
    ability: 'Habilidade',
    source: 'Origem',
    hits: 'Hits em players',
    damage: 'Dano em players',
    coveredTitle: 'Uma regra do boss já usa este spell',
    covered: 'tem regra',
    create: 'criar regra',
  },
  {
    none: 'No enemy abilities recorded.',
    intro: () => (
      <>
        Something here the rules don't catch? Use <strong>+ create rule</strong>.
      </>
    ),
    ability: 'Ability',
    source: 'Source',
    hits: 'Hits on players',
    damage: 'Damage to players',
    coveredTitle: 'A boss rule already uses this spell',
    covered: 'has a rule',
    create: 'create rule',
  },
);

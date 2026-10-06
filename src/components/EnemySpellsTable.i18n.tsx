import { defineMessages } from '../i18n';

export const enemySpellsMsg = defineMessages(
  {
    none: 'Nenhuma habilidade inimiga registrada.',
    intro: () => (
      <>
        Tudo o que os inimigos castaram ou que causou dano em players neste pull. Achou algo que as regras não pegam? Use <strong>+ criar regra</strong> para o app
        passar a apontar isso nos próximos pulls.
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
        Everything the enemies cast or that damaged players in this pull. Found something the rules don't catch? Use <strong>+ create rule</strong> so the app
        starts pointing it out in the next pulls.
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

import { defineMessages } from '../i18n';

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const perfMsg = defineMessages(
  {
    stats: { crit: 'Crítico', haste: 'Aceleração', mastery: 'Maestria', versatility: 'Versatilidade' } as Record<string, string>,
    slots: [
      'Cabeça', 'Pescoço', 'Ombros', 'Camisa', 'Peito', 'Cintura', 'Pernas', 'Pés', 'Pulsos', 'Mãos',
      'Anel 1', 'Anel 2', 'Berloque 1', 'Berloque 2', 'Costas', 'Arma', 'Mão secundária', 'Tabardo',
    ] as readonly string[],
    outputDiff: (healer: boolean, pct: number, below: boolean) => `${healer ? 'Cura' : 'Dano'} por segundo vivo ${pct}% ${below ? 'abaixo' : 'acima'} da referência`,
    fewerUses: (name: string, mine: number, ref: number) => `${name}: ${mine} ${s(mine, 'uso', 'usos')} contra ${ref} da referência no mesmo tempo`,
    firstLate: (name: string, secs: string) => `${name}: 1º uso ${secs} depois da referência`,
    firstEarly: (name: string, secs: string) => `${name}: 1º uso ${secs} antes da referência`,
    notUsed: (name: string, cpm: string) => `${name}: não usou (referência: ${cpm}/min)`,
    lowCpm: (name: string, mine: string, ref: string) => `${name}: ${mine}/min contra ${ref}/min`,
    noCombatPotion: 'Sem poção de combate (a referência usou)',
    noEnchant: (slots: string) => `Sem encantamento: ${slots}`,
    talents: (n: number) => `${n} ${s(n, 'talento diferente', 'talentos diferentes')} da referência`,
  },
  {
    stats: { crit: 'Critical Strike', haste: 'Haste', mastery: 'Mastery', versatility: 'Versatility' } as Record<string, string>,
    slots: [
      'Head', 'Neck', 'Shoulders', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrists', 'Hands',
      'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2', 'Back', 'Weapon', 'Off hand', 'Tabard',
    ] as readonly string[],
    outputDiff: (healer: boolean, pct: number, below: boolean) => `${healer ? 'Healing' : 'Damage'} per second alive ${pct}% ${below ? 'below' : 'above'} the reference`,
    fewerUses: (name: string, mine: number, ref: number) => `${name}: ${mine} ${s(mine, 'use', 'uses')} vs ${ref} from the reference in the same time`,
    firstLate: (name: string, secs: string) => `${name}: first use ${secs} after the reference`,
    firstEarly: (name: string, secs: string) => `${name}: first use ${secs} before the reference`,
    notUsed: (name: string, cpm: string) => `${name}: not used (reference: ${cpm}/min)`,
    lowCpm: (name: string, mine: string, ref: string) => `${name}: ${mine}/min vs ${ref}/min`,
    noCombatPotion: 'No combat potion (the reference used one)',
    noEnchant: (slots: string) => `No enchant: ${slots}`,
    talents: (n: number) => `${n} ${s(n, 'talent', 'talents')} different from the reference`,
  },
);

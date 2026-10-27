# Atribuição por posição: quem da Gloombomb não chegou ao add

*   **Author:** Vinicius Andrade (@keter45)
*   **Status:** Approved
*   **Date:** 2026-10-27 (aprovado pelo desenvolvedor em 2026-10-27, sem `/egm:egm-review`)

Convenção: títulos e rótulos do template EGM ficam em inglês; o resto, em
português.

--------------------------------------------------------------------------------

## Overview

O wipe-cause lê o combat log do WoW e explica por que a raide morreu. Cada boss
é um arquivo de regras em `encounters/`; o núcleo em Rust (`crates/wipe-core`)
avalia as regras durante a leitura do log, e a interface em React mostra o
resultado por mecânica e no replay.

Esta feature cria um tipo de checagem novo: **atribuição por posição**. Alguns
bosses põem alvos em lugares fixos da sala e a raide combina que grupo de
players vai em qual lugar, por uma ordem de prioridade. O primeiro caso é a
Gloombomb do The Coiled Altar (Mythic, P2). A checagem descobre em que lugares
os alvos apareceram, aplica a prioridade combinada para dizer quem devia ir em
qual alvo e, quando o alvo fica sem a mecânica feita, culpa quem não estava lá.

A checagem é um campo genérico na regra do boss, sem nada do Coiled Altar no
código ([regra 1 do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto)). Os
números (lugares, alcance) foram medidos em 7 noites Mythic da guilda.

## The Problem

Na P2 Mythic do Coiled Altar, o Malacrass invoca 2 Spiteful Soulcoiler de cada
vez. Cada um nasce com Spirit Shield de 2 stacks e fica invulnerável enquanto
tem o escudo. Uns segundos depois, 4 players recebem Gloombomb. Quando a bomba
explode, cada add a até ~15 jardas do portador perde 1 stack. Escudo que sobra
deixa o add vivo e invulnerável, e a luta desanda.

A guilda resolve assim: os 4 portadores formam dois pares, os 2 rangeds e os 2
melees, e cada par vai num add. Qual add cada par pega sai de uma prioridade
por canto da sala, com o norte para cima (como o replay e o raidplan mostram):

| Grupo | Prioridade |
| --- | --- |
| Rangeds | cima esquerda > cima direita > baixo esquerda |
| Melees | baixo direita > baixo esquerda > cima direita |

Os rangeds pegam o primeiro canto da lista deles que tem add; os melees, o
primeiro da lista deles entre os que sobraram. Entre os healers, só paladino e
monge contam como melee.

Hoje o app mostra o escudo em volta do add no replay e culpa quem tomou a bomba
de outro player, mas não diz quem devia ir em qual add nem quem não chegou.
Depois de um wipe por escudo que ficou, quem lidera a raide precisa abrir o
replay, achar a leva, olhar os cantos, refazer a prioridade de cabeça e medir
quem estava longe. O app tem tudo isso no log e não usa.

O que o log mostra e o que falta medir já foi medido (215 levas de bomba de 14
a 26/10/2026):

*   Os adds nascem num `SPELL_SUMMON`, sempre em 4 pontos fixos; a posição de
    cada um aparece no cast do Spirit Shield que ele faz em si 30 ms depois.
*   A bomba dura 5,0 s e explode quando a aura sai. Não há dano no add: no
    mesmo milissegundo, o add perde 1 stack (`SPELL_AURA_REMOVED_DOSE`) por
    bomba no alcance. "A tempo" é só onde o portador está na explosão.
*   O alcance medido é de ~15 jardas, o raio da área da bomba que a regra já
    usa. O add anda ~12 jardas até a explosão, então a distância tem que usar a
    posição do add naquela hora.
*   Em 198 de 215 levas o jogo deu a bomba a exatamente 2 melees e 2 rangeds,
    contando paladino e monge healer como melee e o tank como melee. As outras
    17 ficam quase todas nos últimos segundos de pulls com wipe.
*   Quando os dois pares trocam de add, os dois escudos caem do mesmo jeito.
    Estar longe do add designado só é erro quando o escudo dele fica.
*   Nas 196 levas que dá para julgar, 67 escudos ficaram: 58 têm um portador
    designado vivo e fora do alcance; 8 têm o portador morto antes da explosão;
    1 ficou no limite do raio.

## Goals

*   Em cada leva julgável, o app diz em que canto cada alvo apareceu e qual
    grupo devia ir em qual alvo, pela prioridade da regra.
*   Quando o alvo designado de um grupo fica com escudo depois da explosão, o
    app culpa cada portador daquele grupo que estava vivo e fora do alcance do
    alvo. O texto diz o canto, a distância e, se ele estava no alcance do outro
    alvo, que foi no add errado. Nos logs medidos, isso culpa alguém em 58 dos
    67 escudos que ficaram.
*   Portador que morreu antes da explosão aparece como "morreu com a bomba",
    sem culpa a mais nesta mecânica (a morte já tem a causa dela).
*   Troca entre pares que tirou os dois escudos não gera culpa.
*   Leva que não dá para julgar (alvo longe de todo lugar da regra, número
    errado de portadores num grupo) não gera culpa e é contada no relatório do
    processo padrão.
*   A checagem é um campo genérico da regra (lugares com nome em pt e en,
    grupos, prioridade, alcance), e o grupo diz quem entra pelo papel da spec
    (melee ou ranged). A regra do Coiled Altar passa a usar o campo no Mythic,
    com os números medidos e a fonte no comentário.
*   O processo padrão do boss ([regra 4](../CONTRIBUTING.pt-BR.md#regras-do-projeto))
    mostra os números da checagem: levas julgadas e puladas, escudos que ficaram
    com e sem culpado, e REVISAR quando um alvo aparece longe de todos os
    lugares da regra.
*   Todo texto novo sai em pt e en; nomes de habilidade ficam em inglês; na
    tela, o portador na cor da classe e a habilidade com ícone e nome
    ([regra 5](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).

## Non-Goals

*   Editar a prioridade pela tela de ajuste de regras. Ela fica só no YAML
    (decisão do desenvolvedor em 2026-10-27); outra guilda muda copiando o YAML
    para a pasta de regras do usuário.
*   Desenho novo no replay (linha do portador ao alvo dele, nome dos cantos no
    mapa). O replay da falha que o `failure_event` já guarda continua igual.
*   Adivinhar o que a guilda combinou numa leva fora do padrão (por exemplo, 3
    rangeds e 1 melee).
*   Julgar a escala de interrupt do Wail of Terror ou a morte dos adds.
*   Heroic e Normal: o Spirit Shield só existe no Mythic.

## Open Questions

Nenhuma. Onde fica "melee", em que mecânica a checagem entra e o alcance
foram decididos com o Technical Plan (aprovado em 2026-10-27).

## Critical User Journeys (CUJs)

### CUJ 1: escudo ficou porque um ranged não chegou

*   **Given**: um log Mythic do Coiled Altar com advanced logging, aberto no
    app (ou um report do Warcraft Logs com as posições). Os adds da leva
    nasceram em cima direita e baixo esquerda; os rangeds deviam ir em cima
    direita.
*   **When**: um dos rangeds está a 31,7 jardas do add de cima direita quando a
    bomba explode, e o add fica com 1 stack de Spirit Shield.
*   **Then**: a mecânica Spirit Shield do pull mostra 1 falha. O ranged aparece
    na lista de culpados, na cor da classe, com o texto "não chegou ao add de
    cima direita (estava a 31,7 jd na explosão)". A linha do tempo da mecânica
    tem a leva ("adds em cima direita e baixo esquerda: rangeds em cima
    direita, melees em baixo esquerda") e o replay da falha abre na explosão,
    com o foco no culpado.

### CUJ 2: os pares trocaram de add e deu certo

*   **Given**: a mesma leva, mas os rangeds foram no add de baixo esquerda e os
    melees no de cima direita.
*   **When**: as bombas explodem e os dois adds perdem os 2 stacks.
*   **Then**: nenhuma falha e nenhum culpado. A linha do tempo mostra a leva e
    diz que o escudo dos dois caiu.

### CUJ 3: portador morreu antes da explosão

*   **Given**: um melee recebe a bomba e morre 2 s depois.
*   **When**: a bomba dele some sem explodir e o add dos melees fica com 1 stack.
*   **Then**: 1 falha. O melee morto aparece na linha do tempo com "morreu com
    a bomba antes da explosão", sem entrar na lista de culpados; se o outro
    melee estava longe, ele é o culpado.

### CUJ 4: conferir a regra depois de um patch

*   **Given**: o desenvolvedor tem um log novo e quer saber se os cantos e o
    alcance da regra ainda valem.
*   **When**: roda `npm run replay:check -- <log> --boss "The Coiled Altar"
    --difficulty Mythic`.
*   **Then**: o relatório tem a seção "Atribuição por posição" com levas
    julgadas e puladas (e por quê), escudos que ficaram com e sem culpado, e
    REVISAR se um add apareceu a mais de 5 jardas de todos os lugares da regra.

## Technical Plan (Architecture)

### Visão geral

A checagem é um detector novo do `failure_event`, no mesmo molde dos três que
já existem (`detect.orbs` em `orbs.rs`, `detect.pairing` em `pairing.rs`,
`detect.gaze` em `gaze.rs`): uma struct de configuração lida do YAML, um log
que o `RuleTracker` alimenta enquanto o log do jogo é lido, e um julgamento no
`finish` do `RuleTracker`, que transforma cada escudo que ficou numa falha com
culpados. O nome do campo é `detect.assign`; o módulo é
`crates/wipe-core/src/assign.rs`.

```text
WoWCombatLog / report do WCL
        │
        ▼
analysis.rs (lê linha a linha)
  SPELL_SUMMON ──────────────► RuleTracker.on_summon ─────┐
  bloco advanced (inimigo) ──► RuleTracker.on_enemy_pos ──┤
  bloco advanced (player) ───► RuleTracker.on_player_pos ─┤   (já existe)
  SPELL_AURA_* ──────────────► RuleTracker.on_aura_event ─┼─► AssignLog
  UNIT_DIED ─────────────────► RuleTracker.on_unit_died ──┘   (o que aconteceu)
        │
        ▼ fim do pull
RuleTracker.finish(roles, ranges)
  assign::judge(cfg, log, ranges) ─► levas: lugares, grupo → alvo, escudo ficou?,
                                     culpados, mortos
        │
        ▼
MechanicResult da mecânica: falhas, culpados com texto, eventos da linha do
tempo, replays da falha (os de sempre do failure_event) e o resumo `assign`
        │
        ├─► interface (MechanicsView: nada muda)
        └─► scripts/replay-check.mjs: seção "Atribuição por posição"
```

### O campo na regra

```yaml
detect:
  assign:
    carrier_aura: 1310881     # aura dos portadores; a explosão é quando ela sai
    target_npc: 261521        # os alvos: unidades desse npc que nascem por SPELL_SUMMON
    target_aura: 1309105      # aura no alvo; ainda nele depois da explosão = falha
    reach: 16.5               # jardas do portador ao alvo na explosão
    target_name: { pt: add, en: add }   # como os textos chamam o alvo (padrão: alvo / target)
    spots:                    # lugares fixos, nas coordenadas do log, com nome pt/en
      - { key: top_left, at: [1176.3, 20.9], name: { pt: "cima esquerda", en: "top left" } }
      - ...
    groups:                   # em ordem: o primeiro escolhe antes
      - { range: ranged, name: { pt: rangeds, en: ranged }, priority: [top_left, top_right, bottom_left] }
      - { range: melee,  name: { pt: melees,  en: melee },  priority: [bottom_right, bottom_left, top_right] }
```

Nada no código cita a Gloombomb, o Soulcoiler ou os cantos. Outro boss com
"alvos nascem em lugares fixos, grupos vão em cada um por prioridade, uma aura
no alvo mostra se chegaram" usa o mesmo campo com outros números.

### Melee e ranged

Proposta: um campo novo `range` (`melee` ou `ranged`) em cada spec de
`data/defensives.json`, a tabela de specs que o núcleo já lê (`SpecInfo` em
`data.rs`). Tanks são `melee`; Holy Paladin (65) e Mistweaver (270) são
`melee`; os outros healers são `ranged`; os DPS seguem o alcance da spec
(Survival, Feral, Enhancement, Windwalker, Retribution, Havoc, os dois
Warriors, os três Rogues e os dois DKs de DPS são `melee`).

Por que na tabela de specs e não na regra: é a divisão que o próprio jogo usa
para escolher os alvos da Gloombomb (198 de 215 levas batem; quando falta
melee, o jogo dá a bomba ao tank). É fato do jogo, como a classe e o papel que
a tabela já guarda, e vale para outros bosses que separam melee de ranged. A
regra só diz qual `range` forma o grupo.

O `RuleTracker::finish` hoje recebe `roles` (guid → papel). Passa a receber
também `ranges` (guid → `melee`/`ranged`), montado em `analysis.rs` da spec de
cada player, como `roles` já é.

### A leva e o julgamento

`AssignLog` guarda, para o pull:

*   cada alvo: guid, quando nasceu (`SPELL_SUMMON` com o npc), o primeiro
    lugar que o log deu (o cast do escudo 30 ms depois, no Coiled Altar), as
    posições seguintes, os stacks da `target_aura` e quando morreu;
*   cada portador: quando a `carrier_aura` entrou e saiu, e quando morreu;
*   as posições dos portadores (o mesmo `on_player_pos` que orbs e fantasmas
    usam).

O julgamento, no fim do pull:

1.  **Leva**: aplicações da `carrier_aura` a menos de 1 s uma da outra.
2.  **Alvos da leva**: os do último `SPELL_SUMMON` do `target_npc` antes da
    leva (os do mesmo instante, ±500 ms), vivos na aplicação. Um add antigo
    ainda vivo não entra.
3.  **Lugar de cada alvo**: o `spot` a até 5 jardas do primeiro lugar do alvo.
    Alvo longe de todos: a leva não é julgada e o resumo guarda onde ele
    estava (o `replay:check` dá REVISAR).
4.  **Grupos**: cada portador entra no grupo do `range` da spec dele. A leva só
    é julgada se todo portador tem grupo e todos os grupos têm o mesmo número
    de portadores. Senão, fica de fora com o motivo.
5.  **Grupo → alvo**: na ordem da regra, cada grupo pega o primeiro lugar da
    sua `priority` que tem alvo da leva ainda não tomado. Grupo sem lugar: a
    leva não é julgada.
6.  **Explosão**: o `SPELL_AURA_REMOVED` da `carrier_aura` de cada portador.
    Portador que morreu até 50 ms depois dela não explodiu.
7.  **Escudo ficou**: o alvo de um grupo está vivo e ainda tem a
    `target_aura` 300 ms depois da última explosão do grupo.
8.  **Culpa**: para cada grupo cujo alvo ficou com escudo, cada portador vivo
    que estava a mais de `reach` do alvo na explosão é culpado. A posição do
    portador é a última até 30 ms depois da explosão; a do alvo, a última até a
    explosão (sem nenhuma, o lugar onde nasceu). Se o portador estava a até
    `reach` de outro alvo da leva, o texto diz que ele foi no add errado.

Cada grupo cujo alvo ficou com escudo é uma falha do `failure_event`, no
instante da explosão. Com isso a contagem, a lista de culpados (`blame_texts`)
e os replays da falha com foco nos culpados vêm do que o `failure_event` já
faz; o detector só preenche `fail_times`, `players` e os textos, como o
`gaze_culprits` faz hoje.

### O que aparece

Na linha do tempo da mecânica (eventos), por leva:

*   sem player: "Adds em cima direita e baixo esquerda: rangeds em cima
    direita, melees em baixo esquerda" (ou o motivo de não julgar: "2 rangeds e
    1 melee com a bomba: a leva não foi julgada");
*   por culpado: "não chegou ao add de cima direita (31,7 jd na explosão)" ou
    "foi no add de baixo esquerda em vez do de cima direita";
*   por portador morto: "morreu com a bomba antes da explosão";
*   escudo que ficou sem culpado: "o escudo do add de cima direita ficou, mas
    os dois estavam no alcance".

O player do evento já aparece com o nome na cor da classe (`PlayerName`); os
textos não citam outro player no meio da frase, então a interface não muda. O
ícone da mecânica é o da `target_aura` quando a regra não tem outro.

O `MechanicResult` ganha um campo opcional `assign` com o resumo do pull: levas,
julgadas, puladas (com o motivo), escudos que ficaram, com e sem culpado, e os
alvos que apareceram longe dos lugares. A interface não usa; o `replay:check`
lê.

### A regra do Coiled Altar

A mecânica `spirit_shield` (hoje `info`, com o escudo no mapa) vira
`failure_event` Mythic com o `detect.assign`, mantendo a key, o `unit_aura`, a
gravidade `wipe` e ganhando `message` e `blame_message` novos. A `gloombomb`
(dano em quem não carrega a bomba) fica como está. Ajustes salvos pelo usuário
na key `spirit_shield` continuam valendo.

### Os números

*   **Lugares**: os 4 pontos medidos (até 0,6 jd de variação em 432 adds).
*   **Alcance**: 16,5 jardas, o raio de 15 da área da bomba mais 1,5 de folga
    para a posição do log (os orbs usam raio + 1). Com 15, 16,5 e 18 jardas os
    culpados são 58, 58 e 57.
*   **Constantes no código** (não na regra, como as de `pairing.rs`): leva = 1
    s, alvos do mesmo summon = 500 ms, lugar = 5 jd, escudo conferido 300 ms
    depois, morte até 50 ms depois da explosão.

### Processo padrão

O `scripts/replay-check.mjs`, que já é o relatório com status das regras do
boss, ganha a seção "Atribuição por posição" para cada mecânica com
`detect.assign`: soma os resumos `assign` dos pulls e dá REVISAR para alvo que
apareceu longe dos lugares, ATENÇÃO quando mais de 20% dos escudos que ficaram
não têm culpado nem portador morto (alcance ou lugares a conferir) e OK no
resto. A skill
`replay-build` ganha uma linha sobre o que fazer com cada item.

## Alternatives Considered

### Alternative A: culpar todo portador longe do add designado

*   **Pros**: mais simples; não precisa olhar o escudo depois da explosão.
*   **Cons**: nos logs medidos, 93 portadores estavam longe do add designado,
    mas só 58 escudos ficaram por isso. O resto é troca entre pares que tirou
    os dois escudos do mesmo jeito.
*   **Reason for Rejection**: culparia gente por uma troca que deu certo. O
    erro que custa a luta é o escudo que fica; é ele que abre a falha.

### Alternative B: dizer só quem acertou cada add, sem prioridade

*   **Pros**: não depende da estratégia da guilda; cada stack perdido vai para
    o portador mais perto do add.
*   **Cons**: quando ninguém chegou num add, não há de quem ser o stack que
    faltou. A pergunta do líder da raide é "quem devia estar lá", e só a
    prioridade responde.
*   **Reason for Rejection**: não acha o culpado justamente no caso que importa.

### Alternative C: lista de specs de cada grupo na regra

*   **Pros**: a guilda decide quem é melee sem depender da tabela de specs;
    tudo da estratégia fica num lugar só.
*   **Cons**: 40 specs repetidas em cada boss que separa melee de ranged; uma
    spec nova (como a Devourer) precisa ser lembrada em cada regra.
*   **Reason for Rejection**: a divisão é a do jogo (198 de 215 levas batem com
    ela), então mora na tabela de specs com classe e papel. A regra continua
    escolhendo qual `range` forma cada grupo.

### Alternative D: prioridade editável na tela de ajuste de regras

*   **Pros**: outra guilda muda a estratégia sem copiar um YAML.
*   **Cons**: precisa de um editor de lista ordenada novo na tela de ajustes e
    de um campo novo na camada de tuning.
*   **Reason for Rejection**: decisão do desenvolvedor em 2026-10-27: a
    prioridade fica só no YAML. Fica para depois se outra guilda pedir.

### Alternative E: checagem própria do Coiled Altar no código

*   **Pros**: menos campos para pensar agora.
*   **Cons**: quebra a regra 1 do projeto (boss é dado, não código) e não serve
    a nenhum outro boss com atribuição por posição.
*   **Reason for Rejection**: regra 1.

### Alternative F: subcomando novo no `wipe-cli` para os números

*   **Pros**: separa a conferência da regra de culpa da conferência do mapa.
*   **Cons**: mais um comando e mais um relatório; o CONTRIBUTING já diz que o
    relatório com status das regras do boss é o do `replay:check`.
*   **Reason for Rejection**: o `replay:check` já roda o boss inteiro pelo
    `wipe-cli` e lê o relatório; a seção nova é só mais uma leitura dele.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Desempenho**: o detector só existe no pull de um boss com
    `detect.assign`. Os ganchos novos fazem uma busca num `HashMap` e um push
    por evento; a posição de inimigo só é guardada para unidades do
    `target_npc`. O julgamento roda uma vez por pull, sobre dezenas de levas.
*   **Compatibilidade**: `MechanicResult.assign` é opcional e a interface o
    ignora; relatórios salvos antes continuam abrindo. Ajustes do usuário na
    key `spirit_shield` continuam valendo. A versão web (WASM) usa o mesmo
    núcleo e não muda.
*   **Dados**: só posições e auras que o log já tem; nada sai da máquina.

--------------------------------------------------------------------------------

### Additional Resources

*   [Regras do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto) (regras 1, 4 e 5).
*   [docs/replay-methods.md](../replay-methods.md): princípios do motor.
*   [docs/coiled-altar-replay-audit.md](../coiled-altar-replay-audit.md): IDs
    da Gloombomb e do Spirit Shield.
*   Medição: 7 noites Mythic da guilda (14, 15, 19, 20, 21, 22 e 26/10/2026),
    215 levas, 432 adds.

### Future Improvements

*   **Linha do portador ao alvo no replay**: durante a bomba, uma linha de cada
    portador até o add dele, na cor do grupo, e o nome dos lugares no mapa.
*   **Grupo por specs**: um grupo com `specs` explícitas, por cima do `range`,
    para guilda que conta uma spec diferente do jogo.
*   **Prioridade na tela de ajustes**: se outra guilda pedir.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `crates/wipe-core/src/assign.rs` (Create)

*   **Type / Scope**: módulo Rust do núcleo, no molde de `gaze.rs` e
    `pairing.rs` (comentário de módulo em pt dizendo o que o log mostra).
*   **Proposed Changes**:
    *   `AssignDetect` (`Deserialize`): `carrier_aura: u32`, `target_npc: u32`,
        `target_aura: u32`, `reach: f32`, `spots: Vec<Spot>`,
        `groups: Vec<Group>`, `target_name: Text` (padrão alvo / target). `Spot { key: String, at: (f32, f32), name: Text }`;
        `Group { range: String, name: Text, priority: Vec<String> }`.
    *   Constantes: `WAVE_GAP_MS = 1_000`, `SAME_SUMMON_MS = 500`,
        `SPOT_YD = 5.0`, `SHIELD_CHECK_MS = 300`, `DEATH_SLACK_MS = 50`,
        `PLAYER_POS_AFTER_MS = 30`.
    *   `AssignLog` (`Default`): alvos por guid (`summoned_at`, `first_at:
        Option<(f32, f32)>`, posições `Vec<(i64, f32, f32)>`, stacks da
        `target_aura` como `Vec<(i64, u32)>`, `died_at`); portadores (lista de
        `(guid, name, applied_at, removed_at)`); mortes de players por guid;
        posições de players por guid.
    *   Métodos que o `RuleTracker` chama: `on_summon(cfg, npc, guid, t)`,
        `on_enemy_pos(guid, x, y, t)` (só guarda alvo conhecido; a primeira
        vira `first_at`), `on_player_pos(guid, x, y, t)`,
        `on_aura(cfg, spell_id, guid, name, stacks, is_player, t)` (carrier:
        APPLIED/REMOVED; target: cada APPLIED com a aura aberta soma 1, DOSE
        põe o valor, REMOVED põe 0, como `analysis.rs::unit_aura` lê as stacks
        iniciais), `on_unit_died(guid, t)`.
    *   `judge(cfg, log, ranges: &HashMap<String, String>) -> Vec<Wave>`: os 8
        passos de "A leva e o julgamento". `Wave { t, outcome }`, com
        `outcome` = `Skipped(SkipReason)` (lugar desconhecido com o ponto,
        grupo sem spec, grupos com números diferentes, prioridade sem lugar) ou
        `Judged { spots por alvo, grupo → spot, por grupo: shield_left, t_boom,
        portadores com Ok | Late { yd } | WrongTarget { spot } | Dead |
        NoPosition }`.
    *   `summary(&[Wave]) -> AssignSummary` para o relatório.
    *   Testes `#[cfg(test)]` (ver Verification Plan).

#### 2. `crates/wipe-core/src/lib.rs` (Modify)

*   **Type / Scope**: lista de módulos.
*   **Proposed Changes**: `pub mod assign;`, em ordem alfabética.

#### 3. `crates/wipe-core/src/rules.rs` (Modify)

*   **Type / Scope**: regras e `RuleTracker`.
*   **Proposed Changes**:
    *   `Detect` ganha `pub assign: Option<AssignDetect>`, com o comentário no
        estilo dos outros detectores.
    *   `RuleTracker` ganha `assign: Option<(usize, AssignLog)>` (só uma
        mecânica por pull, como `gaze`), criado em `new`.
    *   `wants_positions` inclui `self.assign.is_some()`; `on_player_pos` e
        `on_aura` repassam ao `AssignLog` (este também para inimigos).
    *   Novos: `on_summon(npc_id, guid, t)`, `on_enemy_pos(guid, x, y, t)`,
        `on_unit_died(guid, t)` e `on_aura_event(event, spell_id, guid, name,
        stacks, t)`; não fazem nada sem `assign`. O `on_aura_event` leva o tipo
        da linha porque o `on_aura` só recebe as stacks, e um `APPLIED` (stack
        inicial) chega igual a um `REMOVED_DOSE` que deixou 1 stack.
    *   `finish(roles, ranges: &HashMap<String, String>)`: chama
        `assign_culprits(m, st, log, ranges)` junto de `gaze_culprits`, que
        para cada grupo com escudo que ficou faz `st.failures += 1`,
        `st.fail_times.push(t_boom)`, `bump` e `blame_texts` dos culpados e
        `push_event` da leva, dos culpados, dos mortos e do "sem culpado". Os
        textos com `tx!` em pt e en, com o nome do lugar e do grupo do YAML.
    *   O ícone (`spell_id` do `MechanicResult`) cai em
        `assign.target_aura` quando a regra não tem outro.
    *   `MechanicResult.assign` preenchido com `assign::summary`.
    *   O teste existente que chama `finish(&HashMap::new())` passa a mandar
        dois mapas vazios.

#### 4. `crates/wipe-core/src/report.rs` (Modify)

*   **Type / Scope**: tipos do relatório (serializados para a interface e os
    scripts).
*   **Proposed Changes**: `MechanicResult` ganha
    `#[serde(skip_serializing_if = "Option::is_none")] pub assign:
    Option<AssignSummary>`. `AssignSummary { waves, judged, skipped:
    Vec<(String, u32)> (motivo → quantas), shields_left, blamed, dead_carriers,
    unexplained, off_spot: Vec<(f32, f32)> }`, em camelCase como o resto.
    `blamed`: escudos que ficaram com pelo menos um culpado; `dead_carriers`:
    escudos que ficaram sem culpado e com um portador do grupo morto antes da
    explosão; `unexplained`: os que ficaram sem culpado e sem portador morto
    (só esses apontam para alcance ou lugares errados). Cada escudo que ficou
    cai em exatamente um dos três.

#### 5. `crates/wipe-core/src/analysis.rs` (Modify)

*   **Type / Scope**: leitura do log.
*   **Proposed Changes**:
    *   `SPELL_SUMMON`: `r.on_summon(npc_id(f[5]), f[5], rel)` enquanto conta
        (`counting()`).
    *   Bloco advanced de inimigo (onde `e.pos` é gravado):
        `r.on_enemy_pos(info_guid, x, y, rel)` quando `wants_positions()` e
        antes da call de wipe, como a posição de player.
    *   `UNIT_DIED`: `r.on_unit_died(dst_guid, rel)`, antes do retorno de quem
        não é player.
    *   Onde `roles` é montado: `ranges` (guid → `range` da spec, pelo
        `GameData`), passado ao `finish`.
    *   Os testes que chamam `finish(&HashMap::new())` passam dois mapas.

#### 6. `crates/wipe-core/src/data.rs` (Modify)

*   **Type / Scope**: tabela de specs.
*   **Proposed Changes**: `SpecInfo` ganha `pub range: String` ("melee" ou
    "ranged"). O teste do módulo confere que toda spec tem `range` válido e que
    65 e 270 são `melee`.

#### 7. `data/defensives.json` (Modify)

*   **Type / Scope**: dados do jogo.
*   **Proposed Changes**: `"range"` em todas as 40 specs: `melee` para os 6
    tanks, Holy Paladin (65), Mistweaver (270), Retribution (70), Arms (71),
    Fury (72), Feral (103), Frost e Unholy DK (251, 252), Survival (255), os
    três Rogues (259, 260, 261), Enhancement (263), Windwalker (269) e Havoc
    (577); `ranged` para as outras.

#### 8. `encounters/venomous-abyss/the-coiled-altar.yaml` (Modify)

*   **Type / Scope**: regra do boss.
*   **Proposed Changes**: `spirit_shield` vira `type: failure_event`
    (Mythic, `severity: wipe`, mesma key e mesmo `unit_aura`) com
    `detect.assign` (os 4 lugares medidos, os dois grupos com a prioridade,
    alcance 16,5), `message` "{count} escudo(s) que ficaram no add" / "{count}
    shield(s) left on an add", `blame_message`, `tip` em pt e en, e o
    comentário com as datas, os logs e os números da medição. `updated:
    2026-10-27` e uma linha nova em `source`.

#### 9. `.claude/skills/boss-rules/references/schema.md` (Modify)

*   **Type / Scope**: formato das regras (lido pela skill `boss-rules`).
*   **Proposed Changes**: linha da tabela para `detect.assign`, no estilo das
    de `detect.orbs` e `detect.pairing` (campos, o que é falha, quem é
    culpado, "precisa de advanced logging"), e uma frase sobre o `range` das
    specs.

#### 10. `scripts/replay-check.mjs` (Modify)

*   **Type / Scope**: processo padrão do boss.
*   **Proposed Changes**: para cada mecânica com `detect.assign` na regra,
    soma os `assign` dos pulls do relatório; REVISAR com `off_spot` não vazio
    (os pontos no texto), ATENÇÃO quando `unexplained` passa de 20% de
    `shields_left`, e uma seção "Atribuição por posição" no `.md` com as
    contagens e os motivos das levas puladas.

#### 11. `.claude/skills/replay-build/SKILL.md` (Modify)

*   **Type / Scope**: skill do processo padrão.
*   **Proposed Changes**: o que fazer com os dois itens novos: REVISAR de alvo
    fora dos lugares (medir o ponto novo e pôr em `spots`); ATENÇÃO de escudo
    sem culpado (conferir alcance e lugares com o `wipe-cli radius`).

#### 12. `docs/coiled-altar-replay-audit.md` (Modify)

*   **Type / Scope**: auditoria do boss.
*   **Proposed Changes**: seção "Gloombomb e Spirit Shield: atribuição por
    canto", com o que o log mostra, os 4 pontos, o alcance, a divisão
    melee/ranged que o jogo usa e as contagens da medição.

#### 13. `docs/replay-methods.md` (Modify)

*   **Type / Scope**: princípios do motor.
*   **Proposed Changes**: `detect.assign` na lista de campos do princípio 1
    (linha 13).

#### 14. `docs/designs/gloombomb-assignment.md` (Create) e `docs/designs/SITEMAP.md` (Modify)

*   **Type / Scope**: este design e o índice.
*   **Proposed Changes**: o design salvo com Status Approved depois da
    aprovação; linha no SITEMAP com a coluna Status. No último commit do PR,
    Status Implemented nos dois.

### Verification Plan

*   **Compilation/Build**: `cargo build -p wipe-core` e
    `cargo build --release -p wipe-core --bin wipe-cli` (o `replay:check`
    precisa do release); `npm run build` (o tipo TS não muda, mas o build
    confere).
*   **Unit Tests**: `cargo test -p wipe-core`, com testes novos em
    `assign.rs`:
    *   as 6 combinações de 2 cantos dão grupo → canto sem conflito pela
        prioridade do Coiled Altar;
    *   ranged a 31,7 jd e escudo que ficou: 1 falha, ele culpado, texto com o
        canto e a distância;
    *   pares trocados e os dois escudos caindo: nenhuma falha;
    *   portador morto antes da explosão: "morreu com a bomba", sem culpa;
    *   portador no alcance do outro alvo: texto de add errado;
    *   3 rangeds e 1 melee: leva pulada com o motivo;
    *   alvo a mais de 5 jd dos lugares: leva pulada e `off_spot` preenchido;
    *   add antigo vivo na leva nova não entra nos alvos.
    E um teste em `analysis.rs`, no estilo do `ghost_yards_add_up_each_owner_path`,
    passando eventos pelo `RuleTracker` do Coiled Altar embutido.
*   **Static Analysis & Linting**: `cargo clippy -p wipe-core` sem aviso novo;
    `npm run docs:links` sai com 0.
*   **E2E/Integration**: `npm run replay:check -- <log> --boss "The Coiled
    Altar" --difficulty Mythic` nas 7 noites medidas, sem REVISAR de lugar.
    Comparação leva a leva com a medição: o script da medição
    (`gloom-assign.mjs`, na nota da sessão) escreve cada escudo que ficou com
    pull, instante e culpados, e o resultado do motor é comparado com ele por
    (pull, instante ±100 ms). Toda diferença é listada no PR com o motivo
    (posição com idade diferente, por exemplo); a referência é 196 levas
    julgadas, 67 escudos que ficaram, 58 com culpado, 8 com portador morto e 1
    sem explicação. Abrir um pull de 26/10 no app e conferir o CUJ 1 na tela
    (culpado na cor da classe, texto, replay da falha). Abrir um report do WCL
    de uma dessas noites e conferir que a mecânica dá o mesmo resultado (se o
    report não trouxer as auras dos adds, anotar no design como limite).

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*

# Boss novo num comando: coleta, rascunho, medição, arena e conferência

* **Author:** @keter45
* **Status:** Implemented
* **Date:** 2026-11-20 (aprovado pelo desenvolvedor em 2026-11-20: "podemos fazer todos os pontos", com um
  comando principal; design escrito à mão, sem EGM)

Convenção: títulos do template em inglês; o resto, em português.

## Overview

Hoje um boss novo passa por três skills (`boss-rules`, `replay-build`, `sim-calibrate`) e por medições que
cada auditoria refez com scripts descartáveis em `samples/` (fora do git). Este design junta o fluxo num
comando só:

```
npm run boss:new -- <encounter_id> [--log <WoWCombatLog.txt>]... [--wcl <código>]... [--tops N] [--difficulty Mythic]
```

O comando roda seis etapas em ordem: coleta → rascunho da regra → medição → arena → conferência → relatório.
Cada etapa grava em `samples/boss/<slug>/` (fora do git) e só refaz o que mudou. O relatório final
(`samples/boss/<slug>/<data>.md`) tem OK / ATENÇÃO / REVISAR por etapa. A skill nova `boss-new` resolve os
REVISAR e chama as três skills de hoje quando precisa.

## The Problem

- **Medição refeita à mão.** Raio por pulso (Youden), direção de onda por hipóteses, velocidade pelo envelope,
  poça por busca de centro, queda do dano com a distância: tudo está só em texto em `docs/replay-methods.md`.
  O único comando é o `wipe-cli radius`, que faz histograma dos atingidos sem olhar quem estava perto e não
  tomou.
- **O `replay:check` não confere a forma desenhada.** Ele diz se uma mecânica tem forma, não se a forma está
  no lugar certo. Não confere se o id da regra aparece no papel certo (o Coiling Ichor tinha o id do cast no
  lugar da aura e o círculo nunca aparecia). Aceita `unavoidable` sem testar se o dano cai com a distância
  (Vashnik: Malignant Catalyst 7,3% e Dripping Fangs 6,4% do dano, "sem forma"). Põe o Melee em "casts sem
  regra" em todo boss.
- **Informação do boss lida à mão.** O Encounter Journal (spell, dificuldade, alerta de tank, interrompível,
  mortal), o raio e a duração de cada spell e o módulo do BigWigs estão disponíveis, mas cada boss começa
  lendo guia e wiki.
- **Prog sem log da guilda.** Logs de outras guildas no Warcraft Logs servem para medir (auditoria do
  Ula'tek), mas não são o caminho padrão.
- **Arena com passo manual.** O `arena-fit` grava campos com outros nomes, e a cópia para `data/arenas.json` é à
  mão; o encaixe por lugares que o log fixa (Vashnik) foi feito com conta à mão.
- **Hotfix de tamanho.** Só os orbs têm histórico (`detect.orbs.before`). Qualquer outra forma que muda de
  tamanho num nerf erra nos logs antigos.

Evidência: o Ula'tek levou 6 PRs em 8 dias (keter45/wipe-cause#96 a #127).

## Goals

1. Um comando (`npm run boss:new`) que leva um `encounter_id` a: regra rascunhada, medidas com números,
   arena encaixada e relatório com status, sem passo manual entre as etapas.
2. Cada método de medição do `replay-methods.md` vira um subcomando versionado (`wipe-cli probe`), que roda
   no log local e nos dumps do Warcraft Logs.
3. O `replay:check` mede a forma desenhada contra o log (acertos dentro × quem não tomou dentro), confere os
   ids pelo papel e testa a queda do dano com a distância.
4. O boss começa pelos dados do jogo (Journal, raio, duração) e pelo BigWigs, antes do guia.
5. Qualquer campo de uma mecânica pode ter histórico por data (`history`), para nerfs de tamanho.
6. As medidas reproduzem os números das auditorias que já existem (verificação).

## Non-Goals

- Escrever `tip`/`message` finais ou decidir culpa: isso continua com a skill (o rascunho marca "A revisar").
- Interface nova no app: nada muda em `src/` além do que o `history` exigir (nada, porque o núcleo resolve).
- Migrar o `detect.orbs.before` para `history`: continua funcionando; migração fica para depois.
- Baixar ou guardar a imagem da arena no repositório (continua da CDN do raidplan).
- Rodar o SimC dentro do `boss:new` quando não há log da guilda (o `sim:check` só roda com `--log`).

## Open Questions

- Nenhuma bloqueante. A imagem da arena no raidplan.io continua à mão (a página do editor é montada em JS):
  sem arena, a etapa 4 dá REVISAR com o caminho (`arena-fit --write`).

## Critical User Journeys

### CUJ 1: boss do próximo patch, sem log nenhum (Kith'ix)

`npm run boss:new -- 3513`. Coleta Journal, spells e BigWigs; escreve `encounters/<raide>/kithix.yaml` com as
mecânicas em `info`, ids por papel e dicas de tamanho; relatório diz "sem log: medição e conferência
puladas" e lista o que falta.

### CUJ 2: boss em prog, com logs de outras guildas

`npm run boss:new -- 3513 --tops 6`. Além do CUJ 1, baixa 6 reports com o boss pelo Warcraft Logs, roda as
medidas e propõe formas com números (raio por pulso, frontal, soak na frente, ondas, poças); a arena é
encaixada pelos pisões e conferida com as unidades.

### CUJ 3: noite da guilda

`npm run boss:new -- 3513 --log WoWCombatLog-112526.txt`. Tudo do CUJ 2 no log local, mais o `replay:check`
com a forma medida, e o `sim:check`.

### CUJ 4: rodar de novo depois de mexer na regra

A mesma linha de comando: coleta e downloads vêm do cache; medidas e conferência refeitas.

## Technical Plan

### Etapas do `boss:new` (`scripts/boss-new.mjs`)

| Etapa | O que faz | Grava | Status |
|---|---|---|---|
| 1. coleta | Journal + spells (wago.tools), módulo do BigWigs, reports do WCL (`--tops`, `--wcl`) | `samples/boss/<slug>/sources.json`, `wcl-<código>/` | REVISAR sem Journal; ATENÇÃO sem BigWigs |
| 2. rascunho | regra nova em `encounters/<raide>/<slug>.yaml`; se a regra já existe e foi editada, `<slug>.draft.yaml` ao lado; recompila o `wipe-cli` | o YAML | REVISAR para cada mecânica "A revisar" e `needs_id` |
| 3. medição | `wipe-cli probe`: uma medida por forma que a mecânica já tem; mecânica sem forma ganha candidatos (raio em volta de quem lança, frontal); `probe units` | `measure.json`, `units.json` | candidatos de forma |
| 4. arena | confere a arena de `data/arenas.json` (`arena-check`, só com `--log`); sem arena, REVISAR com o caminho do `arena-fit --write` | — | REVISAR sem arena |
| 5. conferência | `replay:check` (forma, ids, queda) e `sim:check` (só com `--log`) | `samples/replay/`, `samples/sim/` | os dois relatórios |
| 6. relatório | junta tudo e esboça a auditoria | `samples/boss/<slug>/<data>.md` | pior status |

`--only <etapa>` roda só uma; `--fresh` ignora o cache. Sem log nenhum, as etapas 3 e 5 viram "pulado: sem
log"; a 4 só pula o `arena-check`.

### Coleta (`scripts/lib/bossSources.mjs`)

- **wago.tools** (`https://wago.tools/db2/<tabela>/csv`, cache em `samples/boss/.db2/`): `JournalInstance`,
  `JournalEncounter` (por `DungeonEncounterID`), `JournalEncounterSection` (árvore, `SpellID`, `IconFlags`,
  `DifficultyMask`), `SpellName`, `Spell` (descrição), `SpellEffect` (raio por `EffectRadiusIndex_*`,
  `Effect`, `EffectMiscValue_*`), `SpellRadius`, `SpellMisc` (duração e tempo de cast),
  `SpellDuration`, `SpellCastTimes`, `AreaTriggerCreateProperties` (só o tipo da forma: o tamanho do
  areatrigger fica no servidor). As tabelas grandes são lidas em fluxo e filtradas pelos ids do boss.
- **IconFlags do Journal** (bit → significado): 0 tank, 1 dano, 2 healer, 3 heroico, 4 mortal, 5
  importante, 6 interrompível, 7 magia, 8 maldição, 9 veneno, 10 doença, 11 enrage, 12 mítico, 13 sangramento.
- **BigWigs**: a busca de código do GitHub (`gh api search/code`, `SetEncounterID(<id>)` no repositório
  BigWigsMods/BigWigs) acha o arquivo, lido por `contents/<path>`; sem resultado, sem BigWigs (ATENÇÃO); do módulo saem `RegisterEnableMob` (npcs), `SetAuraData` (auras em player, tank),
  `GetOptions` (habilidades por fase) e os `self:Log("<evento>", ..., <ids>)` (evento → ids).
- **Warcraft Logs** (`--tops N`): as credenciais de `samples/wcl-credentials.env` ou do ambiente, como o
  `refresh`. Busca os N reports mais recentes com kill do boss (rankings do encounter na dificuldade) e baixa
  cada um com o `wcl-fetch.mjs`. Nenhum dado do usuário vai na consulta.

### Rascunho da regra (`scripts/lib/bossDraft.mjs`)

Uma mecânica por seção do Journal com `SpellID`, com a chave pelo nome em inglês. Preenche:
- `type`: `interrupt` (flag interrompível, com `cast_id`), senão `info`;
- `roles: [tank]` (flag tank), `severity` (mortal → `wipe`, importante → `major`, senão `minor`),
  `difficulty` (pelas flags heroico/mítico);
- ids por papel, vindos do BigWigs e do `probe ids` quando há log: `cast_id`, `damage_ids`, `aura_id`;
  sem id confirmado, `needs_id: true`;
- `units` com os npcs do `RegisterEnableMob` (`boss: true` no primeiro); os do `probe units` a skill acrescenta;
- `phases` pelos títulos "Stage"/"Intermission" do Journal (sem `hp`: a skill completa);
- `tip`/`message` `{ pt: "A revisar", en: "To review" }` e um comentário com o raio, a duração e o tipo de
  areatrigger do jogo ("dica, o log manda").

Regra editada à mão nunca é sobrescrita: o rascunho vai para `<slug>.draft.yaml`, que não é embutido. Enquanto o
arquivo começa com o cabeçalho `# RASCUNHO do \`npm run boss:new\``, ele é refeito a cada rodada (com os ids do log,
quando houver); a skill tira o cabeçalho ao começar a editar.

### Medidas (`wipe-cli probe`, `crates/wipe-core/src/probe.rs`)

```
wipe-cli probe <medida> <fonte>[,<fonte>...] --encounter <id> [--difficulty 16] [--json] [opções]
```

A fonte é um combat log ou uma pasta do `wcl-fetch` (os eventos do WCL viram as mesmas linhas pelo
`to_fields`). Um pull por vez na memória. Posições valem até 1,5 s.

| Medida | Opções | Saída |
|---|---|---|
| `ids` | — | por spell: casts (início/fim) por npc, auras aplicadas em players e em inimigos, acertos e dano em players por npc, invocações |
| `units` | — | por npc: unidades, % de linhas com posição, primeira linha e primeira posição, lugares onde nascem (grupos de 3 jd), vida mediana/máxima, % com `UNIT_DIED`, maior vão sem linha |
| `falloff` | `--damage <id>` ou `--all` | dano bruto (antes da mitigação) por faixa de 5 jd até quem lançou; Spearman; veredito `cai` / `não cai` / `incerto` |
| `pulse-radius` | `--damage`, `--aura` ou `--npc` | raio pelo Youden por pulso (acertos no mesmo ms × quem estava a até 25 jd e não tomou), TPR, FPR, n; com aura, por idade do debuff |
| `ahead` | `--cast`, `--damage` ou `--aura`, `--window` | onde cai em relação a quem lançou no fim do cast: R (na direção), lado, ângulo, p10/p50/p90 |
| `cone` | `--cast`, `--damage`, `--window` | meio ângulo e alcance pelo Youden (atingidos × não atingidos dentro do setor), TPR, FPR |
| `wave-dir` | `--aura` ou `--cast`, `--damage`, `--directions`, `--duration` | melhor base (eixos do mundo, direção de quem solta, do boss até ele) e ângulo, acertos explicados × ao acaso, `start`, `speed` (envelope por 250 ms), `width` |
| `pool` | `--cast`, `--damage`, `--duration` | por vez que o cast sai: até 2 círculos (centro, raio) pelo Youden em janelas de 1 s, atraso e duração dos ticks |

O `radius` de hoje continua (é o histograma).

Para o `replay:check` medir a forma num report do WCL: `wipe-cli wcl <pasta> --fight <report>:<fight>` dá o
replay completo do pull (o mesmo do `fight` no log local; `WclAnalyzer::begin_replay`).

### Conferência (`scripts/replay-check.mjs` + `scripts/lib/shapeFit.mjs`)

1. **Ids pelo papel** (pelo `probe ids`): `cast_id` tem que aparecer como cast de inimigo; `area.aura`,
   `aura_id`, `waves.aura` como aura (em player ou inimigo); `damage_ids` como dano em player. Id que não aparece
   no log não é julgado. Id que não aparece no papel
   → REVISAR ("o id 1290809 é cast, a regra usa como aura").
2. **Queda com a distância** (pelo `probe falloff --all`, até quem lança): mecânica sem forma cujo dano cai →
   ATENÇÃO ("tem forma?"); área em volta da unidade (`area.npc`) cujo dano não cai → ATENÇÃO (premissa 10). A área
   no portador fica fora (o centro é outro).
3. **Forma medida** (`shapeFit.mjs`, nos 6 pulls mais longos, pelo `wipe-cli fight`): para cada mecânica com
   forma, nos instantes em que a forma está no mapa, acertos do dano da mecânica dentro (TPR) e players que
   não tomaram dentro (FPR). Formas: soak e explosão (círculo no `at`), poça (círculos de `on` a `to`, por
   segundo), área (em volta de quem tem a aura ou da unidade, por segundo), onda (faixa na frente da onda),
   cone (setor no fim do cast, na direção do alvo ou do `facing`). Marca de chão fica de fora (sai dos
   próprios acertos). Com 20 acertos ou mais: REVISAR se TPR < 0,6 ou (com 20 ou mais que não tomaram) FPR > 0,5;
   ATENÇÃO se TPR < 0,8. Soak sem lançador e explosão são "derivados" (o centro vem de quem tomou): só o FPR
   conta.
4. **Melee** (spell 1) fora da lista de casts sem regra.

### Arena (`scripts/arena-fit.mjs`)

- `--write`: grava o resultado em `data/arenas.json` com os nomes certos (`url` → `image`, `score` → `fit`,
  `sPx`/`u0`/`v0`/`cx`/`cy` → `pxPerYd`/`anchorPx`/`anchorAt`), preservando `marks`, `offFloor`,
  `anchored` e `rotation` à mão.
- `--anchors <arquivo.json>`: pares `{ log: [x, y], px: [u, v] }` (lugares que o log fixa × lugar na imagem);
  semelhança com giro livre por mínimos quadrados, depois refino pelas paredes. Giro fora de múltiplo de 90°
  grava `rotation` e `anchored: true`. Os candidatos de lugar saem do `probe units` (onde cada npc nasce).
- A imagem continua à mão (a URL `cdn.raidplan.io/raid/.../map/...jpg` nos recursos do editor do raidplan.io):
  o `boss:new` não roda o encaixe; sem arena, a etapa 4 dá REVISAR com o caminho do `arena-fit --write`.

### Histórico por data (`history`, `crates/wipe-core/src/rules.rs`)

```yaml
- key: coiling_ichor
  area: { aura: 1290814, radius: 12 }
  history:
    - until: "2026-11-07T15:00:00Z"   # nerf de 07/11
      area: { aura: 1290814, radius: 15 }
```

Num pull que começa antes de `until` (UTC), os campos da entrada substituem os da mecânica, depois dos
`overrides` da dificuldade. Com várias entradas, vale a de menor `until` que ainda está depois do pull.
`key`, `type` e `history` não podem estar numa entrada (erro na carga). O `mechanics_for` ganha a hora do pull.

### Skill `boss-new` (`.claude/skills/boss-new/SKILL.md`)

Roda o `boss:new`, lê o relatório e resolve os REVISAR na ordem das etapas: ids e tipos (com a `boss-rules`),
formas a partir dos candidatos medidos (com a `replay-build`), arena, simulação (com a `sim-calibrate`). As
três skills continuam para mexer num boss que já existe.

## Alternatives Considered

- **Medidas em JS sobre o JSON do `fight`.** Não há os eventos crus (dano bruto, todos os ticks, auras de
  inimigos) e o JSON só tem posições nos trechos do replay. O núcleo em Rust já lê log e WCL do mesmo jeito.
- **Rascunho fora de `encounters/`.** O `replay:check` e as medidas precisam da regra embutida; com textos "A
  revisar" nas duas línguas, os testes de texto passam e o boss aparece no app só depois do REVISAR.
- **Hotfix campo a campo (`radius_before`, ...).** Um campo por forma; o `history` genérico serve para
  qualquer campo e para nerfs de dano/contagem.
- **Ler o Journal do Wowhead.** Página montada em JS e sem as flags; o wago.tools dá as tabelas do jogo em CSV.

## Non-Functional Requirements

- Nada pessoal em requisições externas (User-Agent genérico `wipe-cause-dev`, sem nome de guilda ou player).
- Credenciais do WCL só do ambiente ou de `samples/wcl-credentials.env`.
- Cache de tudo que vem de fora; segunda rodada sem rede quando nada mudou.
- `probe` lê um log de 1 GB em menos de 2 minutos no release (um pull por vez na memória).
- Textos novos do app: nenhum. Relatórios em pt-BR, como os outros processos padrão.

## Detailed Implementation Plan

1. **`probe.rs` + CLI** (`crates/wipe-core/src/probe.rs`, `lib.rs`, `bin/wipe-cli.rs`): fonte comum (log e
   WCL), as oito medidas, `--json`; `wipe-cli wcl <pasta> --fight`. Testes com linhas sintéticas.
2. **`history`** (`rules.rs`, chamadas de `mechanics_for`): campo, validação na carga, aplicação pela hora do
   pull; testes; `references/schema.md`.
3. **Coleta e rascunho** (`scripts/lib/bossSources.mjs`, `scripts/lib/bossDraft.mjs`): com testes do parser
   de CSV, do módulo do BigWigs e do rascunho (Vitest, dados sintéticos).
4. **Arena** (`scripts/arena-fit.mjs`): `--write` e `--anchors`.
5. **Conferência** (`scripts/replay-check.mjs`, `scripts/lib/shapeFit.mjs`): ids, queda, forma, Melee (spell 1) fora dos casts sem regra; teste
   do `shapeFit` com pulls sintéticos.
6. **`boss:new` e skill** (`scripts/boss-new.mjs`, `package.json`, `.claude/skills/boss-new/`), docs
   (`CONTRIBUTING` nas duas línguas: Processos padrão; `replay-methods.md`: Ferramentas; skills
   `boss-rules`/`replay-build`: apontam para o `probe` e para a `boss-new`).

### Verification Plan

- `cargo test -p wipe-core`, `npx vitest run`, `npm run typecheck`.
- **As medidas reproduzem as auditorias** (logs locais de 29/09 e 06/10 do Vashnik, Twin Fangs de 01/10,
  Ula'tek de 16/11):
  - `pulse-radius` Plague Froth (1281925, aura 1281913) ≈ 5 jd; Coiling Ichor (aura 1290814) ≈ 12 jd;
  - `ahead` Stone Breaker (cast 1288538) R ≈ 25 jd; Spectral Coils (cast 1299010) R ≈ 22 jd;
  - `wave-dir` Plague Wave (1295798, aura 1281913): eixos do mundo, φ ≈ 0, speed ≈ 12,3 jd/s;
  - `falloff` Caustic Explosion (1295209): não cai.
- `replay:check` nos bosses já auditados: forma com TPR ≥ 0,8 nas formas medidas (Plague Froth, Coiling
  Ichor, Stone Breaker, Spectral Coils); nenhum Melee nos casts sem regra.
- `npm run boss:new -- 3513`: regra do Kith'ix rascunhada sem log, testes do núcleo passam com ela.
- `npm run boss:new -- 3492 --log <Ula'tek 16/11>` roda as seis etapas sem erro, sem sobrescrever o
  `ulatek.yaml` (gera o `.draft.yaml`).

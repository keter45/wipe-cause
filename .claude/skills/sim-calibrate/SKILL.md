---
name: sim-calibrate
description: Configura e confere a simulação (o robô do SimulationCraft) de um boss — o modelo da luta que o robô joga (movimento, alvos e adds, vida por fase e execute, tempo sem alvo, Bloodlust) — a partir de um log da noite, com o `npm run sim:check`. Use quando o usuário disser que o resultado do robô "ficou longe do esperado", pedir para "calibrar a simulação", "configurar a simulação do boss", "conferir o robô", depois de cadastrar um boss novo ou uma raide nova, depois de mudar o modelo em src/lib/simProfile.ts, ou colar um trecho de samples/sim/*.md.
---

# sim-calibrate

O robô joga **o modelo da luta**, e não o player: a mesma luta para todo mundo da raide, tirada do log.
O `npm run sim:check` faz sozinho tudo o que é número: simula a raide inteira do boss, com o mesmo
código do app (`src/lib/simProfile.ts`), compara com o que cada um fez e escreve o relatório em
`samples/sim/<data>-<boss>.md`. Esta skill cuida do que o script não decide: **por que** o modelo
erra num boss e **onde** corrigir. As regras completas da simulação estão em `docs/simulation.md`.

## O que já é automático (não configure à mão)

Tudo sai do log de cada pull, e cada peça tem a sua medida:

| Peça | De onde vem | Onde está |
|---|---|---|
| Pull simulado | kill → o mais longo sem morrer → o de mais tempo vivo | `pickSimPull` |
| Janela | até a morte, a call de wipe ou o corte de N mortes (o app usa 4) | `playedMs` |
| Movimento | a cada 30s, o quartil dos DPS que menos andaram (`moveTimeline` do núcleo) | `fightMovement`, `movementEvents` |
| Alvos e adds | o quantil 75% dos alvos que os DPS acertaram a cada 2s (`rotation.targets`) | `raidTargets`, `targetWindows` |
| Tempo sem alvo | trechos com 0 alvos → `invulnerable` | idem |
| Vida e execute | a vida do alvo da vez a cada 5s (`bossHpTimeline`: a fase da regra do boss ou o boss mais baixo); a reta do robô acerta o tempo abaixo de 20% e de 35% | `bossEndPct` |
| Bloodlust, Power Infusion | os buffs recebidos no pull, nos mesmos segundos | `buildSimProfile` |
| Buffs de raide | as classes do pull | idem |

A vida por fase depende das **fases na regra do boss** (`encounters/<raide>/<boss>.yaml`, campo `phases` com os npcs de cada fase). Boss de várias barras sem `phases` cai no "boss mais baixo", que erra quando um boss sai de cena sem morrer. Nesse caso, quem resolve é a skill `boss-rules`.

## Fluxo

1. **Ferramentas**: `cargo build --release -p wipe-core --bin wipe-cli` (o script analisa o log com ele) e o SimC do app (`<dados do app>/simc/simc.exe`, baixado na primeira simulação; ou `WIPE_SIMC_EXE`).
2. **Relatório**: `npm run sim:check -- <WoWCombatLog.txt> --boss "<nome>" --difficulty Mythic` (sem `--boss`, vale o boss com mais pulls). `--iterations 300` deixa mais rápido para iterar; o número final é com 1000, como o app. `--cutoff N` só se o usuário usa outro "ignorar após N mortes" (padrão: 4).
3. **Ler** `samples/sim/<data>-<boss>.md`: o status, os itens **REVISAR**/**ATENÇÃO**, a tabela por player e "O que o robô jogou" (fases, vida no fim, execute, Bloodlust, movimento por trecho, alvos). Compare "O que o robô jogou" com o guia da luta (o mesmo que a `boss-rules` usou): ondas de adds, intermissions, quanto a luta faz andar.
4. **Resolver cada item** (abaixo). Prefira corrigir a **medida** (núcleo ou regra do boss) a mexer nas constantes; constante muda **todos** os bosses.
5. **Validar**: `cargo test -p wipe-core`, `npx vitest run`, `npx tsc --noEmit -p .`; rode o `sim:check` de novo no boss **e em pelo menos um outro boss ou noite** (uma mudança no modelo não pode piorar os outros). Anote os números em `docs/simulation.md` ("Conferido em …": antes → depois, por boss).
6. **Mostrar ao usuário** os relatórios antes/depois. Commit e release só com o "pode subir" dele.

## Cada tipo de item

- **"Mediana dos DPS em X% do robô"** (fora de 85–105%): o modelo da luta inteiro está fácil ou difícil demais.
  - Abaixo de 85% (robô forte demais): o robô anda pouco (o movimento por trecho é bem menor que o guia sugere?), tem alvos de mais, ou fica em execute demais (compare a linha **Execute** com as fases). Fase sem alvo que não virou `invulnerable` (intermission em que o boss some) também infla o robô.
  - Acima de 105% (robô fraco): a luta tem mais alvos do que o modelo viu (adds curtos abaixo de 6s somem: `MIN_EVENT_MS`), ou o robô anda demais.
  - Confira o movimento medido: `moveTimeline` é a distância entre posições ÷ 7 jd/s; trechos sem posição por mais de 3s não contam.
- **"<player> fez X% do robô"** acima de 110%: o robô está fraco para essa spec.
  - A mesma spec fica alta em **outros bosses** também → é a APL da spec no SimC, não o nosso modelo. Anote em `docs/simulation.md` e não mexa no modelo.
  - Só neste boss → quase sempre adds e cleave: specs de DoT e cleave (Affliction, Balance, Destruction, Havoc, Subtlety, Arcane) passam o robô quando a luta tem ondas de adds que o modelo achata em "2 alvos". Compare as janelas de **Alvos** com as ondas do guia (quantos adds, quanto tempo vivos).
  - Execute: spec com execute forte acima do robô e a linha **Execute** sem tempo abaixo de 20% → a vida por fase não está chegando (`bossHpTimeline` vazio: análise antiga, ou boss sem `phases`).
- **"<player> fez X% do robô"** abaixo de 70% (**ATENÇÃO**): em geral é o player. Só é o modelo se a spec inteira ficar baixa em vários bosses.
- **"O SimC não rodou o perfil"**: o perfil está em `samples/sim/.cache/run/<player>/input.simc`. Rode o `simc.exe` nele e leia o erro (item, talento ou opção que o SimC não conhece).
- **"Perfil sem o movimento medido"**: o `wipe-cli` é anterior ao `moveTimeline`. Recompile e rode de novo.
- **Tank e Augmentation** aparecem só como contexto: o dano do tank depende de pegar os adds, e o da Augmentation vai nos outros. Não calibre por eles.

## Onde mexer

- **Medidas no núcleo** (`crates/wipe-core/src/analysis.rs`): `moveTimeline` (movimento), `bossHpTimeline` (vida do alvo da vez), os alvos por player (`rotation.targets`). Uma medida errada (ex.: posição que pula, boss que some sem morrer) se corrige aqui, com teste.
- **Regra do boss** (`encounters/…`, skill `boss-rules`): `phases` com os npcs de cada fase alimenta a vida por fase e as fases do relatório.
- **Constantes do modelo** (`src/lib/simProfile.ts`): `MOVE_QUANTILE`, `MOVE_CHUNK_MS`, `MOVE_BOUT_S`, `TARGET_QUANTILE`, `TARGET_SMOOTH`, `MIN_EVENT_MS`, `EXECUTE_PCTS`. Mudam todos os bosses: só com o `sim:check` de dois ou mais bosses melhorando.
- **Ficha "O que o robô jogou"** (`src/lib/botView.ts`, `src/components/perf/BotParts.tsx`): ela lê o perfil salvo. Se o perfil ganhar um evento novo, a ficha precisa saber ler (e as simulações antigas continuam aparecendo).

## Regras

- O robô nunca usa o movimento ou os erros do próprio player: é o mesmo modelo para a raide toda.
- Não calibre para "o player parecer melhor": o alvo é a luta, medida no log. Um player acima do robô depois de um modelo certo é informação, não erro.
- Textos na tela sempre em pt-BR e inglês na mesma mudança; nomes de spells e bosses em inglês.
- As simulações salvas no app não se refazem sozinhas: depois de uma mudança no modelo, o usuário precisa de "Reanalisar o log" (medidas novas do núcleo) e "Simular todos de novo". Diga isso nas notas da release.

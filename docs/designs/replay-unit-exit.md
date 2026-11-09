# Saída do replay para unidade que o log nunca mata (ovos do Ula'tek)

* **Author:** @keter45
* **Status:** Implemented (RFC do `/egm:egm-brainstorm`, aprovado pelo usuário em 09/11 sem o `/egm:egm-draft`)
* **Date:** 2026-11-09

## Overview

No Ula'tek mítico, os ovos com casca (Blightscale Spawn, npc 265644 e 268121) têm posição no log, mas nunca têm
`UNIT_DIED`. Se entrarem no replay hoje, ficam no mapa até o fim do pull. O `lifetime_s` fixo não serve, porque
a vida vai de 0 a 82 s.

A proposta cria dois campos em `units`, com nome genérico. O boss é dado, como diz o princípio do motor em
`docs/replay-methods.md`. Por enquanto só o `ulatek.yaml` usa os campos:

1. **Sair na última linha do log que cita a unidade.** Esse sinal serve para os quatro jeitos de o ovo sair
   (pego, quebrado, Writhing Gestation, choca).
2. **Sair antes, quando um player perto ganha uma aura.** É a Noxious Shell 1307612 de quem pega o ovo. O corte
   só vale se a última linha do ovo vier até 3 s depois da aura.

Quem usa: quem abre o replay para ver onde estavam os ovos e quem pegou cada um. Pedido do usuário: o ovo precisa
sumir o mais rápido possível depois de sair do jogo.

## Analysis

Medido no log local de 05/11 (1 pull, 8 ovos) e nos reports do WCL pRJD (kill, 72 ovos) e DVYR (6 pulls, 272 ovos):

- **"N s sem linha" (`idle_s`) não serve.** Um ovo fica até 22 s sem nenhuma linha e depois é pego. Com N < 23 s,
  o ovo some ainda no chão. Com N ≥ 23 s, todo ovo pego fica 23 s a mais no mapa. Como a análise vê o pull
  inteiro, a última linha resolve isso sem N.
- **Como o ovo sai do log:**
  - **Pego:** um player ganha Noxious Shell.
  - **Quebrado:** vira Rawling (261874), que aparece 1 a 3 s depois.
  - **Writhing Gestation do Warden:** vira Blightscale Clutch (263535). São 6 ovos e, 1,2 s depois, 6 Clutches.
  - **Choca:** vira Viper (261915). Não houve caso nesses logs.
  - Nos casos de quebra e de Gestation, a última linha vem antes do add que nasce, então esperar o add só
    atrasaria o corte.
- **O ovo pego fica cerca de 2 s a mais com a última linha sozinha.** No log local, depois da Shell o ovo para
  no lugar, mas continua tomando ticks de DoT por mais 1,6 a 2,5 s. Esses ticks trazem a posição dele. Por isso
  a última linha e a última posição chegam juntas, de 1,6 a 2,7 s atrasadas. No WCL, que descarta
  `SPELL_ABSORBED`, o atraso cai para 0,3 a 0,9 s. O log local é a fonte principal do app, então só a aura
  chega a menos de 1 s.
- **A Shell não diz qual ovo foi pego.** A origem do `SPELL_AURA_APPLIED` 1307612 é a Ula'tek (vehicle 257758),
  não o ovo. A ligação tem que ser pela distância:
  - log local: de 2,3 a 4,8 jd;
  - WCL: mediana de 6 a 8 jd e máximo de 15 jd, porque ali a posição é esparsa.
  Os ovos nascem em grupos de 6 a 8. Os revisores apontaram que um ovo que some cedo engana mais que um que fica
  1 s a mais (princípio 10). Por isso a ligação é de um para um, e a trava dos 3 s corta só ovos que já iam sumir
  de qualquer jeito. Se a ligação errar, o ovo errado some no máximo 3 s antes da última linha dele, e o ovo
  certo sai na própria última linha.
- **Ovo vivo no wipe.** O ovo que ninguém toca até o fim some na última linha, ainda no chão. No DVYR, 3 de 272
  ovos estão a menos de 20 s do fim. O erro é aceito e fica registrado na auditoria.
- **Ovo sem posição.** 117 de 272 no DVYR e 29 de 72 no pRJD não têm posição. Continuam fora do mapa, como hoje.
- **Encaixe no código** (apontado pelos revisores):
  - o laço `unit_clears` (`analysis.rs` ~2256) já calcula o mínimo entre `cleared_by` e `lifetime_s` e chama
    `on_enemy_died` antes do `build`. Os critérios novos entram nesse mínimo. O `cut_after` não é necessário;
  - a última linha reaproveita o `seen` do `PullBuilder`. O npc entra em `seen_npcs`, e falta guardar o último ms
    em que a unidade foi vista;
  - não existe hoje uma lista de "player ganhou aura X em t" nesse caminho. Ela é nova, no `feed`;
  - o filtro `then_some` em `rules.rs:547` e o mapeamento em `rules.rs:999-1008` precisam aceitar os campos novos.
    São duas entradas em `units`, uma por npc;
  - desktop, web/WASM e WCL usam o mesmo `PullBuilder`, então a paridade vem de graça.
- **O `replay:check` não mede isso hoje.** O check precisa de um item novo: "unidade no mapa mais de 1 s depois da
  saída esperada".

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Campo `units.until_last_line: true`: a unidade sai na última linha do log que a cita, como source ou como dest,
    em qualquer evento.
  * Campo `units.cleared_by_aura: { aura, radius, within_s }`: a unidade sai na hora em que um player a até
    `radius` jd dela ganha `aura`, se a última linha dela vier até `within_s` s depois. Cada aura tira no máximo
    uma unidade: o ovo livre mais perto.
  * Vale o que vier antes entre todos os critérios: `UNIT_DIED`, `cleared_by`, `lifetime_s`, `until_last_line` e
    `cleared_by_aura`.
  * `ulatek.yaml`: os dois ovos em `units`, com `replay: true`, `color`, `icon` e os campos novos. Cada valor leva
    um comentário com a origem (data, logs, n).
  * `replay:check`: item novo que avisa unidade no mapa mais de 1 s depois da saída esperada.
  * `replay-methods.md` (item "Unidade que o log nunca mata") e a auditoria do Ula'tek atualizados. O item "Ovos no
    chão" sai de "Fora, e por quê".
  * Testes sintéticos no `PullBuilder`:
    * corte na última linha;
    * corte pela aura;
    * aura sem linha dentro da janela não corta;
    * dois ovos perto de uma aura: sai um só;
    * vale o mínimo com `lifetime_s`;
    * parse dos campos novos.
* **Out-of-Scope Non-Goals:**
  * Ovos sem posição (o heroico e os que ninguém toca no mítico).
  * Mostrar o ovo preso no player depois de pego. A área de 3 jd do Noxious Splash já existe.
  * Ligar o ovo ao add que nasce dele (Rawling, Clutch ou Viper).
  * Aplicar os campos a outros bosses (o orb do Twin Fangs fica como está).
  * Modo ao vivo: a análise ao vivo não vê o futuro, então os dois critérios só valem com o pull fechado.

## Key Decisions & Staging for Next Steps

0. **Escopo (decidido pelo usuário em 09/11):** `until_last_line` e `cleared_by_aura` entram juntos, na mesma feature.
   Só a última linha deixaria o ovo pego ~2 s a mais no mapa com o log local.
1. **Critério de pronto.** Nos pulls do log local de 05/11, do pRJD e do DVYR:
   * nenhum ovo pego fica no mapa mais de 1 s depois da Shell;
   * nenhum outro ovo fica mais de 1 s depois da última linha;
   * o `replay:check` do Ula'tek fica OK nesse item.
2. **`radius` e `within_s`.** Valores propostos: `radius: 15`, o máximo medido no WCL, e `within_s: 3`, inclusivo,
   como campo do yaml. Como cada aura tira um ovo só, o raio grande não apaga vizinhos.
3. **Campos soltos no `UnitClearDef`.** Entram ao lado de `cleared_by` e `lifetime_s`, sem bloco `exit:`, para não
   criar dois estilos nem obrigar a migrar o Twin Fangs.
4. **Design:** `docs/designs/replay-unit-exit.md`, no modelo do `gloombomb-assignment.md`, com linha no SITEMAP.
   A seção "Os números" aponta para a auditoria.
5. **Para o `/egm:egm-draft` definir:**
   * se `AURA_REMOVED` no mesmo ms do fim do pull conta como linha;
   * se a saída pela Shell desenha um anel de "pego" numa camada.

## Implementação (09/11/2026)

O usuário pulou o `/egm:egm-draft` e pediu a implementação a partir deste RFC.

- `crates/wipe-core/src/rules.rs`:
  - `UnitClearDef` / `UnitClear` ganharam `until_last_line` e `by_aura` (`AuraClear { aura, radius, within_ms }`),
    lidos de `until_last_line` e de `cleared_by_aura: { aura, radius, within_s }`.
  - Teste novo: `ulatek_eggs_leave_on_last_line_or_on_the_shell`.
- `crates/wipe-core/src/analysis.rs`, no `PullBuilder`:
  - **Última linha.** Guarda a última linha (rel ms) de cada unidade desses npcs, como source ou dest. Não conta
    `SPELL_AURA_REMOVED`. Vale também no `analyze`, sem `capture_fight`.
  - **Aura.** Guarda onde estava cada player que ganhou a aura, com a posição de até 3 s
    (`AURA_CLEAR_POS_MAX_AGE_MS`).
  - **Ligação aura → ovo.** `match_aura_clears` percorre as auras por ordem de tempo. Cada uma tira a unidade
    livre mais perto, até `radius`, cuja última linha vem até `within_ms` depois.
  - **Corte.** O laço `unit_clears` tira a unidade no menor tempo entre `cleared_by`, `lifetime_s`, a última
    linha e a aura.
  - Teste novo: `aura_de_quem_pegou_tira_um_ovo_so_e_so_se_ele_some_logo_depois`.
- `encounters/venomous-abyss/ulatek.yaml`: os dois ovos em `units`, com `replay`, cor, ícone e os campos novos.
- Docs: `docs/replay-methods.md`, `docs/ulatek-replay-audit.md` e as skills `replay-build` e `boss-rules`
  (`references/schema.md`).

**Conferido:**

- **Log local de 05/11:** os 8 ovos saem do mapa entre 0,05 e 0,2 s antes da Shell, por causa do arredondamento
  do passo de 250 ms. Cada Shell ficou ligada ao ovo que estava a 2,3-4,8 jd do player.
- **WCL:** saíram na Shell 9 de 25 ovos no mapa no pRJD e 69 de 125 no DVYR. O resto sai na última linha ou no
  fim da janela do replay.

**`replay:check`:**

- `UnitTrack` ganhou `lastLine` e `pickedAt`, opcionais, em `report.rs` e em `src/types.ts`.
- O `scripts/replay-check.mjs` dá REVISAR quando uma unidade fica no mapa mais de 1 s (`EXIT_SLACK_MS`) depois
  da primeira dessas horas. Em "Unidades no mapa", ele mostra quantas foram tiradas pela aura.
- Resultado:
  - log local: 8 ovos, 8 tirados pela aura, 0 atrasados;
  - WCL DVYR e pRJD: 150 ovos, 106 tirados pela aura, 0 atrasados.

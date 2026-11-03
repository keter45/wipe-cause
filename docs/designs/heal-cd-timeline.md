# Timeline dos CDs de cura: buracos na cura e CDs que renderam pouco

*   **Author:** Vinicius Andrade (@keter45)
*   **Status:** Implemented
*   **Date:** 2026-11-03

Convenção: títulos e rótulos do template EGM ficam em inglês; o resto, em
português. Nomes de spell e de boss ficam em inglês.

--------------------------------------------------------------------------------

## Overview

Continuação de [heal-cd-note.md](heal-cd-note.md) (Implemented, v0.44.0). Aquela
feature confere a note de CDs de cura que o líder cola (timing, golpes, uso,
overheal, note sugerida) e mostra o resultado em tabelas e listas na seção
"CDs de cura" do resumo do boss na noite e na aba "CDs de cura" do pull.

Esta feature troca o principal da seção por um **gráfico de linha do tempo**
e acrescenta uma checagem:

1.  **Timeline:** em cima, a curva do dano inevitável que a raide tomou por
    segundo, a faixa de raide baixa e os golpes do boss com ícone; embaixo,
    uma linha por healer (cor da classe) com uma barra por uso de CD de cura
    ou de redução de dano. A cor da barra separa cura útil de overheal, e o
    veredicto do uso aparece em cima da barra.
2.  **Buraco na cura:** trecho em que a raide tomou dano alto ou ficou baixa
    e nenhum CD estava ativo, também fora dos golpes que a feature anterior já
    detecta.

A timeline funciona **sem note colada**: usa todos os casts de CD da tabela
`data/heal-cooldowns.json`. Com note, as linhas da note e os veredictos dela
entram por cima do mesmo gráfico. As tabelas de hoje continuam, recolhidas,
como detalhe.

Termos (os mesmos de [heal-cd-note.md](heal-cd-note.md#overview)): **golpe**
(dano inevitável em 5 s ≥ `STRONG_HIT_SHARE` = 0,80 da vida máxima da raide
sem tanks), **raide baixa** (um quarto ou mais dos vivos sem tanks abaixo de
50% por 2 s ou mais), **momento** (golpe que se repete pela mesma skill do boss
em 2 ou mais pulls da noite), **CD ativo** (o intervalo em que o efeito do CD
vale, pela janela do tipo de efeito `active`, `sustained` ou `burst`).

## The Problem

A análise da note responde "a note funcionou?", mas a tela atual tem três
limites:

*   **A resposta está em texto.** Para ver se havia dano quando um CD saiu, o
    líder lê uma tabela por linha da note e uma lista de momentos e monta a
    linha do tempo de cabeça. O que ele quer ver é o que o Warcraft Logs mostra
    no gráfico de dano tomado, com os CDs por cima: onde o dano entrou e onde
    não havia CD. O usuário prefere um visual a texto (pedido do
    desenvolvedor, 2026-11-03).
*   **Sem note, não há nada.** O painel mostra só "cole a note". Uma guilda que
    ainda não escreveu a note, um pug, ou uma noite em que o líder não colou o
    texto não têm análise de CDs, embora o log tenha todos os casts.
*   **Dano abaixo do golpe passa sem aviso.** O golpe pede 80% da vida da raide
    em 5 s. Um trecho com dano alto, mas abaixo disso, sem nenhum CD ativo,
    não aparece em lugar nenhum, a não ser que a raide fique baixa ("raide
    baixa sem golpe"). Esses trechos são onde um CD que estava parado (ou
    gasto longe do dano) faria diferença.

Dois riscos a evitar:

*   **Dois julgamentos para o mesmo uso.** A feature anterior já tem "sem
    dano", "overheal alto" (acima do p75 das referências de fora +
    `OVERHEAL_MARGIN`) e "empilhado". Um "CD desperdiçado" com limite próprio
    daria duas respostas para o mesmo uso. Aqui, "desperdiçado" é só como esses
    veredictos aparecem na barra; não há limite novo para ele.
*   **Buraco que vira ruído.** O dano de fundo já é alto (em 5 s a raide toma,
    na mediana, 49% da própria vida máxima, e 86% no p95; noite de 26/10, The
    Coiled Altar Mythic). Com limite baixo, quase toda a luta é buraco; com
    limite perto de 0,80, o buraco repete o golpe. O limite é um parâmetro da
    luta calibrado nos logs da guilda, como o do golpe (G10 da feature
    anterior).

## Goals

*   **G1. Timeline como principal.** A seção "CDs de cura" abre no gráfico; o
    texto se limita a legenda, rótulos curtos e dica ao passar o mouse. As
    tabelas de hoje ficam num bloco recolhido, fechado por padrão.
*   **G2. Sem note.** Com qualquer pull que tenha casts de CD da tabela, a
    timeline aparece com todos os usos, o veredicto de uso de cada um ("sem
    dano", "overheal alto", "empilhado") e os buracos. A caixa da note continua
    lá para colar.
*   **G3. Com note.** Cada linha da note aparece como marca na linha do healer
    (hora ajustada pelo desvio de fase); o estado de timing e "no golpe" da
    linha ficam na marca e na barra do uso casado. Sem mudar os estados nem os
    veredictos de [heal-cd-note.md](heal-cd-note.md).
*   **G4. Cura útil × overheal na barra.** A barra de cada uso mostra a fração
    de overheal (de `cdHeals`, na janela do "sem dano"). Redução de dano e CD
    sem `heal_ids` ficam numa cor só, sem fração.
*   **G5. Buraco.** Trecho de pelo menos `GAP_MIN_S` segundos em que o dano em
    5 s passa de `GAP_SHARE` da vida máxima da raide, ou a raide está baixa, e
    nenhum CD da tabela (de qualquer player, com ou sem note) está ativo.
    `GAP_SHARE` e `GAP_MIN_S` saem de calibração nos logs da guilda e são
    aprovados pelo desenvolvedor.
*   **G6. Noite e pull.** Na aba do pull, a timeline é daquele pull. No resumo
    da noite, a timeline é de um pull escolhido numa fileira de pulls (padrão:
    o pull que foi mais longe), e os buracos que se repetem pela mesma skill do
    boss aparecem com "em X de Y pulls".
*   **G7. Ligado ao replay.** Clicar num buraco, golpe ou uso na aba do pull
    abre o Replay naquele instante, onde o replay completo está disponível
    (mesma regra do ▶ de hoje).
*   **G8. Regras do projeto.** Qualquer boss, sem nada específico de um boss no
    código; healers da guilda nunca são a referência do "certo" (a régua de
    overheal continua em `src/data/heal-refs`); textos em pt-BR e inglês;
    ícone e nome em toda habilidade, cor da classe em todo player, sem faixa
    lateral colorida ([regra 5](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).

## Non-Goals

*   **Mudar os estados e veredictos existentes** (timing, "no golpe",
    "overheal alto", "empilhado", uso de ciclo, note sugerida). A exceção é o
    "sem dano", que passa a exigir também nenhum dano alto na janela, com a
    note e sem ela (decisão do desenvolvedor depois da calibração, 2026-11-03;
    ver [Open Questions](#open-questions)).
*   **Campo novo no núcleo:** tudo sai de `raidSeries`, `enemyHits`,
    `cdHeals` e `casts`, que o relatório já tem.
*   **Sugerir CD para o buraco** na note sugerida: o buraco aparece no gráfico;
    "adicionar linha" continua só para golpe sem CD.
*   **Externos em tank, `glowunit`, formato MRT clássico:** continuam fora,
    como em [heal-cd-note.md](heal-cd-note.md#non-goals).
*   **Cura total do healer fora dos CDs** (HPS por segundo): a timeline mostra
    dano e CDs; a cura de fundo não entra.
*   **Timeline na Evolução, no Discord ou na nota do pull.**

## Open Questions

*   **`GAP_SHARE` e `GAP_MIN_S` — fechada (2026-11-03): 0,60 e 3 s.**
    Calibração com `scripts/heal-note-calibrate.mjs --gap-shares --gap-min`
    em três noites de The Coiled Altar Mythic (26/10, 18 pulls; 28/10, 18;
    29/10, 16). Critério: mediana de 1 a 4 buracos por pull e no máximo 25% de
    buracos sem evidência de dano.
    *   **Primeira régua de evidência** (morte ou raide baixa, um quarto dos
        vivos abaixo de 50%): de 65% a 82% dos buracos ficavam sem evidência
        em qualquer par de 0,50 a 0,80, inclusive nos golpes de 0,80. A régua
        era dura demais: a cura de fundo segura a raide acima do episódio de
        raide baixa, mas não sem ninguém cair abaixo de 50%.
    *   **Régua adotada:** morte não ignorada, ou `EVIDENCE_LOW` = 2 ou mais
        players abaixo de 50%, em `[início, fim + RECOVER_MS]`. Com 0,60 e 3
        s: 1 buraco por pull na mediana nas três noites (p90 1–2), 2 ou 3
        buracos da noite, e 22%, 25% e 37% sem evidência (26, 28 e 29/10). Com
        0,70 os números quase não mudam; 0,60 fica por pegar o trecho entre o
        p75 (0,58) e o golpe.
    *   **"Sem dano" alinhado:** com a regra da v0.44 (nenhum golpe nem raide
        baixa na janela), 21% a 36% dos usos de CD de cura saíam "sem dano"
        (78 a 136 por noite), e cerca de 70% deles tinham dano acima de 0,60
        na janela. O "sem dano" passa a exigir também nenhum dano alto
        (`highDamage`, `Wt` ≥ `GAP_SHARE`), na timeline e no veredicto da note
        (decisão do desenvolvedor): 23 a 40 por noite, quase todos de CDs de
        throughput usados no cooldown (Convoke the Spirits, Divine Hymn,
        Apotheosis, Avenging Wrath).
*   **"Ciclo provável" sem note — medido.** Com o "sem dano" alinhado, a regra
    tira 41, 28 e 39 usos do "sem dano" nas três noites (de 64, 68 e 70). Com
    redução de cooldown por talento ela deixa de reconhecer alguns ciclos;
    nunca acusa mais do que o "sem dano" já acusaria.

## Critical User Journeys (CUJs)

### CUJ 1: Ver os buracos da noite sem note

*   **Given:** uma noite com 8 pulls do mesmo boss no foco Guilda, log com
    advanced logging, nenhuma note colada.
*   **When:** o líder abre o resumo do boss e a seção "CDs de cura".
*   **Then:** a timeline do pull que foi mais longe aparece aberta, com o dano
    da raide, a raide baixa, os golpes e uma linha por player com as barras
    dos CDs; os buracos aparecem como colunas vermelhas; abaixo do gráfico, os
    buracos que se repetem (ícone da skill do boss, "em 5 de 8 pulls"), cada
    um com os ícones dos CDs que estavam livres. Trocar de pull na fileira
    redesenha a timeline.

### CUJ 2: Um CD que rendeu pouco

*   **Given:** a aba "CDs de cura" de um pull em que o Tranquility saiu com a
    raide cheia.
*   **When:** o líder passa o mouse na barra do Tranquility.
*   **Then:** a barra é quase toda da parte de overheal, com o ícone de alerta
    em cima; a dica mostra ícone e nome do CD, o player na cor da classe,
    "overheal 74% (referências 38–52%)" e "sem dano na janela". Clicar abre o
    Replay naquele instante (log do PC no desktop).

### CUJ 3: Com note

*   **Given:** a note da guilda colada e válida para o pull.
*   **When:** o líder abre a aba do pull.
*   **Then:** cada linha da note é uma marca na linha do player, na hora
    ajustada, ligada à barra do uso casado, com a cor do estado (na hora,
    cedo ou atrasado, não usou); a linha de ciclo e a barra dela ficam em
    cinza. As tabelas de hoje e a note sugerida estão no bloco recolhido
    "Detalhes".

### CUJ 4: Log sem vida dos players

*   **Given:** um pull do Warcraft Logs sem recursos (`low` nulo).
*   **When:** o líder abre a aba.
*   **Then:** a timeline mostra as barras dos CDs e os casts do boss, sem
    curva, raide baixa, golpes nem buracos, com a linha "sem vida no log: só
    os CDs".

## Technical Plan (Architecture)

### Onde roda cada parte

Tudo na interface (`src/`), no desktop e na web, a partir dos campos que o
relatório já tem. Nada muda no núcleo (`crates/wipe-core`).

```text
Pull.raidSeries ──┐
Pull.enemyHits ───┼─► raidHits.ts (hits, moments, raidLow, nightAnchors)  [existe]
Pull.casts (boss) ┘                     │
                                        ▼
PlayerStats.casts ──┐          healTimeline.ts  [novo]
PlayerStats.cdHeals ┼────────►  uses(), gaps(), nightGaps(), freeCds(),
heal-refs ──────────┘           defaultPull()
healCooldowns.ts (tabela) ───►  usa os helpers de healNoteCheck.ts
                                        │
note (opcional) ─► healNoteCheck.ts ────┤  (matchLines, judgeUse: os veredictos
                   [existe]             │   da linha valem para o uso casado)
                                        ▼
                             HealTimeline.tsx  [novo, SVG]
                                        │
                             HealNotePanel.tsx  [muda: timeline em cima,
                                                 tabelas atuais em "Detalhes"]
```

### Constantes

Em `src/lib/healTimeline.ts`:

| Nome | Valor de partida | Uso |
| --- | --- | --- |
| `GAP_SHARE` | 0,60 | dano dos últimos 5 s ÷ vida máxima da raide para "dano alto"; fica em `raidHits.ts` com `trailingShare` e `highDamage` (parâmetro da luta, como `STRONG_HIT_SHARE`) e é reexportada aqui (Open Questions) |
| `EVIDENCE_LOW` | 2 | players abaixo de 50% que dão evidência de dano ao buraco (Open Questions) |
| `GAP_MIN_S` | 3 s | duração mínima do buraco (Open Questions) |
| `GAP_JOIN_S` | 1 s | falha que ainda junta dois trechos de buraco |

As demais (`STRONG_HIT_SHARE`, `RECOVER_MS`, `PREP_MS`, `OVERHEAL_MARGIN`,
`MIN_REFS`, `SAME_MOMENT_MS`) são as de [heal-cd-note.md](heal-cd-note.md#constantes),
importadas, sem cópia.

### Usos sem note

Um **uso** é um cast, em `PlayerStats.casts`, de uma spell da tabela
(`castIdsOf`) de `kind` `heal` ou `mitigation`. Para cada uso:

*   **Janela:** `noDamageWindow(effect, u, d)` de `healNoteCheck.ts` (passa a
    ser exportada). A barra desenhada vai de `u` a `u + d` (a duração do
    efeito); a janela serve para os veredictos e para cobrir buracos.
*   **Momento do uso:** `momentOf` (passa a ser exportada), o mesmo de hoje.
*   **Sem dano** (`kind: heal`): nenhum golpe do pull cruza a janela, nenhum
    segundo de raide baixa cai nela e não há dano alto nela
    (`highDamage(pull, janela)`, `Wt` ≥ `GAP_SHARE`). A mesma regra vale no
    `judgeUse` da note (ver [Open Questions](#open-questions)).
*   **Overheal do uso e overheal alto:** `overhealOfUse` e `refOverheal` com
    `selectHealRefs(pull, player)`, como hoje; CD sem `heal_ids` fica sem
    fração.
*   **Empilhado:** dois ou mais usos de `kind: heal` com `heal_ids` no mesmo
    momento do pull; o rótulo vai em cada um com overheal alto (a regra de
    hoje, com usos no lugar das linhas).
*   **Ciclo provável:** a regra de `cycleLines` (`healNoteCheck.ts`), com
    casts no lugar das linhas. O uso `u` é de ciclo quando está "sem dano", o
    próximo uso `v` do mesmo player e CD **no mesmo pull** tem momento e,
    com `m` = início do primeiro momento do pull depois de `u`,
    `v − (m − (burst ? 0 : PREP_MS)) < cooldown_ms`: mover `u` para o
    momento faria `v` cair antes de o cooldown acabar. CD sem `cooldown_ms`
    nunca é de ciclo. O uso de ciclo fica em cinza, sem veredicto
    (`noDamage` falso), como a linha de ciclo da note.
*   **Com note:** o uso casado com uma linha (`LineCheck` de `matchLines`)
    recebe o `UseVerdict` de `judgeUse` daquela linha (momento, "no golpe",
    "sem dano", ciclo, overheal, empilhado). Com note, vale o julgamento da
    note: ele usa a hora ajustada da linha para o momento e só as linhas da
    note no "empilhado", então pode diferir do julgamento do cast. Um cast
    sem linha casada fica com os veredictos acima.

### Buracos

Por pull, com `s(i)` e `V(i)` de [Golpes e
momentos](heal-cd-note.md#golpes-e-momentos). O segundo `i` é o intervalo
`[i·1000, i·1000 + 999]` ms do pull.

```text
Wt(i)      = s(i−4) + … + s(i)                (dano dos últimos 5 s)
forte(i)   = V(i) > 0 e Wt(i) ≥ GAP_SHARE × V(i)
baixa(i)   = i cai num episódio de raidLow(pull)
coberto(i) = algum uso (qualquer player, heal ou mitigation) tem
             overlaps(janela do uso, i·1000, i·1000 + 999)
buraco(i)  = (forte(i) ou baixa(i)) e não coberto(i)
trecho     = segundos buraco(i) seguidos, juntando falhas de até GAP_JOIN_S;
             fica se dura ≥ GAP_MIN_S
início     = i0·1000;  fim = (i1 + 1)·1000      (ms desde o início do pull)
pico       = maior Wt(i)/V(i) do trecho
```

*   **Por que os últimos 5 s:** o golpe olha 5 s para frente porque procura
    onde o dano começa; o buraco marca o trecho em que a raide já tomou o dano
    e um CD devia estar ativo.

*   **Por que a janela e não a barra:** um `burst` cura o dano que entrou
    antes dele, e um `sustained` cura até `RECOVER_MS` depois de acabar; a
    janela do "sem dano" já descreve isso.
*   **Golpe sem CD também é buraco:** um golpe sem nenhum uso na janela
    aparece como buraco, com o ícone do golpe em cima. O "golpe sem CD" da
    note segue com a mesma regra e a mesma linha na tabela.
*   **Chave na noite:** a regra de marco da raide baixa (spell com mais dano
    em `enemyHits` no trecho, senão `nearestAnchor`), com os marcos de
    `nightAnchors`. Trecho sem marco aparece só no pull.
*   **Buraco da noite:** chave que foi buraco em 2 ou mais pulls; mostra "em X
    de Y pulls que chegaram".
*   **CDs livres:** para cada buraco, os CDs da tabela dos players do pull
    cujo último uso antes do início do buraco foi há mais de `cooldown_ms`
    (ou que ainda não tinham sido usados), contando só CDs que o player usou
    pelo menos uma vez na noite (cobre talento). O cooldown base é maior ou
    igual ao real, então "livre" nunca é falso; um CD com redução pode faltar
    na lista.

### Pull padrão na noite

O que foi mais longe, por esta ordem: mais fases alcançadas
(`phaseMarks.length`); menor `phaseHpPct` (vida da fase em que o pull
acabou); o mais longo; o mais recente. `bossHpTimeline` não serve: é a vida da
fase, e um pull que caiu no fim da P1 ganharia de um que chegou na P3.

### Tela

`HealTimeline.tsx`, com o eixo x no tempo do pull. Como em `FightTimeline`,
os itens são divs posicionadas em % do tempo e só a curva é SVG (assim os
ícones não deformam):

*   **Faixa de dano (topo):** área de `Wt(i)/V(i)`, com duas linhas
    horizontais finas, `GAP_SHARE` e `STRONG_HIT_SHARE`, nomeadas na legenda.
    Divisões de fase em linhas verticais com "P1", "P2".
*   **Raide baixa:** uma tira logo abaixo da curva, preenchida nos segundos de
    `raidLow`.
*   **Golpes:** ícone da spell do boss acima da curva, no início do golpe.
*   **Linhas dos players:** uma por player com algum uso ou marca da note,
    healers primeiro; nome na cor da classe à esquerda (`PlayerName`). Dois
    usos do mesmo player ao mesmo tempo vão para sub-faixas. Cada uso é uma barra
    de `u` a `u + d` com o ícone do CD no começo; o preenchimento separa cura
    útil (cor sólida) de overheal (a mesma cor, listrada e mais clara), na
    proporção do uso. `mitigation` fica numa cor sólida própria e CD de cura
    sem `heal_ids` numa cor neutra ("CD de cura sem medição"), cada um com a
    sua entrada na legenda.
*   **Veredicto na barra:** ícone de alerta em cima da barra para "sem dano",
    "overheal alto" e "empilhado"; uso de ciclo em cinza. Sem faixa lateral
    colorida (regra 5).
*   **Note:** losango na hora ajustada de cada linha, na linha do player,
    ligado à barra do uso casado por um traço; a cor do losango é a do
    estado.
*   **Buracos:** coluna vermelha translúcida atrás de todas as faixas, com o
    número do buraco no topo.
*   **Dica ao passar o mouse:** ícone e nome, player na cor da classe e os
    números (overheal e faixa das referências; dano em % da vida da raide;
    CDs livres no buraco).
*   **Interação:** zoom pela roda e arraste para andar, como em
    `FightTimeline` (`src/components/FightReplay.tsx`): a lógica da janela
    visível sai para um hook `useTimeWindow`, usado pelos dois. Na aba do
    pull, clicar num item abre o Replay naquele instante, quando `onReplay`
    existe. Teclado: itens focáveis em ordem de tempo; Enter faz o mesmo que
    o clique.
*   **Abaixo do gráfico:** "Buracos da noite" (no resumo) ou "Buracos do pull"
    (na aba), em cartões pequenos: ícone da skill do boss, "em X de Y pulls",
    ícones dos CDs livres. Clicar num cartão leva a timeline àquele trecho.
*   **Fileira de pulls (só no resumo):** botões com o número e o resultado do
    pull; o escolhido muda só o fundo.
*   **Detalhes:** as tabelas de hoje (linhas da note, momentos, note sugerida)
    e a caixa da note num bloco recolhido: começa aberto quando já há note
    salva para o boss, abre quando o líder salva a primeira, e depois segue o
    clique.
*   **Sem vida no log:** só as linhas dos players e os ícones dos casts do
    boss, com a linha "sem vida no log: só os CDs" (CUJ 4).

Textos em `HealNotePanel.i18n.ts` (pt e en). Vocabulário novo: "buraco" /
"gap", "CD livre" / "available CD", "ciclo provável" / "likely cycle use",
"cura útil" / "effective healing".

### Adendo: recarga e causa do "não usou" (2026-11-03)

Pedido do desenvolvedor depois do merge: ver se o player usou o CD em outro
momento ou se o CD ainda não tinha voltado, e desenhar a recarga.

*   **Cooldown efetivo** (`effectiveCooldowns` em `healNoteCheck.ts`): o
    menor entre `cooldown_ms` e o menor intervalo entre dois usos seguidos do
    mesmo player e CD num pull da noite. O cooldown base é maior ou igual ao
    real; o intervalo observado pega a redução de talento. A dúvida fica a
    favor do player.
*   **Causa** (`LineCheck.miss`, só em `not_used`): `recharging` (uso anterior
    + cooldown efetivo passa da hora ajustada), senão `used_elsewhere` (cast
    do CD no pull fora do `PAIR_MS`), senão `never`; com `otherUseMs`,
    `lastUseMs` e `readyMs`. O estado não muda: a causa é um detalhe dele.
*   **Tela:** `CdUse.readyAt` (cortado no próximo uso e no fim do pull) vira
    uma linha fina depois da barra; marca `recharging` com anel tracejado;
    marca com `otherUseAt` ligada ao cast por um traço tracejado; a tabela
    mostra a causa e a noite soma as causas.

## Alternatives Considered

### Alternative A: "CD desperdiçado" com limite próprio

*   **Pros:** um rótulo só, fácil de explicar ("desperdiçado: overheal > X% e
    dano < Y").
*   **Cons:** dá dois julgamentos para o mesmo uso, um com a régua das
    referências de fora (overheal alto) e outro com um X fixo; o X fixo não
    distingue um CD que tem overheal alto por natureza (Tranquility) de um que
    não tem.
*   **Reason for Rejection:** os veredictos de hoje já respondem; o que faltava
    era vê-los na barra.

### Alternative B: Timeline da noite com os pulls somados

*   **Pros:** um gráfico só para a noite inteira.
*   **Cons:** os pulls têm durações e fases diferentes; somar o dano por
    segundo mistura P1 de um pull com P2 de outro, e uma barra de CD não tem
    sentido num gráfico somado.
*   **Reason for Rejection:** um pull escolhido mostra o que aconteceu; o
    resumo da noite fica nos cartões "em X de Y pulls".

### Alternative C: Buraco só pelo golpe (sem novo limite)

*   **Pros:** nenhuma constante nova; "golpe sem CD" já existe.
*   **Cons:** dano entre 60% e 80% da vida da raide em 5 s sem CD nunca
    aparece, a não ser que a raide fique baixa; é o trecho que o pedido quer
    ver.
*   **Reason for Rejection:** não resolve o terceiro problema de [The
    Problem](#the-problem).

### Alternative D: Buraco pela cura total da raide (HPS)

*   **Pros:** mostraria falta de cura de fundo, não só de CD.
*   **Cons:** exige cura por segundo de todos os healers, campo novo no
    núcleo; a cura de fundo depende da spec e da composição, e não há régua
    de fora para "cura por segundo baixa" naquele trecho.
*   **Reason for Rejection:** fora do pedido (CDs) e da regra de não criar
    campo novo no núcleo nesta feature.

### Alternative E: Desenhar com uma biblioteca de gráficos

*   **Pros:** eixos, tooltip e zoom prontos.
*   **Cons:** dependência nova para um gráfico; o app já desenha as timelines
    em SVG próprio (`FightTimeline`, a timeline da noite), com o visual do
    projeto; as barras por player com ícones não são um tipo padrão de
    gráfico.
*   **Reason for Rejection:** reuso do que já existe e visual igual ao resto do
    app.

### Alternative F: Reusar `FightTimeline` direto, com uma camada de CDs

*   **Pros:** um componente a menos.
*   **Cons:** `FightTimeline` está preso ao replay (`now`, `onSeek`, faixas de
    todos os players); misturar dano da raide, buracos e note nele deixa o
    replay mais pesado e acopla as duas telas.
*   **Reason for Rejection:** reusar só a lógica de zoom e arraste
    (`useTimeWindow`) dá o mesmo comportamento sem acoplar.

### Alternative G: Sem note, não julgar uso (só desenhar)

*   **Pros:** evita "sem dano" falso num CD gasto cedo de propósito.
*   **Cons:** sem note, a timeline perde a parte de "renderam pouco", que é
    metade do pedido.
*   **Reason for Rejection:** o "ciclo provável" cobre o caso planejado mais
    comum, e o veredicto é o mesmo da note.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Desempenho:** `uses` e `gaps` são lineares nos segundos do pull e nos
    usos; a noite (até ~30 pulls de ~6 min) calcula uma vez por mudança de
    pulls ou de note (`useMemo` no painel). O SVG desenha só os itens dentro
    da janela visível.
*   **Compatibilidade:** relatórios antigos sem `raidSeries` ou `cdHeals`
    caem no CUJ 4 (sem curva) ou mostram barras sem fração; nada quebra.
*   **Rollback:** reverter o PR da etapa 2 volta às tabelas de hoje; a etapa 1
    só acrescenta funções e exports, sem mudar comportamento.

### Additional Resources

*   [heal-cd-note.md](heal-cd-note.md): golpes, momentos, janelas, veredictos e
    constantes que este design reusa.
*   [Regras do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto) e
    [docs/healer-analysis.md](../healer-analysis.md) (referências de fora).

### Future Improvements

*   **Sugerir CD para o buraco** na note sugerida ("adicionar" com um CD
    livre), se os buracos se mostrarem estáveis entre noites.
*   **Cura de fundo por segundo** (HPS dos healers) atrás das barras, com campo
    novo no núcleo.
*   **Timeline no Discord** como imagem, junto das Métricas do grupo.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Dois PRs, cada um com aprovação do desenvolvedor. O primeiro commit do PR da
etapa 1 marca Status Approved no design e na linha do SITEMAP; o último commit
do PR da etapa 2 marca Status Implemented nos dois ([Fluxo de
feature](../CONTRIBUTING.pt-BR.md#fluxo-de-feature)).

### Etapa 1: cálculo e calibração

#### 1. `src/lib/healNoteCheck.ts` (Modify)

*   **Type / Scope:** TypeScript, biblioteca da interface.
*   **What:** exportar, sem mudar o corpo: `noDamageWindow`, `overlaps`,
    `momentOf`, `castTimes`, `withRef` e o tipo `Amounts` (`ON_TIME_MS`,
    `PREP_MS`, `RECOVER_MS`, `UseOverheal`, `UseVerdict` já são exportados).
*   **Why:** `healTimeline.ts` usa as mesmas janelas, o mesmo momento do uso,
    os mesmos casts e a mesma régua de overheal, sem cópia.

#### 2. `src/lib/raidHits.ts` (Modify)

*   **Type / Scope:** TypeScript, biblioteca da interface.
*   **What:** exportar `topSpell` e `keyOf`, sem mudar o corpo.
*   **Why:** a chave do buraco é a mesma regra de marco do golpe e da raide
    baixa.

#### 3. `src/lib/healTimeline.ts` (Create)

*   **Type / Scope:** TypeScript, biblioteca da interface (desktop e web).
*   **What:** constantes `GAP_SHARE` (0,60), `GAP_MIN_S` (3) e `GAP_JOIN_S`
    (1), e:

```ts
interface CdUse {
  pullId: number;
  player: PlayerStats;
  cd: HealCd;
  at: number;                    // ms do pull (cast)
  end: number;                   // at + duration_ms (a barra)
  window: [number, number];      // noDamageWindow (veredictos e cobertura)
  momentKey: string | null;
  noDamage: boolean;
  overheal: UseOverheal | null;  // traz ref (Band), refs e high
  stacked: boolean;
  cycle: boolean;
  onHit: boolean | null;         // só com note
  line?: LineCheck;              // linha casada, com note
}

interface NoteMark {
  lineIndex: number;
  guid: string;
  at: number;                    // expectedMs
  state: LineState;              // on_time | early | late | not_used | dead
  cycle: boolean;
  useAt?: number;                // usedMs do uso casado
}

interface Gap {
  start: number;                 // ms desde o início do pull
  end: number;
  peak: number;                  // maior Wt/V do trecho
  key: string | null;            // `${spellId}:${k}`, null sem marco
  hit: boolean;                  // cruza um golpe do pull
  evidence: boolean;             // morte não ignorada ou EVIDENCE_LOW abaixo de 50% (Open Questions)
  free: { player: PlayerStats; cd: HealCd }[];
}

interface GapOpts { share: number; minS: number; joinS: number }

interface NightGap { key: string; spellId: number; k: number; pulls: Set<number>; reached: number }

function uses(pull: Pull, ms: Moment[], hits: Hit[], refsOf: RefsOf, cycleRule = true): CdUse[];
function withNote(pull: Pull, uses: CdUse[], note: ParsedNote, checks: LineCheck[],
                  verdicts: PullVerdicts | null): { uses: CdUse[]; marks: NoteMark[] };
function gaps(pull: Pull, uses: CdUse[], anchors: Anchors, hits: Hit[],
              usedInNight: Set<string>, opts?: GapOpts): Gap[];
function nightGaps(pulls: Pull[], anchors: Map<number, Anchors>,
                   gapsByPull: Map<number, Gap[]>): NightGap[];
function stackLanes(uses: CdUse[]): Map<CdUse, number>;   // sub-faixa por player
function defaultPull(pulls: Pull[]): Pull;
```

*   **Regras:**
    *   `uses`: um uso por cast (`castTimes` com `castIdsOf`) das spells da
        tabela com `kind`, pela ordem de [Usos sem note](#usos-sem-note);
        overheal por `overhealOfUse` + `withRef(…, refOverheal(refsOf(pull,
        player), cd))`; ciclo pela fórmula de lá; `cycleRule = false` só para
        a calibração contar quantos "sem dano" viram ciclo.
    *   `withNote`: um uso casa com a linha quando `c.guid === player.guid`,
        `castIdsOf(note.lines[c.lineIndex].spellId)` contém `cd.id` e
        `c.usedMs === at`. O uso casado troca `momentKey`, `onHit`,
        `noDamage`, `cycle`, `overheal` e `stacked` pelos do `UseVerdict` da
        linha. Toda linha `on_time`, `early`, `late`, `not_used` ou `dead`
        vira um `NoteMark`.
    *   `gaps`: a regra de [Buracos](#buracos); `key` por `keyOf(topSpell(pull,
        start, end), start, anchors)`; `usedInNight` guarda `guid:cdId` dos CDs
        usados nos pulls recebidos; `free` exige `cooldown_ms` não nulo e
        último uso antes de `start` há mais de `cooldown_ms` (ou nenhum).
    *   `nightGaps`: chaves em 2 ou mais pulls; um pull "chegou" quando tem o
        k-ésimo cast de `spellId` antes do corte, como em `moments()`.
    *   `stackLanes`: cada barra (`at` a `max(end, at + 1 px)`) na primeira
        sub-faixa livre do player.
    *   `defaultPull`: a ordem de [Pull padrão na
        noite](#pull-padrão-na-noite).
*   **Why:** tudo o que a timeline desenha sai daqui, testável sem a tela.

#### 4. `src/lib/healTimeline.test.ts` (Create)

*   **Type / Scope:** teste Vitest com pulls sintéticos (sem `samples/`); os
    números saem das constantes importadas.
*   **What:** casos:
    *   `burst` logo depois de um golpe cobre o trecho; não há buraco;
    *   `Wt/V` = `GAP_SHARE + 0,05` por `GAP_MIN_S + 1` s sem uso vira buraco;
        por `GAP_MIN_S − 1` s, não;
    *   falha de `GAP_JOIN_S` junta dois trechos; de `GAP_JOIN_S + 1`, separa;
    *   raide baixa sem dano alto e sem uso vira buraco com `evidence`;
    *   golpe sem uso vira buraco com `hit` verdadeiro; `peak` é o maior
        `Wt/V`;
    *   `key` pelo `topSpell`, pelo `nearestAnchor` e `null` sem marco;
    *   `sustained`, `active` e `mitigation` cobrindo um buraco;
    *   "sem dano"; "ciclo provável" (dentro e fora do cooldown, próximo uso
        sem momento); `cycleRule = false` mantém o "sem dano";
    *   "empilhado" com dois usos de `heal` no mesmo momento;
    *   refs abaixo de `MIN_REFS`: `overheal.ref` nulo e `high` falso;
    *   player sem `casts`; spell sem `kind` ignorada;
    *   `free`: usado há menos de `cooldown_ms` não entra; `cooldown_ms` nulo
        não entra; nunca usado nos pulls não entra; usado em outro pull entra;
    *   `withNote`: uso casado recebe o `UseVerdict` da linha; cast sem linha
        mantém os de `uses`; linha `not_used` vira marca sem `useAt`;
    *   `nightGaps`: chave em 1 pull não entra; em 2, entra com `reached`
        igual aos pulls com o k-ésimo cast;
    *   `stackLanes`: dois usos sobrepostos do mesmo player em sub-faixas 0 e
        1; sem sobreposição, 0;
    *   `defaultPull`: mais fases ganha de menor `phaseHpPct`; empate pelo
        mais longo, depois pelo mais recente;
    *   pull sem `low`: `gaps` devolve vazio.
*   **Why:** fixa as regras antes da tela e da calibração.

#### 5. `scripts/heal-note-calibrate.mjs` (Modify)

*   **Type / Scope:** script Node de calibração.
*   **What:** `healTimeline.ts` entra no `entry` do bundle; opções
    `--gap-shares 0.5,0.6,0.7` e `--gap-min 2,3,4` no texto de uso e no
    `console.error`. Para cada par, uma linha: `share`, `minS`, buracos por
    pull (mediana e p90), % sem evidência de dano, buracos da noite, "sem
    dano" e "ciclo provável" (de `uses` com e sem `cycleRule`). Com o
    `noGlob` do script, `refsOf` volta vazio: a calibração não julga
    overheal.
*   **Why:** os valores de `GAP_SHARE` e `GAP_MIN_S` são aprovados com esses
    números ([Open Questions](#open-questions)).

#### 6. `docs/designs/heal-cd-timeline.md` e `docs/designs/SITEMAP.md` (Modify)

*   **Type / Scope:** docs de design.
*   **What:** marcar Status Approved (primeiro commit do PR); fechar as Open
    Questions com os números da calibração (noites, boss e datas) e os
    valores aprovados.
*   **Why:** registro da decisão, como em
    [heal-cd-note.md](heal-cd-note.md#open-questions).

### Etapa 2: timeline na tela

#### 7. `src/lib/useTimeWindow.ts` e `src/lib/useTimeWindow.test.ts` (Create)

*   **Type / Scope:** hook React e teste Vitest.
*   **What:** extraídos de `FightTimeline`: zoom pela roda do mouse em volta
    do cursor, Shift ou roda de lado para andar, segurar e arrastar, e o
    clique engolido depois de arrastar. Constantes `ZOOM_MIN_MS`, `ZOOM_STEP`
    e `PAN_SLOP_PX` saem de `FightReplay.tsx` e são exportadas daqui.

```ts
function zoomAt(win: [number, number], duration: number, at: number, deltaY: number): [number, number];
function panBy(win: [number, number], duration: number, dMs: number): [number, number];
function useTimeWindow(o: { duration: number; win: [number, number];
                            onWin: (w: [number, number]) => void;
                            measure: () => HTMLElement | null }):
  { rootRef: RefObject<HTMLDivElement>; startPan: (e: PointerEvent) => void;
    panning: boolean; zoomed: boolean; swallowClick: (e: MouseEvent) => void };
```

    `win` fica no componente dono. O teste cobre `zoomAt` (mínimo, máximo,
    centro no cursor) e `panBy` (limites 0 e `duration`).
*   **Why:** o mesmo zoom nas duas timelines, sem cópia
    ([Alternative F](#alternative-f-reusar-fighttimeline-direto-com-uma-camada-de-cds)).

#### 8. `src/components/FightReplay.tsx` (Modify)

*   **Type / Scope:** componente React.
*   **What:** `FightTimeline` usa `useTimeWindow` com `measure` =
    `.fight-lane .fight-track`, sem mudar o comportamento.
*   **Why:** consequência do item 7.

#### 9. `src/components/HealTimeline.tsx` (Create)

*   **Type / Scope:** componente React.
*   **Props:** `{ pull, uses: CdUse[], marks: NoteMark[], gaps: Gap[], hits:
    Hit[], low: { start: number; end: number }[], bossCasts: Anchors,
    onReplay?: (ms: number) => void, focusAt?: number }`. O painel calcula
    tudo uma vez e passa.
*   **Layout:** divs posicionadas em % do tempo (como `FightTimeline`); a
    curva é um SVG `viewBox="0 0 1000 100"` com
    `preserveAspectRatio="none"`. Estado próprio `win`, que volta ao pull
    inteiro quando o pull muda; `focusAt` centraliza a janela; `measure` =
    `.heal-tl-track`.
*   **Faixas, de cima para baixo:**
    *   fila de ícones do boss (18 px): `bossCasts` e os golpes (`SpellIcon`);
    *   curva (64 px): `Wt/V` de 0 a 1,2; acima, cortada com ▲; linhas de
        `GAP_SHARE` e `STRONG_HIT_SHARE`; divisões de fase com "P1", "P2";
    *   tira de raide baixa (6 px);
    *   linhas dos players: `role === 'healer'` primeiro, depois os demais,
        cada grupo pelo primeiro uso; nome com `PlayerName`; sub-faixas de
        22 px por `stackLanes`; barra de `at` a `end`, no mínimo 4 px, com
        `SpellIcon` de 16 px no começo.
*   **Barra:** cura útil em `--heal-tl-useful`; overheal na mesma cor com
    listras a 45° e opacidade 0,45 (`--heal-tl-over`), na proporção de
    `overheal.share`; `mitigation` em `--heal-tl-mitig`; CD de cura sem
    `heal_ids` em `--heal-tl-noheal`;
    uso de ciclo em cinza; ícone de alerta em cima para "sem dano",
    "overheal alto" e "empilhado".
*   **Note:** losango em `mark.at` na linha do player, com a cor do estado e
    um traço até `useAt` quando há; `not_used` e `dead`, losango sem barra.
*   **Buracos:** coluna em `--heal-tl-gap` atrás de todas as faixas, com o
    número 1..n pelo início.
*   **Dica:** acima do item, com `SpellName`, `PlayerName` e os números
    (overheal e faixa das referências; `peak` em %; CDs livres).
*   **Interação e acessibilidade:** clique abre o Replay quando `onReplay`
    existe; itens focáveis em ordem de tempo, Enter igual ao clique; o
    gráfico tem `role="img"` e `aria-label` com o número de usos e de
    buracos.
*   **Why:** o visual principal da seção (G1 deste design).

#### 10. `src/components/HealNotePanel.tsx` (Modify)

*   **Type / Scope:** componente React.
*   **What:**
    *   `useMemo` (antes do `if (!boss) return null`): `nightAnchors`, `hits`,
        `moments`, `raidLow`, `uses`, `withNote` (versão da note do pull pela
        `noteOf` de hoje), `gaps` com `usedInNight` dos pulls recebidos, e
        `nightGaps`;
    *   timeline primeiro; no resumo da noite, fileira de pulls com o
        escolhido em `useState(defaultPull(pulls))`, que volta ao padrão
        quando o conjunto de pulls muda; na aba, o pull de `focus`;
    *   abaixo, cartões de buraco: na aba, numerados como na timeline; na
        noite, um por `NightGap`, com ícone da skill, "em X de Y pulls" e
        ícones dos CDs livres. Clicar centraliza a timeline no trecho; na
        noite, se o pull escolhido não tem aquele buraco, troca para o pull
        mais recente que tem;
    *   caixa da note, casamento de fases, tabelas e note sugerida num
        `<details>` controlado: começa aberto quando há versão da note, abre
        quando a primeira versão é salva, depois segue o clique;
    *   sem note, a timeline aparece igual; sem nenhum uso nos pulls, a linha
        "nenhum CD de cura nos pulls".
*   **Why:** timeline como principal, sem note, com note, noite e pull, e
    ligada ao replay (G1, G2, G3, G6 e G7 deste design).

#### 11. `src/components/HealNotePanel.i18n.ts` (Modify)

*   **Type / Scope:** textos pt-BR e inglês ([Regras do
    projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).
*   **What:** chaves novas `tlLegend` (`dmg`, `low`, `hit`, `useful`, `over`,
    `gap`, `mitig`), `tlUseTip(pct, band)`, `tlGapTip(n, peakPct)`, `tlFree`,
    `tlCycleLikely`, `gapCard(x, y)` (com plural), `gapsNight`, `gapsPull`,
    `details`, `noLife`, `noCds`, `tlAria(uses, gaps)`. Os rótulos de
    veredicto que já existem ("sem dano", "overheal alto", "empilhado") são
    reaproveitados; a chave `empty` sai.

#### 12. `src/styles.css` (Modify)

*   **Type / Scope:** estilos.
*   **What:** classes `heal-tl-*` (faixas, barras, listras do overheal,
    coluna de buraco, losango, foco por teclado, cartões, fileira de pulls) e
    as variáveis `--heal-tl-useful`, `--heal-tl-over`, `--heal-tl-mitig`,
    `--heal-tl-gap` (`--bad` a 12%) nos temas claro e escuro; sem borda
    colorida lateral (regra 5 das [Regras do
    projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).

#### 13. `docs/heal-cd-note.md` (Modify)

*   **Type / Scope:** doc de uso.
*   **What:** seção "Timeline": como ler o gráfico, o que é buraco (com os
    valores aprovados), CDs livres, ciclo provável, uso sem note.

#### 14. `docs/designs/heal-cd-timeline.md` e `docs/designs/SITEMAP.md` (Modify)

*   **What:** no último commit do PR da etapa 2, marcar Status Implemented
    nos dois.

### Verification Plan

*   Etapa 1: `npx vitest run src/lib/healTimeline.test.ts
    src/lib/healNoteCheck.test.ts src/lib/healNoteUse.test.ts`; `npm run
    typecheck`; calibração em duas noites e números no design.
*   Etapa 2: `npm run typecheck`; `npm test` (o `FightReplay.tsx` muda);
    preview `ui` com uma noite carregada: timeline sem note, com note, no
    resumo e na aba; zoom e arraste nas duas timelines; tema claro e escuro;
    Tab percorre os itens em ordem de tempo e Enter abre o Replay; `npm run
    docs:links`.

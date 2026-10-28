# Note de CDs de cura: timing, uso e momentos sem CD

*   **Author:** Vinicius Andrade (@keter45)
*   **Status:** Approved
*   **Date:** 2026-10-27

Convenção: títulos e rótulos do template EGM ficam em inglês; o resto, em
português. Nomes de spell e de boss ficam em inglês.

--------------------------------------------------------------------------------

## Overview

O wipe-cause lê o combat log do WoW (ou um report do Warcraft Logs) e explica
por que a raide morreu. No foco Guilda, cada pull tem abas por assunto (Mortes,
Mecânicas, Interrupts, Players, Desempenho, Replay, Spells), e o resumo do boss
na noite junta os pulls daquele boss.

Esta feature lê a **note de cooldowns** que o líder escreve para o addon do
grupo (formato NSRT) e confere, nas tries da guilda, três coisas:

1.  **Timing:** cada CD da note saiu na hora chamada e no golpe do boss que ele
    devia cobrir.
2.  **Uso:** havia dano para justificar o CD, ele não ficou em cima de outro
    sem necessidade, e o overheal não passou do que guildas de fora fazem com o
    mesmo CD.
3.  **Golpes e raide baixa:** golpes do boss sem nenhum CD na note, CDs
    planejados que não vieram, e trechos com um quarto ou mais da raide abaixo
    de 50% de vida.

No fim, sugere mudanças em cima da note colada, cada uma com o motivo, e
devolve o texto no mesmo formato, pronto para colar no addon.

O resultado aparece no resumo do boss na noite (as tries juntas) e numa aba do
pull (uma try). Nada é específico de um boss: a análise vale para qualquer
boss, com ou sem fases na regra (`phases` em `encounters/`), e a lista de CDs
fica em `data/` ([regra 1 do
projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).

Termos usados:

*   **Foco Guilda / Solo:** os dois modos do app (o que aconteceu com o grupo ×
    o que um personagem pode corrigir), trocados no cabeçalho.
*   **Try:** um pull do boss. O Overview e o The Problem dizem "try"; o resto
    do documento diz "pull".
*   **Corte:** o momento da N-ésima morte (`cutoffT`, "ignorar eventos após N
    mortes" nas Configurações); as estatísticas param ali.
*   **MRT / NSRT:** addons de raide (Method Raid Tools, Northern Sky Raid
    Tools) que mostram a note do líder e tocam um lembrete na hora de cada CD.
*   **Note:** o texto de CDs que o líder escreve para o addon ("nota" continua
    sendo a nota do pull no app). **Linha:** uma linha da note com `time` e
    `ph` (um CD chamado para um player numa hora).
*   **Lorrgs:** site que mostra a timeline de CDs dos melhores logs de cada
    spec, usado pela guilda como referência.
*   **Dano inevitável:** dano de fonte inimiga ou do ambiente em players, com
    absorb, menos o que a regra do boss trata como falha de mecânica (o mesmo
    critério da aba Mortes).
*   **Golpe:** janela de 5 s em que o dano inevitável passa de uma fração da
    vida máxima somada da raide sem tanks (`STRONG_HIT_SHARE`).
*   **Raide baixa:** um quarto ou mais dos vivos sem tanks abaixo de 50% de
    vida, por pelo menos 2 s.
*   **Δ:** hora do uso − hora ajustada da linha; negativo = adiantado.
*   **Etapa 0:** a medição feita nas noites da guilda antes deste design.

## The Problem

A guilda monta a note de CDs de cura assim: parte de uma composição de healers
parecida com a nossa, olha onde outras guildas usam cada CD (o Lorrgs é a
referência) e ajusta pelo que dói nas tries. Alguns CDs são gastos cedo de
propósito, só para ganhar mais um uso e estar pronto numa mecânica-chave. A
note muda entre as tries enquanto os CDs estão sendo montados; depois de
pronta, só muda se um healer for trocado.

Hoje, para saber se a note funcionou, o líder abre cada try no Warcraft Logs,
compara a timeline de casts com a note de cabeça e olha o gráfico de dano
tomado para achar os golpes que ficaram sem CD. Saber se o CD rendeu é mais
difícil: havia dano entrando para justificar aquele CD naquela hora, ou ele
curou gente de vida cheia (overheal) ou ficou em cima de outro CD? É a
pergunta que decide se um CD muda de lugar, e hoje sai de olhar a cura do
healer segundo a segundo no Warcraft Logs. Como a note muda entre as tries,
cada try precisa ser conferida contra a versão que valia nela. O log já traz
tudo o que essa conferência usa (casts de cada player, dano que a raide tomou,
vida de cada player, casts do boss, início de cada fase); o app ainda não
cruza esses dados com a note. A aba Interrupts já lê uma note colada pelo
líder, mas só a parte de interrupts.

Três coisas tornam a conferência à mão enganosa, e o app precisa tratar as
três (números da etapa 0, The Coiled Altar Mythic, noites de 21, 22 e 26/10):

*   **O relógio da note não é o do app.** O `time` da note é contado a partir do
    início de cada fase, como o addon conta. O P1 casou bem (mediana −0,1 s; 89%
    das linhas a ±10 s), mas o P2 do addon começa de 7,0 a 9,0 s depois do P2
    do app (8,6, 9,0 e 7,0 s nas três noites). Sem ajuste, um terço das linhas
    do P2 pareceria atrasado sem culpa de ninguém.
*   **A média de vida da raide esconde o perigo.** Em 26/10 (19 pulls), a média
    de vida dos vivos sem tanks ficou abaixo de 50% em 0,1% dos segundos; na
    maioria das mortes, os outros estavam em 70–90% em média. O dano entra o
    tempo todo (em 5 s a raide toma, na mediana, 49% da própria vida máxima, e
    86% no p95) e a cura devolve. O que acompanha as mortes é **quantos**
    ficaram abaixo de 50% e **quanto** dano entrou de uma vez.
*   **Nem todo CD "fora do lugar" é erro.** O CD gasto cedo para ganhar um uso
    é planejado; um CD de redução de dano (Darkness, Anti-Magic Zone) só serve
    se estiver ativo no golpe, e uma cura que dura (Tranquility) pode vir antes
    ou depois dele.

Há ainda um risco no que já existe: colar a note inteira na caixa da aba
Interrupts faz o parser de lá ler as linhas `tag:Fulano;spellid:…` como grupos
de interrupt (com uma só mecânica de interrupt no boss) ou ignorar o bloco
`intstart`…`intend` sem aviso (com duas). A escala de interrupts alimenta a
culpa, o placar, o Discord e a IA.

## Goals

*   **G1. Ler a note sem perder nada.** Exportar sem mudanças devolve o texto
    da caixa, igual. Ver [Formato NSRT](#formato-nsrt).
*   **G2. Escala de interrupts protegida.** Com o bloco `intstart`…`intend`, a
    escala sai só dele; note NSRT sem bloco não gera escala; texto antigo (não
    NSRT) é lido como hoje. Ver [Versões da note](#versões-da-note).
*   **G3. Timing por linha.** Cada linha de cada pull termina num estado de uma
    lista fechada, com o Δ, já descontado o desvio de relógio do addon. Ver
    [Estados de cada linha](#estados-de-cada-linha) e [Casar as fases e medir o
    desvio](#casar-as-fases-e-medir-o-desvio).
*   **G4. No golpe.** Para cada linha ligada a um momento da noite, o app diz
    se o uso cobriu o golpe, pela janela do tipo de efeito do CD. Linha longe
    do golpe é problema da note e vira mudança sugerida, não erro do player.
    Ver [Veredictos](#veredictos).
*   **G5. Uso.** Para cada uso: sem dano, overheal alto e empilhado; o uso de
    ciclo nunca é cobrado. Ver [Veredictos](#veredictos).
*   **G6. Golpes e raide baixa.** Golpe sem CD na note, CD planejado que não
    veio e raide baixa sem golpe, cada um com o número de pulls. Ver [Golpes e
    momentos](#golpes-e-momentos).
*   **G7. Note sugerida.** Mudanças de um passo (mover ou adicionar uma linha),
    cada uma com o motivo e conferida contra o cooldown; o líder marca quais
    quer e copia o texto. Ver [Note sugerida](#note-sugerida).
*   **G8. Noite e pull.** O resumo do boss junta os pulls (ver [Agregação na
    noite](#agregação-na-noite)); a aba do pull mostra um pull. Cada pull é
    julgado pela versão da note que valia nele (CUJ 4).
*   **G9. Qualquer boss.** Nada específico de um boss no código; boss sem
    `phases` usa `ph:1` desde o início do pull. A tabela de CDs fica em
    `data/`, lida pelo núcleo e pela interface, no desktop e na web.
*   **G10. Referência só de fora da guilda (regra 2).** Os healers da guilda
    nunca são a referência do "certo": a régua de overheal vem só de
    `src/data/heal-refs`. Golpe e raide baixa são parâmetros da luta (quanto
    dano o boss dá), não metas do healer, e podem ser calibrados nos logs da
    guilda (decisão do desenvolvedor, 2026-10-27).
*   **G11. Interface do projeto.** Textos em pt-BR e inglês na mesma mudança;
    ícone e nome em toda habilidade, ícone do boss, cor da classe em todo
    player, também nas frases; sem faixa colorida lateral
    ([regra 5](../CONTRIBUTING.pt-BR.md#regras-do-projeto)).

## Non-Goals

*   **Externos em tank** (Ironbark, Guardian Spirit, Pain Suppression): outra
    análise (dano em um alvo, tank buster), para depois.
*   **Ler o Lorrgs** ou outro serviço novo: a referência externa é a que o app
    já tem em `src/data/heal-refs`.
*   **O formato MRT clássico** (`{time:1:05,p2} Nome {spell:id}`): outra
    gramática, para depois.
*   **Conferir `glowunit`** (alvo de Power Infusion e Innervate): a linha passa
    intacta.
*   **Cobrar Healthstone, poção e avisos `text:`** (`tag:everyone`): passam
    intactos e não são avaliados.
*   **A note na Evolução** (comparar notes entre noites): o histórico compacto
    não tem os casts.
*   **Pôr o resultado na nota do pull, no placar ou no Discord.**
*   **Desenhar os CDs no replay.**
*   **Montar a note do zero** ou otimizar a note inteira: a sugestão parte
    sempre da note colada.
*   **Sincronizar a note entre o desktop e a web.**

## Open Questions

*   **Limite do golpe — fechada (2026-10-28).** `STRONG_HIT_SHARE` = **0,80**,
    aprovado pelo desenvolvedor depois da calibração da etapa 2 em 26/10 (The
    Coiled Altar Mythic, 18 pulls): 5 s / vida máxima p50 0,46, p90 0,73, p95
    0,85; com 0,80, 3,7 golpes por pull, 16 momentos, 14 deles com CD na note
    da guilda; nenhum golpe sem marco (os golpes sem cast ficam só na aba do
    pull). Com 0,60 seriam 6,7 golpes por pull; com 0,90, 8 momentos.
*   **Janelas de cada tipo de efeito** (`RECOVER_MS`, `PREP_MS` e as folgas da
    tabela de janelas) e `HIT_ONSET_SHARE` (o dano de fundo fica em 0,1–0,17
    da vida da raide por segundo, perto do limite de 0,2 × W): conferidos na
    mesma calibração.
*   **Convenção de fases do NSRT.** `ph:2.5` para a intermissão vem só da note
    de exemplo da guilda; não há documento do NSRT que confirme como ele numera
    intermissões e fases que se repetem. O casamento aparece no topo, e `ph`
    sem par fica "não avaliado", sem culpa; trocar o par à mão fica para quando
    aparecer uma note real que não case (Future Improvements).

## Critical User Journeys (CUJs)

### CUJ 1: Conferir a note depois da noite

*   **Given**: a noite do boss foi analisada (log do PC ou Warcraft Logs), e a
    note ainda não foi colada no app.
*   **When**: o líder abre o resumo do boss e cola a note na seção "CDs de
    cura".
*   **Then**: o topo mostra como cada `ph` foi casado e o desvio medido de cada
    fase; a versão colada vale "a partir do pull N" (padrão: o primeiro pull
    com todos os nomes da note na raide), e o líder pode mudar N; a tabela por
    linha mostra, entre os pulls que chegaram naquele ponto, quantos foram "na
    hora" e "no golpe", com o Δ mediano; os golpes e a raide baixa aparecem por
    momento, com o número de pulls.

### CUJ 2: Um pull sozinho

*   **Given**: a note do boss já está salva.
*   **When**: o líder abre um pull e a aba "CDs de cura".
*   **Then**: a mesma análise para esse pull, linha a linha e momento a
    momento; cada linha e cada momento tem ▶ para o replay naquele instante;
    linhas de fase não alcançada, de fase que acabou antes ou depois do corte
    aparecem como tal, sem culpa.

### CUJ 3: Note sugerida

*   **Given**: a análise da noite mostra um golpe sem CD em vários pulls e uma
    linha que cai sempre longe do golpe.
*   **When**: o líder abre "Note sugerida".
*   **Then**: aparece a lista de mudanças (adicionar uma linha no golpe; mover a
    linha para o tempo do golpe), cada uma com o motivo e uma caixa de seleção;
    "Copiar" devolve a note colada só com as mudanças marcadas, e as outras
    linhas iguais.

### CUJ 4: Note ajustada entre as tries

*   **Given**: os CDs ainda estão sendo montados e a noite está ao vivo no app;
    o líder cola a note antes do pull 3 e, com "nova versão", ajusta outra
    antes do pull 7 (ou salva as duas depois da noite e marca "a partir do
    pull 3" e "a partir do pull 7").
*   **When**: depois da noite, ele abre o resumo do boss.
*   **Then**: os pulls 3 a 6 são julgados pela primeira versão e os pulls 7 em
    diante pela segunda; os pulls 1 e 2 usam a versão anterior, se existe (a da
    semana passada, por exemplo), ou ficam fora; o resumo diz quantos pulls
    cada versão julgou.

### CUJ 5: Note com bloco de interrupts

*   **Given**: a note colada tem `intstart`…`intend`.
*   **When**: o líder abre a aba Interrupts.
*   **Then**: a escala vem só do bloco; as linhas de CD não viram grupos de
    interrupt. Uma note NSRT sem bloco não gera escala; um texto antigo, que
    não é NSRT, continua lido como antes.

## Technical Plan (Architecture)

### Onde roda cada parte

A note muda entre os pulls e é colada depois da análise, então o núcleo não
recebe a note. O núcleo (`crates/wipe-core`, o mesmo no desktop e no WASM da
web) só passa a emitir **séries genéricas por segundo**, até o corte; a
interface (TypeScript puro em `src/lib/`, como `checkAssignments` hoje) faz o
resto: ler a note, casar com os pulls, julgar e sugerir. Colar ou editar a note
não pede reanálise.

```text
combat log / WCL ──► wipe-core (analysis.rs) ──► Pull (relatório)
                       │  vida e dano dos players por segundo           raidSeries
                       │  golpe de falha? (rules.failure_mechanic)      enemyHits
                       │  cura dos CDs da tabela (data/heal-cooldowns)  PlayerStats.cdHeals
                       ▼
note colada ──► healNote.ts (parse, versões, export sem perdas)
                       │
                       ├─► assignments.ts  (só o bloco intstart…intend)
                       ▼
               healNoteCheck.ts (casar ph, desvio, estados, golpes, momentos,
                       │          veredictos, note sugerida)
                       ▼
               HealNotePanel (pulls[]) ──► aba do pull (1 pull)
                                       └─► resumo do boss na noite (N pulls)
```

### Constantes

As de golpe e raide baixa (`STRONG_HIT_SHARE`, `HIT_ONSET_SHARE`, `LOW_*`)
ficam em `src/lib/raidHits.ts` (e `LOW_PCT` no núcleo); as demais, em
`src/lib/healNoteCheck.ts` e `src/lib/healNote.ts` (`MAX_VERSIONS`).

| Nome | Valor proposto | Origem |
| --- | --- | --- |
| `ON_TIME_MS` | 10 s | pedido do desenvolvedor (±10 s) |
| `PAIR_MS` | 30 s | casamento linha ↔ cast; acima disso é "não usou" |
| `MIN_OFFSET_LINES` | 5 | pares (linha, pull) para o desvio ser estável, em pelo menos 2 pulls |
| `MAX_OFFSET_MS` | 12 s | teto do desvio aplicado (etapa 0: desvio de 7–9 s) |
| `SAME_MOMENT_MS` | 20 s | fusão de golpes; já existe em `cdAnchors.ts` (passa a ser exportada) |
| `STRONG_HIT_SHARE` | 0,80 | golpe (Open Questions) |
| `HIT_ONSET_SHARE` | 0,2 | início do golpe: primeiro segundo com essa fração do dano da janela |
| `LOW_PCT` / `LOW_SHARE` / `LOW_MIN_S` | 50% / 1/4 / 2 s | raide baixa (desenvolvedor, 2026-10-27) |
| `RECOVER_MS` | 8 s | cura depois do golpe ainda é recuperação (Open Questions) |
| `PREP_MS` | 2 s | quanto antes do golpe a note chama um CD `active` ou `sustained`; usado no uso de ciclo, no "adicionar" e no "mover" (não na cobertura) |
| `MIN_REFS` | 3 | mínimo de referências; já existe em `healer.ts` |
| `OVERHEAL_MARGIN` | 0,15 | folga acima do p75; a mesma da dica de overheal de `healer.ts` (vira constante exportada) |
| `MAX_VERSIONS` | 20 | versões guardadas por boss e dificuldade |

### Dados novos no relatório

Todos opcionais, com um valor por segundo: o índice `i` é o segundo [i, i+1)
do pull, de 0 até o segundo do corte.

*   **`Pull.raidSeries`**
    *   **Campos:** `alive` (vivos), `low` (abaixo de 50%), `maxHpK` (vida
        máxima somada dos vivos sem tanks, cada um com o último `max_hp`
        conhecido; player ainda sem amostra de vida não conta) e
        `unavoidableK` (dano inevitável no segundo, em milhares, com o golpe
        absorvido inteiro, que o log registra como `SPELL_MISSED` com
        `ABSORB`).
    *   **Quem conta:** só players sem papel de tank. O papel é o
        `PlayerStats.role` resolvido no fim do pull (o mesmo no log do PC e no
        Warcraft Logs), então o núcleo guarda o estado por player e por segundo
        e soma no fim.
    *   **Abaixo de 50%:** o mesmo mecanismo do `injured` / `injured_secs` que o
        núcleo já mantém para os 80% (atualizado em `track_advanced` a cada
        evento com a vida do player; a morte tira o player). No Warcraft Logs,
        a vida vem dos recursos do report (`includeResources`).
    *   **Inevitável:** golpe em que `rules.failure_mechanic` devolve `None`, o
        mesmo critério da aba Mortes (`fail_ids`, dano de mecânica com culpa
        por acerto e `stack_limit` contam como falha). Como nas Mortes, regras
        que dependem de aura (`requires_aura`, `excludes_aura`) contam como
        inevitáveis (ver [Riscos e limites](#riscos-e-limites)). Só dano de
        fonte inimiga ou do ambiente; dano de player do grupo fica fora.
    *   **Sem vida no log** (sem advanced logging, ou Warcraft Logs sem
        recursos): `low` vem nulo.
*   **`Pull.enemyHits`**: o dano inevitável por spell inimiga
    (`[segundo, spellId, dano]`; dano de ambiente com `spellId` 0), sem as
    entradas pequenas (piso no Detailed
    Implementation Plan). Diz qual skill do boss fez o golpe, inclusive dano
    sem cast (DoT, stacks). Por causa do piso, a soma não serve como total; o
    total é `unavoidableK`.
*   **`PlayerStats.cdHeals`**: cura e overheal por segundo das spells de cura
    dos CDs da tabela (`[segundo, castId, cura, overheal]`, somando os
    `heal_ids` do CD). Absorb de escudo conta como cura, sem overheal. Cura de
    pet ou totem conta para o dono, como no resto do núcleo.
*   O histórico compacto (Evolução, `src-tauri/src/history.rs` e
    `src/web/history.ts`) tira os três campos, como já tira `casts`.

Estimativa: 10–30 KB por pull, contra os ~50–60 MB do relatório de uma noite.

### A tabela de CDs: `data/heal-cooldowns.json`

Lista por spellid de cast, lida pelo núcleo (`include_str!` em `data.rs`,
como `defensives.json`) e pela interface:

| Campo | Para quê |
| --- | --- |
| `id`, `name`, `class` | casar a linha com os casts do player; ícone e nome |
| `specs` | specs que têm o CD (ids de spec), para separar "não usou" de "não tem a spell" |
| `talent` | o CD depende de talento: quem não o castou na noite pode não ter escolhido |
| `alt_ids` | ids alternativos do mesmo botão (Stampeding Roar 77761/77764, Convoke 323764) |
| `kind` | `heal` (cura) ou `mitigation` (redução de dano ou redistribuição de vida: Darkness, Anti-Magic Zone, Rallying Cry, Barrier, Spirit Link Totem, Zephyr); sem `kind`, a entrada só guarda `alt_ids` para o timing (Stampeding Roar) |
| `effect` | `burst` (rajada ou canal curto: Divine Hymn, Revival, Rewind), `sustained` (dura: Tranquility, Ascendance, Apotheosis, Convoke, Avenging Crusader), `active` (redução ativa por N s) |
| `duration_ms` | janela do efeito |
| `cooldown_ms` | cooldown base, para o uso de ciclo e a note sugerida |
| `heal_ids` | spells que só existem durante o CD (Tranquility 740 → 157982), para `cdHeals` e a régua de overheal; CD que só fortalece ou lança spells comuns (Convoke, Apotheosis) fica sem |

`cooldown_ms`, `duration_ms` e `alt_ids` repetem números de outros lugares. A
interface não lê os YAMLs de rotação, então a tabela guarda uma cópia, e um
teste do núcleo confere a cópia contra as fontes. De onde vem cada coisa:

| Lista | Para quê |
| --- | --- |
| `rotations/*.yaml` | rotação da spec; fonte de `cooldown_ms`, `channel_ms` e `alt_ids` dos CDs de healer (mantidos pelo `npm run refresh`) |
| `data/defensives.json` | "morreu sem defensivo" e defensivos no replay; fonte do `cd` e do `zone.duration` dos CDs de raide |
| `src/lib/cooldowns.ts` | janelas de burst no Desempenho |
| `data/heal-cooldowns.json` | esta análise: specs, tipo de efeito, ids da cura (e a cópia conferida de cooldown, duração e ids) |

O **timing** vale para toda linha com `spellid` e um player no `tag`, esteja
ou não na tabela: isso inclui Power Infusion, Innervate, externos e
utilidades. **Uso**, golpes e note sugerida valem só para spells da tabela com
`kind` `heal` ou `mitigation`.

### Formato NSRT

Exemplo (nomes fictícios):

```text
EncounterID:3429;Name:Coiled Altar 2 - Guilda;Difficulty:Mythic
time:2;ph:1;tag:Healpriest;spellid:64843;
time:47;ph:1;tag:everyone;text:Personals;
time:47;ph:1;tag:Warrior;spellid:97462;
time:15;ph:2.5;tag:Druida;spellid:29166;glowunit:Healpriest;
time:14;ph:3;tag:Evoker;spellid:370537;
intstart
Kicker Kicker Kicker Kicker
intend
```

Gramática:

```text
note        = linha { LF linha }                  ; a caixa entrega o texto com LF
linha       = cabeçalho | timer | intstart | intend | outra
cabeçalho   = campos com "EncounterID"            ; 1ª linha que começa com "EncounterID:"
timer       = campos com "time" e "ph"
campos      = campo { ";" campo } [ ";" ]         ; ordem livre
campo       = chave ":" valor                     ; chave sem ":"; valor até o próximo ";"
intstart    = "intstart"                          ; linha inteira, sem caixa, sem espaços em volta
intend      = "intend"
```

*   `time`: segundos desde o início da fase, inteiro ou decimal. `ph`: número
    (`1`, `2`, `2.5`). `tag`: nome de player ou `everyone`. `spellid`: número.
    `text`, `glowunit` e chaves desconhecidas ficam guardados como vieram.
*   Cabeçalho: `EncounterID` (número), `Name` (texto), `Difficulty` (nome:
    `Normal`, `Heroic`, `Mythic`). Uma note é de um boss; um segundo cabeçalho
    vira "outra". `EncounterID` ou `Difficulty` diferentes do boss aberto viram
    um aviso no topo, sem bloquear.
*   Só o primeiro bloco `intstart`…`intend` conta. Linha vazia ou fora do
    padrão é "outra": fica só como texto.
*   **Sem perdas.** O texto da caixa (um campo de texto do navegador, que
    entrega tudo com LF) é guardado como veio. Cada linha guarda o próprio
    texto; exportar junta as linhas com LF, então cores `||c…||r`, ordem e
    chaves desconhecidas ficam como vieram. Só a linha mudada é reescrita:
    *   **mover** troca só o valor de `time`, em segundos inteiros
        (arredondado);
    *   **adicionar** escreve `time:<s>;ph:<ph>;tag:<nome curto do
        player>;spellid:<id>;` e insere depois da última linha `timer` da mesma
        `ph` com `time` menor ou igual; sem nenhuma, antes da primeira linha da
        mesma `ph`; sem linhas da `ph`, depois da última `timer` de `ph` menor.
*   **`tag`.** Casado com o nome curto dos players (sem realm, comparação sem
    caixa, como `parseAssignments`). `tag` que é player em algum pull do
    relatório, mas não neste pull: "fora do pull". `tag` que não é player em
    nenhum pull nem `everyone` (apelido, papel, grupo): "não avaliada", com
    aviso no topo.

### Versões da note

*   **Uma caixa só, duas chaves.** A caixa aparece na aba Interrupts e na seção
    de CDs. A **chave atual** (`wipe-cause:assignments:<encounter>:<dificuldade>`)
    continua com o texto puro da versão mais nova, no formato de hoje: a aba
    Interrupts, o placar, o Discord e a IA leem dela como sempre. As versões
    ficam numa chave nova (`wipe-cause:heal-note:<encounter>:<dificuldade>`),
    uma lista de `{ text, savedAt, night, fromPull, fromPullManual }` (`night` = a data local,
    `YYYY-MM-DD`, de `startMs` + `tzOffsetHours` do primeiro pull do boss no relatório, ou
    nulo; `fromPull` = `pullNumber`), com as últimas `MAX_VERSIONS` (sai a de
    `savedAt` mais antigo). Na primeira leitura, o texto da chave atual vira a
    primeira versão, sem noite.
*   **Salvar.** A caixa grava a cada mudança, como hoje, e sempre edita a
    versão mais nova:
    1.  Texto vazio numa versão de outra noite (ou sem noite) não cria nem
        apaga nada. Texto vazio numa versão da noite aberta deixa vazio o texto
        dela (e a chave atual fica vazia, como hoje).
    2.  Se a mais nova é da noite aberta, a edição só troca o texto
        (`savedAt` não muda).
    3.  Se a mais nova é de outra noite ou sem noite (a note colada depois da
        noite, CUJ 1), a primeira edição não vazia cria uma versão ligada à
        noite aberta, com o N padrão do item 3 abaixo.
    4.  O botão **"nova versão"** (a note ajustada entre as tries, CUJ 4)
        copia a mais nova, com o mesmo texto e o N padrão, e a caixa passa a
        editar a cópia; a ajuda da caixa diz "clique antes de editar". A
        versão anterior fica com o texto que tinha.
    5.  Enquanto o líder não mexeu no N de uma versão, o N padrão é
        recalculado a cada edição dela (`fromPullManual` falso).
*   **Qual versão julga cada pull:**
    1.  Versões ligadas à noite do pull: vale a de maior "a partir do pull N"
        que não passa do número do pull.
    2.  Sem versão da noite que valha para o pull: a versão da maior `night`
        menor que a do pull (a da semana passada; empate pelo `savedAt` mais
        novo); sem ela, a versão sem noite; sem nenhuma, o pull fica fora.
    3.  "A partir do pull N" padrão de uma versão nova: se a noite já tem
        versão, ou se o relatório está ao vivo, o pull seguinte ao último pull
        do boss no relatório naquele momento (a note ajustada entre as tries,
        CUJ 4); senão, o primeiro pull em que todos os players com linha na
        note estão na raide (a note colada depois da noite, CUJ 1).
    4.  O líder muda N de qualquer versão na tela, e a mudança fica salva.
    5.  Versão que não julga nenhum pull do relatório aparece com o aviso "não
        julga nenhum pull desta noite".
*   **Interrupts.** `parseAssignments` passa a ler só o trecho entre
    `intstart` e `intend` quando ele existe. Texto com cara de NSRT
    (cabeçalho `EncounterID:` ou linhas com `time:` e `ph:`) sem bloco não
    gera escala. Texto que não parece NSRT é lido inteiro, como hoje. A escala
    de interrupts continua lendo a versão mais nova, pela chave atual (ver [Riscos e
    limites](#riscos-e-limites)).

### Casar as fases e medir o desvio

*   **`ph` → fase.** As fases do pull (`phaseMarks`), em ordem: a fase com
    chave `p<n>` é `ph:n`; uma fase com outra chave é `ph:<n>.5`, com `n` a
    última `p<n>` antes dela. Duas fases sem `p<n>` seguidas dariam o mesmo
    `<n>.5`: as duas ficam sem par. Fase que se repete no pull: só a primeira
    vez. Boss sem `phases`: `ph:1` é o pull inteiro, desde o início. O topo
    da aba mostra o casamento ("ph:2.5 = The Claimed Vessel"). `ph` sem par
    deixa as linhas "não avaliadas". Na tela, o rótulo é `P<ph>` ("P2.5
    +0:15"), com o nome da fase no tooltip.
*   **Os dois passes.** O casamento linha ↔ cast roda duas vezes: o primeiro
    usa a hora sem ajuste e só serve para medir o desvio; o segundo usa a hora
    ajustada e decide o estado da linha.
*   **Casamento linha ↔ cast.** Num pull, entre todas as linhas e os casts do
    mesmo player e da mesma spell (`casts` do `PlayerStats`, com o id e os
    `alt_ids`), o par de menor |Δ| a até `PAIR_MS` casa primeiro, e assim por
    diante; um cast casado não serve a outra linha. O cast pode ser de outra
    fase.
*   **Desvio por fase.** O addon troca de fase pelo que o boss mod vê no jogo,
    e esse evento não aparece de forma garantida no combat log, então o app
    mede a diferença:
    *   pares (linha, pull) casados no primeiro passe, em todos os pulls
        julgados (cada um com a sua versão); desvio = mediana de (uso − hora
        sem ajuste); sem pares, não há desvio;
    *   a primeira fase (a que começa no pull) não recebe desvio: o addon e o
        app começam no mesmo evento (etapa 0: −0,1 s no P1), então ali uma
        diferença só pode ser atraso de todos;
    *   o desvio é **estável** quando há pelo menos `MIN_OFFSET_LINES` pares
        em pelo menos 2 pulls; uma regra de dispersão entre pulls só entra se a
        medição da etapa 1 mostrar desvio instável;
    *   só é aplicado o desvio estável com |desvio| ≤ `MAX_OFFSET_MS`; os
        outros aparecem no topo, sem ser aplicados;
    *   um desvio estável é o relógio do addon ou um atraso de todos os healers
        ao mesmo tempo; o app não separa os dois, mostra o desvio no topo e o Δ
        sem ajuste ao lado do ajustado. Na etapa 0, o desvio do P2 foi parecido
        nas três noites e em quase toda linha, o que aponta para o relógio.
*   **Hora ajustada** de uma linha = início da fase no pull + `time` + desvio
    aplicado da fase (0 sem desvio aplicado).

### Estados de cada linha

Avaliados nesta ordem; vale o primeiro que se aplica:

| Estado | Condição |
| --- | --- |
| `not_evaluated` | sem `spellid`, `tag:everyone`, `tag` desconhecido ou `ph` sem par |
| `not_in_pull` | o `tag` é player de outro pull do relatório, não deste |
| `phase_not_reached` | a fase da linha não está nos `phaseMarks` do pull |
| `phase_ended` | a hora ajustada passa do início da fase seguinte no relógio do addon (início no app + desvio aplicado dela): o addon não toca o lembrete |
| `after_cutoff` | hora ajustada depois do corte (`cutoffT`, ou o fim do pull) |
| `no_spell` | a spec do player não está em `specs` da tabela; ou a spell é de `talent` ou está fora da tabela e o player não a castou (nem `alt_ids`) em nenhum pull do relatório |
| `on_time` | casado no segundo passe com \|Δ\| ≤ `ON_TIME_MS` |
| `early` / `late` | casado com `ON_TIME_MS` < \|Δ\| ≤ `PAIR_MS`; Δ negativo ou positivo |
| `dead` | sem cast casado, e o player morreu antes da hora ajustada e não castou nada entre a morte e a hora ajustada + `PAIR_MS` (castar de novo = foi ressuscitado) |
| `not_used` | sem cast casado |

Um uso feito antes de o player morrer continua casado. `no_spell` por
talento ou fora da tabela aparece com o aviso "nunca usada na noite": pode ser
talento não escolhido ou CD esquecido a noite toda.

### Golpes e momentos

Golpes, marcos e momentos não dependem da note: ficam em `src/lib/raidHits.ts`,
que `healNoteCheck.ts` usa.

**Golpes de um pull** (com `s(i)` = `unavoidableK[i]` e `V(i)` = `maxHpK[i]`):

```text
W(i)     = s(i) + … + s(i+4)                     (janela de 5 s)
forte(i) = V(i) > 0 e W(i) ≥ STRONG_HIT_SHARE × V(i)
grupo    = segundos forte(i) seguidos (aceita buraco de até 4 s)
i0       = primeiro i forte do grupo
início   = primeiro j ≥ i0 com s(j) ≥ HIT_ONSET_SHARE × W(i0)
fim      = último i forte + 5 s;  tamanho = maior W(i)/V(i) do grupo
```

O `início` corrige a janela que olha para frente: sem ele, um golpe
instantâneo no segundo s começaria em s − 4. Sem amostras de vida (`low` nulo)
não há golpes nem raide baixa: a aba mostra só o timing.

**Marco do golpe.** Um cast do boss:

1.  Os marcos da noite são as spells inimigas que `anchorTimes`
    (`src/lib/benchMetrics.ts`) aceita (até `MAX_ANCHOR_CASTS` casts) na
    maioria dos pulls que chegaram na fase em que a spell é castada.
2.  Se a spell com mais dano no golpe (`enemyHits`, do início ao fim) é um
    marco da noite e tem cast até 15 s antes do início, a chave é
    `<spell>:<k>`, com o cast mais perto do início e `k` = qual cast dela no
    pull.
3.  Senão, `nearestAnchor(início, marcos)` (`src/lib/cdAnchors.ts`) entre os
    marcos da noite: o cast mais perto entre 30 s antes e 15 s depois do
    início (a função aceita uso de 15 s antes a 30 s depois do cast):
    `<spell>:<k>`.
4.  Sem marco (dano sem cast: DoT, stacks): o golpe aparece só na aba do pull,
    sem entrar na noite nem na note sugerida (a calibração da etapa 2 conta
    quantos são; Open Questions).

Golpes do mesmo pull com inícios a menos de `SAME_MOMENT_MS` viram um (chave e
início do primeiro, fim do último, maior tamanho). Dois golpes do mesmo pull
com a mesma chave: fica a chave no de maior tamanho, e o outro fica sem marco.

**Momento da noite.** Uma chave que foi golpe em pelo menos 2 pulls (ou no
único pull que chegou nela); um pico que aconteceu uma vez só não vira
momento. A **fase do momento** é a fase em que caiu o k-ésimo cast do marco na
maioria dos pulls que chegaram nele (e, nos marcos da noite, cada cast conta
na fase em que caiu). Para cada pull:

*   **chegou** no momento: tem o k-ésimo cast do marco antes do corte. Todo
    pull que chegou conta como tendo o momento, com ou sem golpe naquele pull:
    uma redução de dano bem usada pode ter segurado o dano abaixo do limite;
*   **hora do momento no pull:** o início do golpe, se o pull teve o golpe;
    senão, o cast do marco + a mediana de (início − cast) nos pulls que
    tiveram o golpe;
*   **tempo do momento, no relógio da note:** a mediana de (início do golpe −
    início da fase − desvio aplicado da fase) nos pulls com o golpe, mostrada
    como "P2 +0:15". Numa fase sem desvio aplicado, o tempo aparece com o
    aviso "relógio do app", e a note sugerida não mexe nela;
*   **dano mediano:** a mediana do tamanho (em % da vida máxima da raide) nos
    pulls com o golpe, com "golpe em X de Y pulls".

Golpe que um CD cobriu bem em todos os pulls nunca passa do limite e não vira
momento (ver [Riscos e limites](#riscos-e-limites)).

**Raide baixa.** Segundos com `low[i] ≥ LOW_SHARE × alive[i]`, por pelo menos
`LOW_MIN_S` seguidos. É "sem golpe" quando não cai entre a hora de um momento −
5 s e o fim do golpe + `RECOVER_MS` (sem golpe no pull: hora + 5 s +
`RECOVER_MS`). Na noite, os episódios são juntados pela regra de marco do item
3 acima; sem marco, aparecem só na aba do pull.

### Janela de cada tipo de efeito

Com `u` = hora do uso (ou a hora ajustada da linha, para a associação), `d` =
`duration_ms` (o app não mede um CD cancelado antes), e o momento de `início`
(a hora do momento no pull) a `fim` (o fim do golpe, ou início + 5 s):

| `effect` | Cobre o momento quando | Janela do "sem dano" |
| --- | --- | --- |
| `active` (redução) | `u ≤ início + 1 s` e `u + d ≥ início`: ativo quando o dano começa | [u, u + d] |
| `sustained` (dura) | [u, u + d] cruza [início, fim + `RECOVER_MS`] | [u, u + d + `RECOVER_MS`] |
| `burst` (rajada) | `início − 2 s ≤ u ≤ fim + RECOVER_MS` | [u − 5 s, u + d + `RECOVER_MS`] |

### Veredictos

Em `src/lib/healNoteCheck.ts`, por pull:

*   **Associação linha ↔ momento:** a linha (de `kind` `heal` ou
    `mitigation`) é **do momento** M quando a hora ajustada dela cobre M pela
    tabela acima; com mais de um, o de hora mais perto da hora ajustada.
*   **No golpe:** linha com momento associado cujo uso casado também cobre o
    momento. Linha sem momento associado: "no golpe" não se aplica (e ela pode
    virar um "mover"). Na tela, "CD planejado não veio" é a linha com momento
    e estado `not_used` ou `dead`, e "fora do golpe por timing" é a linha com
    momento, `on_time` e "no golpe: não" (a linha está no lugar certo; o
    problema é o timing do player, e não vira "mover"): combinações das
    colunas, sem estado próprio.
*   **Golpe sem CD:** momento que o pull alcançou sem nenhuma linha associada
    com uso casado (`on_time`, `early`, `late`) nem estado `not_used` ou
    `dead`. Linhas `not_in_pull` e `no_spell` não cobrem.
*   **Raide baixa sem golpe:** o episódio de [Golpes e
    momentos](#golpes-e-momentos).
*   **Uso de ciclo** (na linha, igual em todos os pulls): a linha não tem
    momento associado em nenhum pull, a próxima linha do mesmo player e spell
    na note tem, e mover esta linha para o próximo momento (tempo do momento −
    `PREP_MS` para `active` e `sustained`, o tempo para `burst`) faria a
    próxima cair antes de o cooldown acabar (`cooldown_ms`), com o tempo
    absoluto de cada linha pela mesma conta da [Note sugerida](#note-sugerida)
    (início mais cedo da fase + `time`). Linha de ciclo não recebe nenhum
    veredicto de uso e aparece em cinza.
*   **Sem dano:** uso casado de `kind: heal` (fora de linha de ciclo) sem
    nenhum momento do pull cujo [início, fim] cruze a janela do "sem dano" e
    sem segundo de raide baixa nela. Redução de dano (`mitigation`) não recebe
    "sem dano", pelo mesmo motivo do "empilhado": o log não mostra quanto ela
    evitou; uma redução fora de hora aparece pelo "no golpe" e pelo "mover".
*   **Overheal do uso:**
    *   **Fração:** overheal ÷ (cura + overheal), somando os `heal_ids` do CD
        em `cdHeals` na janela do "sem dano".
    *   **Referência:** as referências que `selectHealRefs(pull, healer)` de
        `src/lib/healer.ts` escolhe (mesmo número de healers, sem os logs
        distorcidos, ordem pela composição; `docs/healer-analysis.md` §2). Em
        cada referência, a fração `cdSpells[id].overheal` de cada `heal_id`
        (campo novo das referências, separado das `spells` que a análise de
        healer já usa); com mais de um `heal_id`, a média ponderada pela fatia
        de cura (`cdSpells[id].share`). A faixa é a `Band` desses números, com pelo menos
        `MIN_REFS` (com menos, só o número).
    *   **Overheal alto:** acima do p75 + `OVERHEAL_MARGIN`.
    *   **Por que a luta inteira serve:** `heal_ids` só leva spells que existem
        durante o CD, então o número da luta de uma referência é a média dos
        usos dela.
    *   **CD sem `heal_ids`** (Convoke, Apotheosis): sem "overheal alto" e sem
        "empilhado".
    *   **Noite e pull:** na noite, o número de um CD de um player é a soma dos
        overheals ÷ a soma das curas de todos os usos dele, contra as
        referências do pull mais recente julgado; na aba do pull, o uso do
        pull, com o aviso de que é um uso só. A média dos nossos usos aparece
        só ao lado, sem cor (G10).
*   **Empilhado:** dois ou mais usos casados de linhas da note, de `kind`
    `heal` com `heal_ids`, associados ao mesmo momento; o rótulo vai em cada
    um que tem overheal alto. Redução de dano empilhada não é julgada: o log
    não mostra quanto cada uma evitou.

### Agregação na noite

*   **Por versão:** a tabela por linha e a note sugerida são de uma versão da
    note: a tela mostra uma seção por versão que julgou algum pull, só com os
    pulls que ela julgou, e "Copiar" exporta aquela versão. O desvio de fase e
    os momentos usam todos os pulls, porque não dependem da note.
*   **Por linha:** os pulls que chegaram (estado diferente de
    `not_evaluated`, `not_in_pull`, `phase_not_reached`, `phase_ended` e
    `after_cutoff`), quantos `on_time`, quantos "no golpe" e o Δ mediano.
*   **Por momento:** os pulls que chegaram, quantos tiveram o golpe, quantos
    com cada problema e o dano mediano.

### Note sugerida

Mudanças de um passo, só em fase com desvio aplicado (ou na primeira fase), com
pelo menos 3 pulls que chegaram no momento e com o problema em metade deles ou
mais. A conta de cooldown entre fases usa o tempo absoluto estimado de cada
linha: o início **mais cedo** da fase entre os pulls que chegaram nela +
`time` (o pior caso, num push rápido).

*   **Adicionar** uma linha num "golpe sem CD": a lista dos CDs **livres**
    naquele momento, e o líder marca um. Candidatos: cada spell `heal` ou
    `mitigation` da tabela cuja spec bate com a de algum player com linha na
    note (e, se for `talent`, que ele castou na noite), em que a linha anterior
    do mesmo player e spell está a mais de `cooldown_ms` antes, e a próxima
    continua a pelo menos `cooldown_ms` depois. Cada candidato já vem com o
    `time`: o tempo do momento − `PREP_MS` para `active` e `sustained`, ou o
    próprio tempo para `burst`. Ao lado de cada um, quantas referências de fora
    (da spec do player candidato) têm um uso daquele CD cujo cast mais perto,
    por `nearestAnchor` sobre os `cdUses` e `anchors` delas, é o marco do
    momento; só como informação: elas marcam o momento pelo uso do CD e só têm
    CDs de healer.
*   **Mover** uma linha (fora de linha de ciclo) cuja hora ajustada não cobre
    nenhum momento em metade ou mais dos pulls que chegaram, e que fica
    `on_time` nesses pulls. Destino: o momento da mesma fase mais perto da
    hora da note, a até `PAIR_MS`; ele pode já ter outra linha. Novo `time` =
    tempo do momento − `PREP_MS` para `active` e `sustained`, ou o próprio
    tempo para `burst`. A mudança não troca a `ph`, só sai se a cadeia de usos
    do mesmo player continua cabendo no cooldown, e é descartada se o `time`
    novo arredondado é igual ao atual.

Cada mudança mostra o motivo (momento, pulls, dano mediano, referência) e uma
caixa de seleção; "Copiar" exporta pela regra sem perdas.

### Tela

Um componente, `HealNotePanel`, recebe `pulls[]` do mesmo boss e dificuldade:

*   **Resumo do boss na noite** (`BossSummaryInner` em
    `src/components/NightSummary.tsx`): uma seção "CDs de cura" depois dos
    tempos de fase.
*   **Aba do pull**: "CDs de cura" no grupo "O que aconteceu", depois de
    Interrupts, só no foco Guilda. Mostra o pull aberto e usa os outros pulls
    do mesmo boss no relatório para o desvio, os marcos e os momentos.
*   **▶ na aba do pull:** troca para a aba Replay, com o replay completo
    começando naquele instante. Só aparece quando o replay completo pode ser
    carregado (log do PC no desktop); no Warcraft Logs e na web, não aparece.
    No resumo da noite, o número do pull abre o pull (`onSelectPull`).

Partes: caixa da note (um componente só, usado também pela aba Interrupts), as
versões com "a partir
do pull N" e o casamento de fases no topo; tabela por linha
(CD com ícone e nome, player na cor da classe, "P2 +0:15", estado, Δ); lista
de momentos (skill do boss com ícone, k, pulls, dano mediano, problemas); note
sugerida. Item selecionado muda só o fundo, sem faixa lateral. Textos em
`HealNotePanel.i18n.ts` (pt e en). Vocabulário: "note" / "note", "golpe sem
CD" / "uncovered hit", "na hora" / "on time", "no golpe" / "on the hit", "uso
de ciclo" / "cycle use", "raide baixa" / "raid low".

### Etapas

Cada etapa num PR, com aprovação do desenvolvedor; o design fica Approved
entre elas e vira Implemented no último PR.

1.  **Note e timing** (`src/`, `data/` e um teste do núcleo, sem código novo
    nele): `data/heal-cooldowns.json` (lido só pela interface nesta etapa),
    `healNote.ts`, versões, escala de interrupts protegida, casar fases,
    desvio, estados, `HealNotePanel` com a tabela por linha, nas duas telas.
2.  **Golpes e uso** (núcleo + `src/`): a tabela lida também pelo núcleo,
    `raidSeries`, `enemyHits`, `cdHeals`, calibração do limite do golpe,
    `raidHits.ts` (golpes, marcos, momentos, raide baixa), "no golpe", "sem
    dano", ciclo, golpe sem CD.
3.  **Overheal e note sugerida** (`src/` e `scripts/`): `heal_ids` gravados
    nas referências e a conferência da tabela no fluxo de referências de
    healer, régua de overheal, "empilhado", mudanças sugeridas e export.

## Alternatives Considered

### Alternative A: Análise inteira no núcleo, com a note no relatório

*   **Pros**: um lugar só para a lógica; o resultado iria para o histórico.
*   **Cons**: a note muda entre os pulls e costuma ser colada depois da
    análise.
*   **Reason for Rejection**: cada edição da note pediria reanalisar a noite
    (num report do Warcraft Logs, baixar tudo de novo). O núcleo emite só
    séries genéricas, e a conta sobre a note roda na interface, como a aba
    Interrupts já faz.

### Alternative B: Início de fase da note escrito na regra do boss

*   **Pros**: sem medir nada em tempo de análise; o mesmo número em toda
    noite.
*   **Cons**: um campo novo em `phases` por boss (critério b do fluxo), medido
    e mantido à mão a cada boss novo; não acompanha uma mudança no addon.
*   **Reason for Rejection**: o evento que o addon usa para trocar de fase não
    aparece de forma garantida no combat log, então o campo seria um número
    medido à mão, o mesmo que o app mede sozinho. Se um boss mostrar desvio
    instável toda noite, o campo volta a ser considerado.

### Alternative C: Raide baixa pela média de vida abaixo de 50%

*   **Pros**: um número só, fácil de explicar.
*   **Cons**: em 26/10 aconteceu em 0,1% dos segundos (3 episódios em 19
    pulls); a maioria das mortes veio com a média em 70–90%.
*   **Reason for Rejection**: quase nunca acontece, então não marcaria os
    momentos ruins. Trocado por "um quarto dos vivos sem tanks abaixo de 50%"
    (desenvolvedor, 2026-10-27).

### Alternative D: Lorrgs como referência de onde usar cada CD

*   **Pros**: é o que a guilda já olha; cobre também CDs de quem não é healer.
*   **Cons**: integração nova (critério c); as timelines saem dos tops do
    ranking.
*   **Reason for Rejection**: os tops são os logs que o
    `docs/healer-analysis.md` evita (raide tomando dano a mais, menos healers).
    A referência externa é a que o app já tem, `src/data/heal-refs`, e ela só
    reforça o motivo de uma mudança sugerida; o golpe vem dos nossos pulls.

### Alternative E: Pôr os CDs de cura em `defensives.json` ou em `cooldowns.ts`

*   **Pros**: sem arquivo novo.
*   **Cons**: `defensives.json` alimenta "morreu sem defensivo" e o replay;
    `cooldowns.ts` é só TypeScript e marca janelas de burst.
*   **Reason for Rejection**: misturar CDs de cura no `defensives.json` muda
    essas análises, e o núcleo não lê `cooldowns.ts`, que também não tem
    duração, tipo de efeito nem ids da cura. Ler os YAMLs de rotação na
    interface (empacotar todos no build web) traria as rotações inteiras para
    usar dois campos. Fica `data/heal-cooldowns.json`, com a cópia conferida
    por teste.

### Alternative F: Overheal comparado com a média dos nossos usos

*   **Pros**: sempre há número, para qualquer CD.
*   **Cons**: faz dos nossos healers a régua do "certo".
*   **Reason for Rejection**: a [regra
    2](../CONTRIBUTING.pt-BR.md#regras-do-projeto) proíbe (G10).

### Alternative G: Cooldown real medido por player para o uso de ciclo

*   **Pros**: pega talentos e reduções de cooldown.
*   **Cons**: quem usa o CD uma vez por pull não gera intervalo; cargas e
    resets puxam o intervalo para baixo.
*   **Reason for Rejection**: a medida falha justamente nos CDs longos. Com o
    `cooldown_ms` base e reduções no jogo, o CD volta antes do que o app supõe,
    então o erro só deixa de reconhecer um uso de ciclo, nunca acusa alguém
    (ver [Riscos e limites](#riscos-e-limites)).

### Alternative H: Duas caixas, uma para interrupts e outra para CDs

*   **Pros**: nenhuma mudança na aba Interrupts.
*   **Cons**: o líder copia uma note só do addon.
*   **Reason for Rejection**: duas caixas ficam fora de sincronia, e colar a
    note inteira na caixa de interrupts já polui a escala hoje. Fica uma caixa,
    com a escala protegida (G2).

### Alternative I: Note sugerida montada do zero

*   **Pros**: poderia achar uma distribuição melhor de todos os CDs.
*   **Cons**: ignora o que a guilda combinou (usos de ciclo, quem fica com qual
    mecânica).
*   **Reason for Rejection**: seria difícil de explicar mudança por mudança, e
    o líder decide em cima da note dele. Ficam só mudanças de um passo, cada
    uma com motivo.

### Alternative J: Golpe medido pull a pull, sem momentos da noite

*   **Pros**: mais simples; cada pull se explica sozinho.
*   **Cons**: uma redução de dano bem usada corta o dano abaixo do limite e
    apaga o golpe que ela cobriu.
*   **Reason for Rejection**: no pull em que o CD funcionou, ele seria julgado
    "sem dano" e viraria sugestão de "mover". Os momentos são definidos na
    noite e cada pull é julgado pela presença do marco.

### Alternative K: Calibrar o golpe com logs de fora da guilda

*   **Pros**: nenhuma dúvida sobre a regra 2.
*   **Cons**: pede baixar a série de dano dos kills de referência e um script
    novo na etapa 2.
*   **Reason for Rejection**: o desenvolvedor decidiu (2026-10-27) que o limite
    do golpe é parâmetro da luta, não meta do healer, e pode ser calibrado nos
    logs da guilda (G10).

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Compatibilidade.** Todos os campos novos do relatório são opcionais.
    Análise antiga (sem `raidSeries`) mostra só o timing e um aviso "reanalise
    para ver golpes e uso"; nada quebra. O texto salvo hoje vira a primeira
    versão, sem perder nada.
*   **Tamanho e custo.** Ver [Dados novos no
    relatório](#dados-novos-no-relatório). A interface recalcula a noite ao
    colar a note (dezenas de pulls, contas por segundo): uma passada linear
    por pull, guardada em memória enquanto a note e os pulls não mudam.
*   **Web e desktop.** O mesmo núcleo (WASM) e o mesmo TypeScript; a note fica
    no armazenamento local de cada um, como a de interrupts hoje.
*   **Privacidade.** Nada novo sai do aparelho.

### Riscos e limites

| Modo de falha | Mitigação ou limite aceito | Onde |
| --- | --- | --- |
| Culpa falsa por relógio do addon | desvio medido por fase, só o estável e até `MAX_OFFSET_MS`; Δ sem ajuste ao lado | Casar as fases |
| Desvio esconde atraso de todos | sem desvio na primeira fase; teto `MAX_OFFSET_MS`; aviso no topo | Casar as fases |
| Lembrete que o addon não tocou (fase acabou antes) | estado `phase_ended`, sem culpa | Estados |
| Esquecer o CD a noite toda vira "não tem a spell" | `no_spell` pela spec; por talento ou fora da tabela, com aviso "nunca usada na noite" | Estados |
| Redução de dano bem usada apaga o golpe | momentos da noite: todo pull que chegou no marco tem o momento, com ou sem golpe | Golpes e momentos |
| Pico raro vira momento | momento pede golpe em 2 pulls | Golpes e momentos |
| Golpe coberto bem em todos os pulls não vira momento | limite aceito: redução de dano não recebe "sem dano"; uma cura nesse golpe pode sair "sem dano" (o líder vê o golpe no replay) | Veredictos |
| Golpe sem cast do boss (DoT, stacks) | só na aba do pull; a calibração da etapa 2 conta quantos são | Golpes e momentos |
| Golpe começando antes do dano | início pelo primeiro segundo com `HIT_ONSET_SHARE` do dano | Golpes e momentos |
| Chave do momento diferente entre pulls | marcos da noite; preferência pelo cast da spell que fez o golpe; regra de colisão | Golpes e momentos |
| Dano de regra com aura conta como inevitável (Gloombomb, splash dos orbs) | limite aceito, o mesmo da aba Mortes | Dados novos |
| Log sem advanced logging | sem golpes nem raide baixa, só timing | Dados novos |
| Convenção de `ph` do NSRT sem documento | casamento no topo; `ph` sem par fica "não avaliado", sem culpa | Casar as fases |
| `tag` que não é nome de player | "não avaliada" com aviso | Formato NSRT |
| Referências sem o CD (só as 12 maiores spells) | etapa 3 grava os `heal_ids` nas referências; com menos de `MIN_REFS`, só o número | Veredictos |
| Overheal da luta inteira × um uso | `heal_ids` só com spells exclusivas do CD; aviso "um uso só" no pull | Veredictos |
| Reduções de cooldown (talentos) | `cooldown_ms` base: só deixa de reconhecer ciclo, nunca acusa | Alternative G |
| Escala de interrupts poluída pela note | só o bloco `int`; NSRT sem bloco não gera escala | Versões |
| Interrupts pela versão mais nova e CDs pela versão de cada pull | limite aceito: a escala de interrupts não muda nesta feature (a chave atual continua com o texto puro) | Versões |
| Tabela de CDs desatualizada depois de patch | teste do núcleo contra rotações e `defensives.json`; conferência no fluxo de referências de healer (etapa 3) | Tabela de CDs |

### Rollback

Cada etapa é um PR separado. Reverter a etapa 1 tira a aba e a seção; a chave
de hoje continua com o texto puro da versão mais nova, então a aba Interrupts
segue lendo como antes, e a chave das versões fica sem uso. Reverter a etapa 2 ou 3 volta à etapa anterior: os campos novos do
relatório são opcionais e são ignorados.

--------------------------------------------------------------------------------

### Additional Resources

*   [Regras do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto) e
    [Fluxo de feature](../CONTRIBUTING.pt-BR.md#fluxo-de-feature).
*   [docs/healer-analysis.md](../healer-analysis.md): referências de healer de
    fora da guilda (regra 2) e o formato dos veredictos.
*   [gloombomb-assignment.md](gloombomb-assignment.md): design anterior no
    mesmo fluxo.

### Future Improvements

*   **Externos em tank:** golpe em um alvo, tank buster, quem tinha Ironbark,
    Pain Suppression ou Guardian Spirit livre.
*   **Formato MRT clássico** (`{time:1:05,p2}`).
*   **Conferir `glowunit`** (alvo de Power Infusion e Innervate).
*   **Mudança sugerida "remover linha"** e trocas entre dois players.
*   **Escolha automática do CD no "adicionar"** (pelas referências de fora).
*   **Trocar à mão o par `ph` → fase**, se aparecer uma note real que não case.
*   **Golpes sem cast do boss na noite e na note sugerida**, se a calibração
    mostrar que pesam.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Arquivos por etapa (regra de PR em [Etapas](#etapas)). O PR da etapa 1 também
traz este design (Status Approved) e a linha no SITEMAP. Constantes com os
nomes e valores da tabela [Constantes](#constantes). Chave atual =
`wipe-cause:assignments:<encounter>:<dificuldade>`; chave das versões =
`wipe-cause:heal-note:<encounter>:<dificuldade>`.

### Etapa 1: note e timing

#### 1. `data/heal-cooldowns.json` (Create)

*   **Type / Scope**: dado de classe, embutido no build.
*   **Proposed Changes**: `{ "_comment", "cooldowns": [ { id, name, class,
    specs?, talent?, alt_ids?, kind?: "heal" | "mitigation", effect?: "burst" |
    "sustained" | "active", duration_ms?, cooldown_ms?, heal_ids? } ] }`.
    Tabela inicial (ids de spec como em `data/defensives.json`):

    | id | Nome | specs | kind | effect | duration_ms | cooldown_ms | talent | alt_ids | heal_ids |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | 740 | Tranquility | 105 | heal | sustained | 6000 | 180000 | | | 157982 |
    | 391528 | Convoke the Spirits | 105 | heal | sustained | 4000 | 120000 | sim | 323764 | |
    | 108280 | Healing Tide Totem | 264 | heal | sustained | 10000 | 180000 | sim | | 114942 * |
    | 114052 | Ascendance | 264 | heal | sustained | 15000 * | 180000 | sim | | 114083 * |
    | 98008 | Spirit Link Totem | 264 | mitigation | active | 6000 | 180000 | sim | | |
    | 64843 | Divine Hymn | 257 | heal | burst | 5000 | 180000 | | | 64844 |
    | 200183 | Apotheosis | 257 | heal | sustained | 20000 * | 120000 | sim | | |
    | 62618 | Power Word: Barrier | 256 | mitigation | active | 10000 | 180000 | | | |
    | 472433 | Evangelism | 256 | heal | sustained | 6000 * | 90000 | sim | | |
    | 31821 | Aura Mastery | 65 | mitigation | active | 8000 * | 180000 | | | |
    | 31884 | Avenging Wrath | 65 | heal | sustained | 20000 * | 120000 | | 216331 | |
    | 115310 | Revival | 270 | heal | burst | 1000 | 180000 | | 388615 | 115310, 388615 |
    | 322118 | Invoke Yu'lon | 270 | heal | sustained | 25000 * | 120000 | sim | 325197 | |
    | 363534 | Rewind | 1468 | heal | burst | 5000 * | 240000 | | | 363534 |
    | 374227 | Zephyr | 1467, 1468, 1473 | mitigation | active | 8000 * | 120000 | | | |
    | 97462 | Rallying Cry | 71, 72, 73 | mitigation | active | 10000 * | 180000 | | | |
    | 51052 | Anti-Magic Zone | 250, 251, 252 | mitigation | active | 8000 | 240000 | sim | | |
    | 196718 | Darkness | 577, 581, 1480 | mitigation | active | 8000 | 300000 | sim | | |
    | 106898 | Stampeding Roar | | | | | | | 77761, 77764 | |

    Valores com * são conferidos antes de fechar o item, num log da guilda
    (fora do git), com uma conta só: `duration_ms` = duração mediana da aura
    do CD no player que castou, e cada `heal_id` só aparece com a aura ativa.
    Se o log mostrar outro número, vale o do log.

#### 2. `crates/wipe-core/tests/heal_cooldowns.rs` (Create)

*   **Type / Scope**: teste Rust (`cargo test -p wipe-core`), sem código novo no
    núcleo.
*   **Proposed Changes**: lê `data/heal-cooldowns.json`, os `rotations/*.yaml`
    (com `yaml_serde`, já dependência do crate) e `data/defensives.json`. Para
    cada entrada com `kind`, procura o id e os `alt_ids` nas habilidades das
    rotações cujo spec está em `specs`, e no `defensives.json`; em cada fonte
    onde aparece:
    *   rotação: `cooldown_ms` igual; `duration_ms` igual ao `channel_ms`,
        quando existe; os `alt_ids` da rotação contidos nos da tabela;
    *   `defensives.json`: `cooldown_ms` = `cd` × 1000; `duration_ms` =
        `zone.duration` × 1000, quando existe.

    O teste falha com: entrada com `kind` sem `specs`, `effect`, `duration_ms`
    ou `cooldown_ms`; número diferente de uma fonte; `heal_id` (fora o id do
    próprio CD e os `alt_ids` dele) que é habilidade de uma rotação das
    `specs`. Entrada que não
    está em nenhuma fonte só passa pela conferência dos campos.

#### 3. `src/lib/healCooldowns.ts` (Create)

*   **Type / Scope**: módulo TypeScript.
*   **Proposed Changes**: importa o JSON (como `arenas.ts` faz com
    `data/arenas.json`) e expõe `healCd(spellId)` (por id ou `alt_ids`) e
    `castIdsOf(spellId)` (o id e os alternativos).

#### 4. `src/lib/healer.ts` (Modify)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: exportar `quantile` (devolve `null` com lista vazia);
    nada muda no comportamento.

#### 5. `src/lib/healNote.ts` (Create)

*   **Type / Scope**: módulo TypeScript puro; não importa `assignments.ts`.
*   **Proposed Changes**:
    *   `parseNote(text): ParsedNote`: `header` (`encounterId`, `name`,
        `difficulty`), `lines: NoteLine[]` (cada uma com `raw` e, quando for
        `timer`, `time`, `ph` — string normalizada, `"2.5"` —, `tag`,
        `spellId?`, `text?`, `glowunit?` e `extra`), `intBlock: string | null`
        (`intstart` sem caixa, em linha própria; sem `intend`, até o fim) e
        `isNsrt` (tem cabeçalho ou linhas `timer`), pela gramática de [Formato
        NSRT](#formato-nsrt).
    *   `exportNote(parsed, changes: NoteChange[]): string`: junta `raw` com
        LF; `move` reescreve só o valor de `time`; `add` insere pela regra de
        [Formato NSRT](#formato-nsrt). Sem mudanças, devolve o texto de entrada.
    *   `mapPhases(phaseMarks): Map<string, PhaseMark>`: a regra de [Casar as
        fases e medir o desvio](#casar-as-fases-e-medir-o-desvio), com a
        expressão `/^p(\d+)$/i` de `src/lib/phases.ts`; boss sem `phases` →
        `"1"` = `{ key: 'p1', name: '', t: 0 }`.
    *   Versões, pela regra de [Versões da note](#versões-da-note), com o tipo
        `NoteVersion = { text: string; savedAt: number; night: string | null;
        fromPull: number; fromPullManual: boolean }` (`night` = `YYYY-MM-DD`
        de `startMs` + `tzOffsetHours` do primeiro pull do boss; `fromPull` = `pullNumber`):
        *   `noteVersions(key)`;
        *   `editNote(key, text, nightPulls, live)`: os itens 1–3 e 5 de
            "Salvar";
        *   `newVersion(key, nightPulls, live)`: o item 4 (copia a mais nova);
        *   `setFromPull(key, savedAt, pullNumber)` (marca
            `fromPullManual`);
        *   `noteFor(pull, nightPulls): NoteVersion | null`.

        Toda gravação escreve também o texto da versão mais nova, puro, na
        chave atual (texto vazio: remove a chave atual, como hoje). Na primeira
        leitura sem versões, o texto da chave atual vira a primeira versão
        (`night: null`, `fromPull: 0`). Acima de `MAX_VERSIONS`, sai a de
        `savedAt` mais antigo.

#### 6. `src/lib/healNote.test.ts` (Create)

*   **Type / Scope**: teste (Vitest, com `vi.stubGlobal('localStorage', …)`
    como em `src/lib/score.test.ts`).
*   **Proposed Changes**:
    *   parse e export: a note de exemplo (nomes fictícios) faz a ida e volta
        e sai idêntica; `move` muda só um `time`; `add` no meio, antes da
        primeira linha da fase, em fase sem linhas e depois da última linha;
        cabeçalho, `isNsrt` e `intBlock` (com e sem `intend`, `INTSTART` em
        maiúsculas);
    *   `mapPhases` com p1/p2/intermission/p3 (→ "1", "2", "2.5", "3"), só p1,
        boss sem `phases`, duas fases sem `p<n>` seguidas e fase repetida;
    *   versões: migração da chave atual; CUJ 1 (colar depois da noite, sem
        versão da noite: cria a versão da noite com N no primeiro pull com
        todos os nomes; apagar e colar de novo recalcula N); CUJ 4 ao vivo
        (primeira versão começa no pull seguinte ao último; v1 → "nova versão"
        → editar: a v1 continua com o texto original); N trocado à mão não é
        recalculado; versão da semana passada (maior `night` anterior) julga
        os pulls antes da primeira versão da noite; sem versão nenhuma, pull
        fora; editar a versão da noite não muda `savedAt`; texto vazio numa
        versão de outra noite não cria nem apaga; chave atual sempre com o
        texto puro da mais nova; `MAX_VERSIONS`.

#### 7. `src/lib/assignments.ts` (Modify)

*   **Type / Scope**: módulo TypeScript.
*   **Proposed Changes**: `parseAssignments(text, pull)` chama `parseNote` por
    dentro (assim `assignmentsFor` — placar, Discord, IA, `verdict.ts` — tem o
    mesmo comportamento): com `intBlock`, lê só ele; com `isNsrt` sem bloco,
    devolve a escala vazia; senão, o texto inteiro, como hoje. `savedNote` e
    `saveNote` continuam na chave atual, com texto puro.

#### 8. `src/lib/assignments.test.ts` (Modify)

*   **Type / Scope**: teste.
*   **Proposed Changes**: num boss com uma mecânica de interrupt: NSRT com
    bloco (só o bloco vira escala), NSRT sem bloco (escala vazia), texto livre
    antigo (igual a hoje); com duas mecânicas, um bloco com `{spell:<id>}` de
    cada mecânica na primeira linha de cada grupo é lido.

#### 9. `src/lib/healNoteCheck.ts` (Create)

*   **Type / Scope**: módulo TypeScript puro.
*   **Proposed Changes** (etapa 1), com `noteOf: (p: Pull) => ParsedNote |
    null` (a versão de `noteFor`, já lida):
    *   `phaseOffsets(pulls, noteOf): Map<string, { offsetMs, pairs, pulls,
        applied } | null>`: roda o primeiro passe por dentro e aplica as
        regras de desvio (primeira fase sem desvio; ≥ `MIN_OFFSET_LINES` pares
        em ≥ 2 pulls; teto `MAX_OFFSET_MS`).
    *   `matchLines(pulls, noteOf, offsets): Map<pullId, LineCheck[]>`: o
        segundo passe; cada linha vira um `LineCheck` com `lineIndex`, `state`
        (os da tabela [Estados de cada linha](#estados-de-cada-linha), na ordem
        dela), `expectedMs`, `usedMs?`, `deltaMs?` e `rawDeltaMs?`. Casamento
        pelo par de menor |Δ| a até `PAIR_MS`.
    *   `summarizeLines(checks, noteOf, version)`: a [Agregação na
        noite](#agregação-na-noite) por linha de uma versão, só com os pulls
        que `noteOf` liga a ela (a linha é o `lineIndex` dentro da versão).
    *   Medianas pela `quantile` de `src/lib/healer.ts`.

#### 10. `src/lib/healNoteCheck.test.ts` (Create)

*   **Type / Scope**: teste.
*   **Proposed Changes**: `Pull` montado à mão (fases, casts, mortes, corte):
    cada estado da tabela, inclusive `phase_ended` com desvio na fase
    seguinte, `dead` com uso antes da morte (fica casado) e com ressurreição,
    `no_spell` pela spec, por talento e fora da tabela; desvio de +8 s no P2
    corrigido; desvio no P1 não aplicado; desvio acima de `MAX_OFFSET_MS` não
    aplicado; desvio com menos de 5 pares ou em um pull só não aplicado; pares
    de duas versões juntos no desvio e tabelas separadas por versão;
    casamento pelo menor |Δ| com duas linhas e um cast; id alternativo; `tag`
    desconhecido.

#### 11. `src/components/NoteBox.tsx` e `src/components/NoteBox.i18n.ts` (Create)

*   **Type / Scope**: componente React e textos.
*   **Proposed Changes**: a caixa da note, extraída de `AssignmentsPanel`
    (hoje JSX solto ali): `textarea` que grava pela `editNote` no `onChange`,
    botão "nova versão" (com a ajuda "clique antes de editar") e a lista de
    versões da noite com "a partir do pull N" editável e o aviso de versão que
    não julga nenhum pull. Recebe `pull` (para a chave), `nightPulls` e
    `live`.

#### 12. `src/components/HealNotePanel.tsx` (Create)

*   **Type / Scope**: componente React.
*   **Proposed Changes**: recebe `pulls: Pull[]`, `focus?: Pull` (aba do pull),
    `onSelectPull?` e `onReplay?(t)`. `NoteBox`; aviso de cabeçalho e de `tag`
    desconhecido; casamento de fases com o desvio de cada fase; uma tabela por
    versão (CD com `SpellName`, player com `PlayerName` na cor da classe, "P2
    +0:15", estado, Δ e Δ sem ajuste; ▶ só quando `onReplay` existe). Item
    selecionado muda só o fundo.

#### 13. `src/components/HealNotePanel.i18n.ts` (Create)

*   **Type / Scope**: textos pt e en.
*   **Proposed Changes**: rótulos da seção, estados, avisos e o vocabulário de
    [Tela](#tela).

#### 14. `src/components/AssignmentsPanel.tsx`, `src/components/AssignmentsPanel.i18n.tsx` e `src/components/InterruptsView.tsx` (Modify)

*   **Type / Scope**: componentes React e textos.
*   **Proposed Changes**: `AssignmentsPanel` usa `NoteBox` no lugar da caixa
    própria; os textos da caixa saem do `.i18n.tsx` dele e vão para
    `NoteBox.i18n.ts`; a escala sai de `parseAssignments` com a regra do item
    7. `InterruptsView` e `AssignmentsPanel` passam a receber `nightPulls` e
    `live` e repassam ao `NoteBox`.

#### 15. `src/components/PullView.tsx` e `src/components/PullView.i18n.ts` (Modify)

*   **Type / Scope**: componente React e textos.
*   **Proposed Changes**: aba `healcds` ("CDs de cura" / "Healing CDs") no grupo
    "O que aconteceu", depois de Interrupts, só no foco Guilda; renderiza
    `HealNotePanel` com `pulls = nightPulls ?? [pull]` e `focus = pull`, e
    passa `nightPulls ?? [pull]` e `live` também para `InterruptsView`.
    `PullView` ganha a prop `live` (o relatório está ao vivo), vinda de
    `App.tsx` (estado do `useLive`), que também a passa ao `BossSummary`.

#### 16. `src/components/NightSummary.tsx` e `src/App.tsx` (Modify)

*   **Type / Scope**: componente React.
*   **Proposed Changes**: `<HealNotePanel pulls={s.pulls} onSelectPull live>`
    em `BossSummaryInner`, depois de `NightPhaseTimes`; `BossSummary` ganha a
    prop `live`.

#### 17. `src/styles.css` (Modify)

*   **Type / Scope**: estilos.
*   **Proposed Changes**: classes da tabela, dos estados e da caixa, com os
    tokens que já existem; sem borda ou faixa colorida lateral.

#### 18. `docs/heal-cd-note.md` (Create)

*   **Type / Scope**: doc de regras.
*   **Proposed Changes**: as regras da análise (formato, versões, fases,
    desvio, estados, constantes e de onde vieram, golpes e momentos, uso,
    ciclo, note sugerida), as decisões datadas, os riscos aceitos e o que
    ficou para depois; liga para `healer-analysis.md` em vez de repetir a
    regra 2.

#### 19. Docs de regras e de uso (Modify)

*   **Type / Scope**: docs.
*   **Proposed Changes**:
    *   `docs/healer-analysis.md` (§2) e `docs/CONTRIBUTING.md` /
        `docs/CONTRIBUTING.pt-BR.md` (regra 2): a decisão de 2026-10-27 —
        golpe e raide baixa são parâmetros da luta, calibrados nos logs da
        guilda, e não são referência do healer;
    *   `docs/healer-analysis.md` e os dois `CONTRIBUTING` (lista dos docs de
        regras): link para `docs/heal-cd-note.md`;
    *   `docs/APP-MAP.pt-BR.md`: 3.5 (seção nova do resumo do boss), 3.6 (aba
        nova do pull), 3.10 (Interrupts: caixa compartilhada e escala só do
        bloco), §6 (chave das versões) e §7 (arquivos novos);
    *   `docs/USAGE.md` / `docs/USAGE.pt-BR.md`: "colar a note de CDs".

#### 20. `docs/designs/heal-cd-note.md` e `docs/designs/SITEMAP.md` (Modify)

*   **Type / Scope**: design.
*   **Proposed Changes**: Status Approved no design e no SITEMAP.

### Etapa 2: golpes e uso

#### 21. `crates/wipe-core/src/data.rs` (Modify)

*   **Type / Scope**: Rust.
*   **Proposed Changes**: `include_str!("../../../data/heal-cooldowns.json")`;
    struct de deserialização das entradas; em `GameData`, o campo
    `heal_cd_by_heal_id: HashMap<u32, u32>` (spell da cura → cast do CD),
    preenchido em `embedded()`.

#### 22. `crates/wipe-core/src/analysis.rs` (Modify)

*   **Type / Scope**: Rust.
*   **Proposed Changes**:
    *   O `PullBuilder` recebe uma cópia de `heal_cd_by_heal_id` no início do
        pull, como `capture_fight` já faz com `data`, porque `heal()` e
        `absorbed()` não recebem `data`.
    *   Um conjunto `low`, atualizado como `injured` (entra e sai em
        `track_advanced`, sai na morte, `LOW_PCT = 50`); a cada segundo
        marcado em `mark_injured`, o estado de cada player (vivo, abaixo de
        50%, último `max_hp`) vai para um vetor por player.
    *   Por player e por segundo (até o corte): dano inevitável de fonte
        inimiga ou do ambiente (golpes em que `rules.failure_mechanic` devolve
        `None`), em `damage()` e também no `SPELL_MISSED` com `ABSORB` de fonte
        inimiga (valor em `f[15]`); o mesmo por spell inimiga para
        `enemy_hits` (ambiente com `spellId` 0); cura e overheal das spells de
        `heal_cd_by_heal_id` em `heal()` e `absorbed()`, com pets no dono.
    *   No fim do pull, com `role` resolvido, sem tanks: somar `raid_series`
        (`maxHpK` só dos vivos com amostra de vida); filtrar `enemy_hits` com
        `ENEMY_HIT_FLOOR = 0.01` da vida máxima somada daquele segundo; somar
        `cd_heals` por player; menos da metade dos players com amostra de vida
        no pull → `low` nulo.
    *   Testes no `#[cfg(test)]` do próprio arquivo, com log sintético: vida
        baixa contada; tank fora; morto fora; golpe de `avoidable_damage` fora
        do inevitável; golpe absorvido inteiro dentro; dano de player do grupo
        fora; dano de ambiente com id 0; `cd_heals` do Tranquility pelo
        157982; cura de totem no dono; sem advanced logging → `low` nulo.

#### 23. `crates/wipe-core/src/report.rs` (Modify)

*   **Type / Scope**: Rust.
*   **Proposed Changes**: `Pull.raid_series: Option<RaidSeries>` (`alive:
    Vec<u8>`, `low: Option<Vec<u8>>`, `max_hp_k: Vec<u32>`, `unavoidable_k:
    Vec<u32>`; serde camelCase: `maxHpK`, `unavoidableK`),
    `Pull.enemy_hits: Vec<(u32, u32, i64)>` (segundo, spellId, dano) e
    `PlayerStats.cd_heals: Vec<(u32, u32, i64, i64)>` (segundo, castId, cura,
    overheal); `skip_serializing_if` em `None` e em vetor vazio.

#### 24. `src/types.ts` (Modify)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: espelho dos campos (`raidSeries?`, `enemyHits?`,
    `cdHeals?`).

#### 25. `src-tauri/src/history.rs`, `src/web/history.ts` e `src/web/history.test.ts` (Modify / Create)

*   **Type / Scope**: histórico compacto e teste.
*   **Proposed Changes**: `compact` tira `raidSeries` e `enemyHits` do próprio
    pull (`strip(p, …)`) e `cdHeals` dos players; o `compact` da web passa a
    ser exportado; testes novos dos dois lados (Rust no `#[cfg(test)]` de
    `history.rs`, TS em `src/web/history.test.ts`).

#### 26. `src/lib/cdAnchors.ts` (Modify)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: exportar `SAME_MOMENT_MS` (`MAX_ANCHOR_CASTS` de
    `benchMetrics.ts` já é exportada); nada muda no comportamento.

#### 27. `src/lib/raidHits.ts` e `src/lib/raidHits.test.ts` (Create)

*   **Type / Scope**: módulo TypeScript puro, sem a note, e teste.
*   **Proposed Changes**:
    *   `nightAnchors(pulls): Map<pullId, Anchors>`: spells aceitas por
        `anchorTimes` na maioria dos pulls que chegaram na fase de cada cast,
        convertidas para `Anchors` (`Record<string, number[]>`) como em
        `src/lib/healer.ts`.
    *   `hits(pull, anchors): Hit[]`: golpes pelo pseudocódigo de [Golpes e
        momentos](#golpes-e-momentos), com `nearestAnchor(início, anchors)`;
        golpe sem marco com `key: null`.
    *   `moments(pulls, hitsByPull)`: momentos da noite, fase de cada momento,
        "chegou", hora do momento em cada pull, tempo na fase (o desvio entra
        em `healNoteCheck.ts`), dano mediano e "golpe em X de Y pulls".
    *   `raidLow(pull)`: episódios de raide baixa.
    *   Testes com `raidSeries` / `enemyHits` montados à mão: golpe instantâneo
        (início no segundo do dano) e espalhado em 3 s; pull que chegou no
        marco sem golpe tem o momento; golpe em um pull só não vira momento;
        mesma chave em pulls longos e curtos e em pulls que morrem no P1;
        marco castado em duas fases; golpe sem marco fica fora da noite;
        colisão de chave; sem `low` → sem golpes.

#### 28. `src/lib/healNoteCheck.ts` e `src/lib/healNoteCheck.test.ts` (Modify)

*   **Type / Scope**: TypeScript e teste.
*   **Proposed Changes**: associação linha ↔ momento (o mais perto quando a
    linha cobre dois), "no golpe", golpe sem CD, raide baixa sem golpe, linhas
    de ciclo e "sem dano" (só `heal`), pela tabela [Janela de cada tipo de
    efeito](#janela-de-cada-tipo-de-efeito), com os momentos de `raidHits.ts`
    no relógio da note. Testes:
    *   cobertura `active`, `sustained` e `burst` (−2 s / +`RECOVER_MS`);
    *   Darkness fora de hora não recebe "sem dano" e sai com "no golpe: não";
        cura sem momento nem raide baixa sai "sem dano"; redução de dano depois
        do golpe não cobre;
    *   golpe sem CD com linhas `not_in_pull` e `no_spell` (não cobrem);
    *   raide baixa sem golpe;
    *   linha de ciclo detectada (também entre fases) e isenta de "sem dano";
    *   linha que cobre dois momentos fica com o mais perto;
    *   "CD planejado não veio" e "fora do golpe por timing" como combinações
        de colunas.

#### 29. `src/components/FightReplay.tsx` e `src/components/PullView.tsx` (Modify)

*   **Type / Scope**: componentes React.
*   **Proposed Changes**: `FightReplay` ganha `startAt?: number` (ms do pull),
    que vira o tempo inicial do `usePlayback` em `FightReplayInner`;
    `PullView` ganha o estado `replayAt` e passa `onReplay(t)` para o
    `HealNotePanel`, que troca para a aba Replay com `startAt = t`; abrir o
    Replay pela aba limpa o `replayAt`. `onReplay` só existe quando
    `canLoadFull` (`src/lib/fullReplay.ts`) é verdadeiro.

#### 30. `src/components/HealNotePanel.tsx` e `src/components/HealNotePanel.i18n.ts` (Modify)

*   **Type / Scope**: componente e textos.
*   **Proposed Changes**: colunas "no golpe" e "uso" na tabela; lista de
    momentos (skill do boss com ícone, k, pulls, dano mediano, problemas, ▶);
    aviso "reanalise" quando o pull não tem `raidSeries`.

#### 31. `scripts/heal-note-calibrate.mjs` (Create)

*   **Type / Scope**: script Node (sem IA).
*   **Proposed Changes**: `node --experimental-strip-types
    scripts/heal-note-calibrate.mjs <relatório.json> [--boss "<nome>"]
    [--difficulty Mythic] [--note note.txt]` (sem `--boss`, o boss com mais
    pulls, como no `replay:check`); usa `raidHits.ts` e mostra a
    distribuição do dano inevitável em 5 s pela vida máxima, quantos golpes e
    momentos por pull cada valor candidato de `STRONG_HIT_SHARE` daria,
    quantos golpes não têm marco e, com a note, quantos momentos já têm CD.
    O desenvolvedor escolhe o valor (G10) pelo critério do Verification Plan.

#### 32. `docs/heal-cd-note.md` e `docs/designs/heal-cd-note.md` (Modify)

*   **Type / Scope**: docs.
*   **Proposed Changes**: valores finais do limite do golpe, das janelas e do
    `HIT_ONSET_SHARE`, com a data e as noites medidas, e a contagem de golpes
    sem marco; Open Questions fechadas.

### Etapa 3: overheal e note sugerida

#### 33. `src/lib/healer.ts` (Modify)

*   **Type / Scope**: TypeScript.
*   **Proposed Changes**: exportar `band` e `OVERHEAL_MARGIN = 0.15` (a dica de
    overheal passa a usar a constante); `HealRefEntry.cdSpells?:
    Record<string, { share: number; overheal: number }>`, lido só pela régua
    desta feature: as `spells` e a análise de healer não mudam.

#### 34. `scripts/rotation/heal-bench.mjs` e `src/data/heal-refs/*.json` (Modify)

*   **Type / Scope**: script Node (fluxo de referências de healer:
    `node scripts/rotation.mjs refs <spec>` e depois `heal-bench.mjs`) e dado
    gerado.
*   **Proposed Changes**:
    *   Antes de gravar os `heal_ids`: medir quantas referências por boss já
        têm cada `heal_id` nas `spells` e registrar no doc de regras.
    *   Gravar em `cdSpells` todo `heal_id` de `data/heal-cooldowns.json` da
        spec que aparece no `healingBySpell` do log de referência (`share` e
        `overheal` como nas `spells`).
    *   No fim, um relatório "Tabela de CDs de cura" com OK / ATENÇÃO / REVISAR:
        *   `heal_id` da tabela que não aparece em nenhuma referência da spec
            → ATENÇÃO;
        *   cast de CD de healer fora da tabela (habilidade da rotação da spec,
            lida por `scripts/rotation/yaml.mjs`, com `cooldown_ms` ≥ 60 s,
            castada nas referências, sem entrada) → REVISAR. Uma entrada sem
            `kind` (como a do Stampeding Roar) marca a spell como conhecida e
            não é CD de raide; a tabela ganha essas entradas para Holy Word:
            Serenity, Nature's Swiftness, Power Infusion, Stasis e as outras que
            o primeiro relatório marcar.
    *   Rodar o fluxo de novo nas 7 specs de healer.

#### 35. `src/lib/healNoteCheck.ts` e `src/lib/healNoteCheck.test.ts` (Modify)

*   **Type / Scope**: TypeScript e teste.
*   **Proposed Changes**:
    *   `overhealOfUse` (de `cdHeals` na janela do "sem dano");
        `refOverheal(pull, healer, cd)` (referências de `selectHealRefs`,
        `cdSpells`, ponderação por `share`, `band`, `MIN_REFS`); "overheal
        alto" e "empilhado".
    *   `refsAt(pull, candidate, key)`: quantas referências da spec do
        candidato têm um uso do CD (`cdUses`) cujo `nearestAnchor` sobre os
        `anchors` delas é a chave do momento.
    *   `suggest(pulls, version): NoteSuggestion` — `adds` (para cada golpe sem
        CD, a lista de CDs livres com o `time` e o número de `refsAt`) e
        `moves` (pelas condições de [Note sugerida](#note-sugerida), cada um
        com o motivo).
    *   Testes: golpe sem CD em 3 de 4 pulls lista os CDs livres; um CD que não
        volta a tempo no pior caso de fase não entra na lista; CD sem player da
        spec na note não é candidato; linha `on_time` sem momento gera `move`;
        `move` que não muda o `time` é descartado; linha de ciclo não gera
        `move`; menos de 3 pulls não sugere nada; fase sem desvio aplicado não
        recebe mudança; spell sem referência não vira "overheal alto";
        "empilhado" só com dois usos de `heal` com `heal_ids` no mesmo
        momento.

#### 36. `src/components/HealNotePanel.tsx` e `src/components/HealNotePanel.i18n.ts` (Modify)

*   **Type / Scope**: componente e textos.
*   **Proposed Changes**: overheal do uso (com a faixa das referências e a
    média da noite sem cor); "Note sugerida" por versão, com caixas de seleção
    e "Copiar".

#### 37. Docs e skill (Modify)

*   **Type / Scope**: docs.
*   **Proposed Changes**:
    *   `docs/heal-cd-note.md`, `docs/USAGE.md`, `docs/USAGE.pt-BR.md` e
        `docs/APP-MAP.pt-BR.md`: overheal e note sugerida;
    *   `docs/CONTRIBUTING.md` / `docs/CONTRIBUTING.pt-BR.md` (bloco "Gerar a
        rotação de uma spec") e `docs/healer-analysis.md`: o relatório da
        tabela de CDs no fluxo de referências;
    *   `.claude/skills/rotation-refresh/SKILL.md`: a skill resolve os REVISAR
        da tabela, inclusive preencher `specs`, `kind`, `effect`,
        `duration_ms` e `heal_ids` de um CD novo (regra 4);
    *   `docs/designs/heal-cd-note.md` e `docs/designs/SITEMAP.md`: Status
        Implemented no último commit do PR.

### Verification Plan

*   **Compilation/Build**: `cargo build --release -p wipe-core --bin wipe-cli`,
    `npm run build` e `npm run build:web` (WASM da web).
*   **Checks do CI**: `npm run typecheck`, `npm test`, `cargo test -p
    wipe-core`, `cargo clippy -p wipe-core --all-targets -- -D warnings` e
    `cargo clippy -p wipe-wasm --target wasm32-unknown-unknown -- -D
    warnings`; `npm run docs:links` sai com 0.
*   **Ida e volta da note**: o teste de G1 com a note de exemplo (nomes
    fictícios).
*   **Medição nos logs da guilda** (fora do git: `samples/` e os logs do PC):
    *   etapa 1, nas noites de 21, 22 e 26/10 do The Coiled Altar Mythic: o
        desvio do P2 sai entre +7 e +9 s, o P1 fica sem desvio e "na hora" no
        P2 passa de 64% (sem ajuste) para pelo menos 80% (P1: 89%);
    *   etapa 2, `scripts/heal-note-calibrate.mjs` nas mesmas noites, numa
        noite de outro boss com fases (Ula'tek ou Nek'zali) e numa de um boss
        sem fases: o `STRONG_HIT_SHARE` aprovado pelo desenvolvedor é o maior
        valor em que, conferindo à mão no replay 10 momentos de cada boss, pelo
        menos 9 são golpes do boss (não dano de falha) e toda linha de CD de
        cura da note que a guilda põe num golpe conhecido cai num momento;
        conferir também 10 "raide baixa" e 5 momentos em pulls sem golpe;
    *   etapa 3: conferir à mão 5 mudanças sugeridas contra o Warcraft Logs.
*   **Interface**: no app, colar a note de exemplo no resumo do boss e na aba do
    pull, nos dois idiomas; conferir ícone + nome, cor da classe, ▶ do replay,
    versões com "a partir do pull N", casamento de fases e a aba Interrupts
    com a mesma note.

--------------------------------------------------------------------------------

*Drafted with EGM*

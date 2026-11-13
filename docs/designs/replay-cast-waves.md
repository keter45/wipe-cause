# Ondas do replay disparadas por cast, na direção dos acertos (caudas da Ula'tek)

*   **Author:** @keter45
*   **Status:** Implemented
*   **Date:** 2026-11-12

--------------------------------------------------------------------------------

## Overview

Na luta da Ula'tek, as caudas (NPC Gore Rattle) soltam Caustic Waves (cast 1298570) em par, ~9 vezes
por pull no mítico (678 casts em 36 pulls). Hoje o replay mostra só a marca no chão de quem tomou, sem
a onda que veio da cauda. O `waves` do motor não serve: ele só dispara quando uma aura sai de um player
e só aponta para ângulos fixos do mundo (Plague Froth do Vashnik).

A proposta acrescenta ao `waves` um gatilho por cast de NPC (`cast_id`), em que a direção sai dos
acertos de cada cast. O replay passa a mostrar, para cada grupo de acertos de um cast, uma onda
estreita saindo de quem lança e andando até um pouco depois de quem tomou, com a frente tracejada para
dizer que a direção é inferida.

Para quem usa o replay. Pedido do usuário (2026-11-12): "apenas ver as ondas e quem tomou".

## The Problem

O log registra de onde e quando a onda da cauda sai; a velocidade sai dos acertos. Para onde ela vai,
o log não registra. Medido em 36 pulls míticos e 2 kills heroicos
([audit](../ulatek-replay-audit.md#caustic-waves-de-onde-saem-e-quando-1211)):

*   **Hora e origem:** cada cast é uma unidade nova da cauda, com posição e `facing` na linha do cast.
*   **Velocidade:** a frente sai da cauda no cast e anda a mediana de 13,5 jardas (jd) por segundo
    (p25–p75 de 13,1 a 14,2; 377 acertos).
*   **Direção:** num mesmo cast os acertos ficam juntos (espalhamento mediano de 5°), mas a direção
    muda de cast para cast, entre o `facing` da cauda e a direção do centro da plataforma. Nenhuma
    forma fixa funciona. Dos momentos em que a frente passa por um player ("passagens da frente"),
    72% caem no setor do `facing` até o centro, e em só 3,7% deles o player toma o dano.

Desenhar uma forma fixa (faixa larga, leque, setor) mostraria quase todo mundo "dentro da onda e sem
tomar", o erro que o princípio 10 do [replay-methods.md](../replay-methods.md) proíbe. O que o log
sustenta é: a onda passou por onde alguém tomou, na hora em que tomou.

## Goals

*   O `waves` aceita `cast_id` como gatilho no lugar de `aura`; o carregamento recusa spec com os dois
    ou com nenhum.
*   Com `cast_id`, a direção vem dos acertos: para cada cast, os acertos do dano da própria mecânica
    cuja distância até quem lança bate com `start + speed × tempo desde o cast` (`start` padrão 0)
    viram grupos por ângulo, e cada grupo vira uma onda na direção do meio dele.
*   Toda onda de cast aparece com a frente tracejada no mapa, com a dica em pt e en dizendo que a
    direção é inferida dos acertos, e com a origem visível mesmo fora do chão.
*   As ondas das caudas da Ula'tek (1298570) aparecem no replay pelo `ulatek.yaml`, sem nenhum `if` de
    boss no código.
*   O Plague Froth do Vashnik continua igual: mesma regra, mesma saída.
*   O `npm run replay:check` mostra, por mecânica com `waves` de cast, o resumo `castWaves` (tabela no
    item 3 da implementação) e marca ATENÇÃO se mais da metade dos acertos ficar sem cast ou mais de
    1/4 dos casts ficar sem posição.

## Non-Goals

*   As outras ondas da Ula'tek: a da P1 (1319282), a parede com buracos da P2/P3 (1292211) e o segundo
    cast da cauda (1311807).
*   A direção pelo `facing` de quem lança: nenhum boss medido usa hoje. Se vier, entra um campo novo
    com valor padrão "pelos acertos", sem quebrar as regras de hoje.
*   Tolerância, vão, margem de ambiguidade e alcance por regra: ficam constantes no núcleo até um
    segundo boss pedir outro valor.
*   Desenhar ondas de cast sem acerto.
*   Ligar cada acerto à onda que o causou na lista de erros ou na culpa: a marca no chão continua sendo
    quem tomou.
*   Modo ao vivo, previsão da próxima onda e ensino do padrão.
*   Mais de um `waves` por mecânica (lista).

## Open Questions

Nenhuma.

## Critical User Journeys (CUJs)

### CUJ 1: Ver a onda que acertou alguém

*   **Given**: um pull da Ula'tek (log local ou WCL) em que uma cauda soltou Caustic Waves e um player
    tomou o dano da onda (1292403).
*   **When**: quem usa abre o replay e passa pelo momento do cast.
*   **Then**: no fim do cast aparece um ponto na posição da cauda, mesmo no veneno fora do chão; dele
    sai uma onda de 6 jd de largura, com a frente tracejada, andando a 13,5 jd/s na direção do grupo de
    acertos. A frente passa pela posição de quem tomou, a até 7 jd, no instante do acerto, e some 5 jd
    depois do acerto mais distante. A dica diz, em pt e en, que a direção foi inferida dos acertos.

### CUJ 2: Cast da cauda sem acerto

*   **Given**: um cast da cauda em que nenhum acerto da onda bate com a frente dele.
*   **When**: quem usa passa pelo momento do cast no replay.
*   **Then**: nenhuma onda daquele cast aparece. O `replay:check` conta o cast em `no_hits` (JSON
    `noHits`).

### CUJ 3: Vashnik continua igual

*   **Given**: um pull do Vashnik com Plague Froth.
*   **When**: a análise roda com a regra atual (`waves: { aura: … }`).
*   **Then**: as ondas saem iguais às de antes (mesma origem, ângulos, hora, largura e ordem), com a
    frente cheia, sem o tracejado de inferida.

## Technical Plan (Architecture)

### Regra (YAML)

O `waves` da mecânica ganha um campo, `cast_id`. O formato de hoje continua valendo sem mudança:

```yaml
# Vashnik (igual a hoje): sai da aura, ângulo fixo no mundo
waves: { aura: 1281913, directions: 4, angle: 0, start: 4, speed: 12.3, width: 6, duration_s: 5 }

# Ula'tek (novo): sai do fim do cast, direção pelos acertos
waves: { cast_id: 1298570, speed: 13.5, width: 6, duration_s: 7 }
```

*   `cast_id`: a onda sai do fim deste cast de NPC, na direção dos acertos, marcada como inferida. Com
    `cast_id`, `directions` e `angle` não têm efeito.
*   `width: 6`: duas vezes o p95 (3,0 jd) do desvio lateral dos acertos até o meio do grupo.
*   `duration_s: 7`: o teto; a onda real para antes (passo 6). 7 s × 13,5 = 94,5 jd; o acerto mais
    distante medido ficou a 93 jd.
*   O `waves` vale em todas as dificuldades (sem `overrides`).
*   Acertos que contam: os do mesmo filtro da mecânica (`damage_ids` e `detect.min_amount` comparado
    com `amount + absorbed`, como nos erros), só `SPELL_DAMAGE` (sem `SPELL_PERIODIC_DAMAGE` e sem
    `SPELL_MISSED`), em player do grupo. Por player e por cast fica um acerto (passo 6).
*   Constantes do núcleo, todas medidas na cauda da Ula'tek (audit, 2026-11-12):

| Constante | Valor | Para quê | Fonte |
| :-------- | :---- | :------- | :---- |
| `CAST_WAVE_TOL_YD` | 7 | folga entre a distância do acerto até a origem e `start + speed × tempo` | erro da frente com p5 −6,5 e p95 +4,0 jd; ±7 cobre os dois lados |
| `CAST_WAVE_SPREAD_DEG` | 6 | vão de ângulo que separa dois grupos do mesmo cast | 94 de 139 vãos entre acertos vizinhos abaixo de 3°; quebra entre 5° e 8° |
| `CAST_WAVE_AMBIGUOUS_YD` | 3 | quanto o segundo melhor cast tem de ser pior para o acerto não ser ambíguo | 75 dos 112 acertos que cabem nos dois casts do par ficam abaixo de 3 jd de diferença |
| `CAST_WAVE_REACH_YD` | 5 | quanto a onda anda além do acerto mais distante do cast | "dentro e sem tomar": 60% tomam com o corte, 50% sem |

### Núcleo (Rust)

A direção depende de acertos que chegam depois do cast, então não pode ser decidida na hora do cast
(como o `wave_aura` faz com a aura). O cálculo vira um passo no fim da análise, como o `build_soaks`,
que já usa os casts e os acertos guardados.

```text
linha do log ──┬─ SPELL_CAST_SUCCESS do cast_id ──► boss_casts (t, end, guid, facing, x, y)   [x, y novos]
               └─ SPELL_DAMAGE da mecânica em player
                    com posição ───────────────────► spot_hits (t, x, y, mecânica, player)   [hoje soak_hits]

fim da análise (logo depois de montar os resultados das mecânicas, antes de refs):
  build_cast_waves(spot_hits, cast_waves() lido antes do finish(), boss_casts)
      ──► Vec<WaveView> (inferred = true) e o resumo castWaves de cada mecânica
  waves do replay = ondas da aura (wave_aura, como hoje, sem janela)
                    + ondas de cast dentro de alguma janela de replay
```

*   **Captura dos acertos:** a captura que o soak já faz (`soak_hits`, pela busca `soak_for`) vira
    genérica: `spot_hits`/`spot_for`, "mecânicas que precisam de onde o player estava no acerto" (soak
    ou `waves.cast_id`). `build_soaks` e `build_cast_waves` filtram pelo índice da mecânica.
*   **Origem:** a linha que fecha o cast já traz o bloco avançado de quem lança (é dela que sai o
    `facing`); o `BossCast` passa a guardar `x, y` dessa linha. Cast sem posição nessa linha conta em
    `no_pos`. Não depende das trilhas (cada cast da cauda é uma unidade nova).

`build_cast_waves`, por mecânica com `cast_id` (tempos em ms; `duration_s × 1000`; ângulos em
radianos no sistema do log, `atan2(y_acerto − y0, x_acerto − x0)`):

1.  **Casts:** todo cast do `cast_id` que não foi interrompido. `at` = fim do cast (`end`; sem `end`,
    instantâneo ou cortado pelo fim do pull, usa `t`). Sem `x, y` → `no_pos`, e o cast sai dos passos
    seguintes.
2.  **Candidatos:** para cada acerto, os casts com posição, com `0 ≤ t − at ≤ duration_s × 1000` e cujo
    erro `|start + speed × (t − at)/1000 − distância até a origem|` cabe em `CAST_WAVE_TOL_YD`. Acerto
    sem candidato → `unassigned`.
3.  **Acerto claro:** com um candidato só, ou com o segundo pior por `CAST_WAVE_AMBIGUOUS_YD` ou mais,
    o acerto vai para o melhor.
4.  **Grupos:** em cada cast, os acertos claros são ordenados pelo ângulo visto da origem e separados
    em grupos onde o vão passa de `CAST_WAVE_SPREAD_DEG`. O vão entre o último e o primeiro (+2π)
    também conta, e a separação começa no maior vão (para a volta de ±180° não partir um grupo). Cada
    grupo tem a média circular dos ângulos, `atan2(Σsin, Σcos)`, como em `gaze.rs` e `orbs.rs`.
5.  **Acerto ambíguo:** para cada candidato, o ângulo do acerto visto da origem daquele cast é comparado
    com a média de cada grupo do passo 4 (fixa, não recalculada). Se só um candidato tem grupo a até
    `CAST_WAVE_SPREAD_DEG`, o acerto entra nesse grupo; senão conta em `ambiguous` e não desenha nada.
    Efeito visível: a onda chega até o acerto perto do centro, onde o raid fica, em vez de parar antes
    (19 dos 75 ambíguos na medida).
6.  **Onda:** por (cast, player) fica o acerto de menor erro; os outros não contam em nada. Cast com
    pelo menos um grupo vira um `WaveView`: `angles` = média circular final de cada grupo; alcance =
    acerto mais distante do cast + `CAST_WAVE_REACH_YD`; `duration_ms = (alcance − start) / speed ×
    1000`, limitado a `duration_s × 1000`. Cast sem grupo não vira onda e conta em `no_hits`.
7.  **Resumo:** os contadores contam todos os casts e acertos do pull (antes da janela), em
    `castWaves`.
8.  **Janela:** só entram no replay as ondas de cast dentro de alguma janela de replay (`refs`):
    `w.from + w.duration_ms ≥ r.from` e `w.from ≤ r.to`. O replay do pull inteiro cobre o pull todo,
    então mostra todas. As ondas da aura não passam pela janela, como hoje.

O WASM (versão web) usa o mesmo `wipe-core` e recebe isso sem código próprio.

### Regras: onde fica cada coisa

*   `WaveSpec::check` roda em `RuleSet::mechanics_for`, logo depois de desserializar cada mecânica e
    antes do filtro de dificuldade. O `tuned` já passa por ele, e os ajustes salvos não guardam
    `waves` (`TUNABLE_FIELDS`). Spec inválido derruba a regra do boss inteira, que vai para
    `RuleBook.errors` com o arquivo e a key, como os outros erros de carregamento.
*   As buscas novas ficam no `RuleTracker`, ao lado de `waves_for_aura` e `soak_for`.

### View e front

*   `WaveView` ganha `inferred: bool`, serializado só quando `true`. No front, ausente = não inferida,
    então relatórios em cache e links de visualização antigos abrem como antes.
*   Campos de uma onda de cast: `key` e `name` da mecânica; `spell_id` = primeiro `damage_ids` (igual ao
    `wave_aura`); `guid` de quem lança; `x, y` da linha do cast; `from = at` = fim do cast; `angles` dos
    grupos; `start`, `speed` e `width` do spec; `duration_ms` do passo 6; `inferred: true`.
*   `from = at`: a onda aparece só no fim do cast. A direção só existe depois dos acertos, e a cauda não
    é unidade do mapa; então a parte "antes de sair" da camada (setas em volta de quem lança) não roda.
*   Na camada `Waves`, onda inferida: ponto de origem e rastro num grupo SVG sem o recorte do chão (a
    cauda fica no veneno, fora do chão); a frente continua recortada na borda da arena. O sinal de
    inferida é a frente tracejada com ponta reta (o rastro já é tracejado em toda onda, inclusive no
    Vashnik, e não muda). Dica pt "Caustic Waves: direção inferida dos acertos" / en "Caustic Waves:
    direction inferred from hits". Esconder por mecânica (`wave:<key>`) não muda.
*   Os comentários do código que falam de "player marcado" passam a falar de "quem lança a onda"; a
    legenda ganha uma frase (o texto atual, "em volta de um player", continua certo para a onda da
    aura).

### Ferramentas e docs

*   `replay:check`: `idsOf` passa a ver `waves.cast_id` (o 1298570 sai de "Casts do boss sem regra"
    quando aparece lá), `shapesOf` passa a listar `ondas`, e o relatório ganha a seção `castWaves` por
    mecânica, somada entre pulls, com os limites de ATENÇÃO dos Goals.
*   `ulatek.yaml`: o `caustic_waves` ganha o `waves` da cauda, com a fonte da medida no comentário.
*   Docs: o método ([replay-methods.md](../replay-methods.md)), o esquema da regra (skill `boss-rules`),
    a skill `replay-build` e o audit da Ula'tek.

## Alternatives Considered

### Alternativa A: faixa larga na direção da cauda (direção pelo `facing`, `width: 55`)

*   **Pros**: Usa só o que a linha do cast tem (posição e `facing`); desenha toda onda, com ou sem
    acerto. A largura de 55 jd era a que cobria os acertos de todos os casts juntos.
*   **Cons**: As ondas são estreitas e a direção muda de cast para cast. Dos players que a frente cruzou
    a até 3 jd da linha do `facing`, só 10–14% tomaram o dano.
*   **Reason for Rejection**: Mostraria quase todo mundo "dentro e sem tomar" (princípio 10).

### Alternativa B: leque fixo do `facing` até o centro, ou o setor inteiro

*   **Pros**: Explica 63% (leque de 3 direções) e 85% (setor ±5°) dos acertos; desenha toda onda.
*   **Cons**: A maior parte dessa cobertura é onde o raid fica, perto do centro. O setor pega 72% de
    todas as passagens da frente, e só 3,7% delas tomam (2,3% fora do setor). Depende do centro da
    plataforma, que o motor não tem como dado genérico de regra (regra do projeto 1).
*   **Reason for Rejection**: Não diz onde a onda passou; é "tudo na frente da cauda".

### Alternativa C: só a frente andando, sem direção

*   **Pros**: Usa só o que o log registra (hora, origem e velocidade); aparece também nos casts sem
    acerto.
*   **Cons**: Um arco passando por todo mundo mostra quando a onda chega, mas não quem estava no
    caminho. O pedido é "ver as ondas e quem tomou".
*   **Reason for Rejection**: Não responde o pedido. Pode voltar como complemento (Future
    Improvements).

### Alternativa D: só ligar cada acerto à cauda (linha curta no instante do acerto)

*   **Pros**: Menos código; nenhum agrupamento.
*   **Cons**: Não mostra a onda andando, só o fim dela; num par de caudas, a linha ainda depende de
    escolher qual cauda explica o acerto, o mesmo trabalho dos passos 2–5.
*   **Reason for Rejection**: Mesmo custo de atribuição, menos informação no mapa.

### Alternativa E: uma mecânica nova só para a onda da cauda

*   **Pros**: Separaria o botão de esconder (`wave:<key>`) da onda da cauda das outras Caustic Waves.
*   **Cons**: O dano 1292403 é o mesmo para todos os emissores; uma segunda mecânica com o mesmo
    `damage_ids` conta cada erro duas vezes.
*   **Reason for Rejection**: Contagem dupla nos erros.

### Alternativa F: `waves` como enum com tag (`trigger: { aura: X }` / `trigger: { cast: Y }`)

*   **Pros**: O tipo impede os dois gatilhos juntos sem validação manual.
*   **Cons**: Muda o formato do `waves` do Vashnik e de qualquer regra YAML do usuário que o use.
*   **Reason for Rejection**: Campos opcionais independentes, com validação no carregamento, mantêm o
    formato atual, como no [replay-unit-exit.md](replay-unit-exit.md).

### Alternativa G: inferir a direção na hora do cast, olhando os acertos que já chegaram

*   **Pros**: Ficaria no caminho do `wave_aura`, sem passo no fim.
*   **Cons**: No cast nenhum acerto chegou ainda; seria preciso segurar a onda até `duration_s` e
    reescrevê-la, que é um passo no fim com outro nome.
*   **Reason for Rejection**: Mais estado para o mesmo resultado.

### Alternativa H: campos `aim`, `tolerance` e `spread_deg` na regra

*   **Pros**: `aim: world | hits` deixaria espaço explícito para uma direção pelo `facing`; tolerância e
    vão ajustáveis por boss sem mexer no núcleo.
*   **Cons**: Hoje `cast_id` sempre quer dizer "pelos acertos" e `aura` sempre "ângulo fixo", então
    `aim` só serviria para recusar combinações que ele mesmo cria. Os valores foram medidos numa
    mecânica só.
*   **Reason for Rejection**: Nenhum caso medido precisa desses campos hoje. Um campo novo, com valor
    padrão "pelos acertos", entra sem quebrar regras quando um segundo boss pedir.

### Alternativa I: separar as caudas do par pelo `facing` de cada uma

*   **Pros**: Usaria um dado do próprio cast para decidir de qual cauda veio o acerto.
*   **Cons**: Os acertos ficam a até 48° do `facing` (p95 37°), e as duas caudas olham para o centro;
    com ±50°, os mesmos 112 acertos continuam cabendo nos dois casts.
*   **Reason for Rejection**: Não separa nada; a coerência com os grupos (passo 5) separa 19 deles.

## Risks & Mitigations

| Risco | Mitigação |
| :---- | :-------- |
| Pull limpo não mostra onda de cauda, e quem olha pode achar que ela não soltou nada | Aceito. A legenda diz que só aparecem as ondas que acertaram alguém; o `replay:check` conta `no_hits`. |
| Par de caudas: o acerto perto do centro cabe nos dois casts | Passos 3 e 5: margem de 3 jd e coerência com os grupos. Medido: 243 acertos claros, 19 pela coerência, 56 (18%) sem onda, contados em `ambiguous`. |
| Acertos de outros emissores do 1292403 (ondas da Ula'tek na P1/P2/P3, Volatile Purge) que caem na frente de uma cauda viram onda dela | Não medido. A frente tracejada de inferida é a mitigação; os acertos que não caem em frente nenhuma aparecem em `unassigned`. |
| Volta de ±180° parte um grupo em dois | Passo 4: o maior vão, contando a volta; teste 178°/−178°. |
| Origem no veneno, fora do chão, escondida pelo recorte da arena | Ponto de origem e rastro fora do recorte; só a frente é recortada. |
| "Dentro e sem tomar" na faixa desenhada | Corte no acerto mais distante + 5 jd. Medido: 60% de quem a frente cruzou na faixa tomou (50% sem o corte; 3,7% no setor recusado). |
| Cast sem posição na linha que o fecha (ex.: import do WCL sem bloco avançado) | Conta em `no_pos`, com ATENÇÃO acima de 1/4 dos casts. |
| Campo novo no JSON do relatório | `castWaves` e `inferred` são omitidos quando vazios; o front trata ausência como antes. |

## Non-Functional Requirements

*   **Compatibilidade:** ver "View e front" e a última linha de Riscos.
*   **Custo:** O(casts × acertos) por mecânica com `waves` de cast; na cauda, ~19 casts e ~12 acertos
    por pull. Não medido; a conferência é o tempo do `cargo test` e do `replay:check` antes e depois.

--------------------------------------------------------------------------------

### Additional Resources

*   [Audit da Ula'tek, Caustic Waves](../ulatek-replay-audit.md#caustic-waves-de-onde-saem-e-quando-1211)
*   [replay-methods.md](../replay-methods.md): princípios 1, 2, 5 e 10 e a seção das ondas
*   [replay-unit-exit.md](replay-unit-exit.md): precedente dos campos opcionais com validação

### Future Improvements

*   **Frente sem direção nos casts sem acerto** (alternativa C): um arco fraco mostrando quando a onda
    chegou, para o pull limpo não parecer "a cauda não soltou nada".
*   **Volatile Purge** (mítico, P3): as ondas dos soakers podem usar a direção pelos acertos com o
    gatilho por aura. O dano é o mesmo do `caustic_waves` (alternativa E), então isso exige mais de um
    `waves` por mecânica (hoje não-objetivo) e um campo de direção (valor padrão "pelos acertos" para
    `cast_id`, "ângulo fixo" para `aura`).

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Fases

Cada fase deixa o build e os testes passando antes da próxima.

| Fase | Itens | Portão |
| :--- | :---- | :----- |
| 1. Núcleo | 1, 2, 3 (o `ulatek.yaml` ainda sem o `waves` novo) | `cargo test -p wipe-core`; `cargo clippy -p wipe-core --all-targets -- -D warnings`; `replay:check` do Vashnik igual à linha de base |
| 2. Front | 4, 5, 6, 7, 8 | `npm run typecheck`; `npm test`; `npm run wasm`; `cargo clippy -p wipe-wasm --target wasm32-unknown-unknown -- -D warnings` |
| 3. Regra e ferramenta | 9, 10 | `replay:check` da Ula'tek dentro dos critérios do Verification Plan |
| 4. Docs | 11, 12, 13, 14, 15 | `npm run docs:links` |

### Target Files to Create/Modify

#### 1. `crates/wipe-core/src/rules.rs` (Modify)

*   **Type / Scope**: Rust, regra do boss.
*   **Proposed Changes**:
    *   `WaveSpec`: `aura: Option<u32>` e novo `cast_id: Option<u32>`. `directions`, `angle` e `start`
        continuam com os valores padrão de hoje (`start` 0).
    *   `WaveSpec::check(&self, key: &str) -> Result<(), String>`: devolve `Err` quando a spec tem
        `aura` e `cast_id` juntos, ou nenhum dos dois. Texto pelo `pick()`: pt `"mecânica {key}: waves
        precisa de exatamente um entre aura e cast_id"` / en `"mechanic {key}: waves needs exactly one
        of aura and cast_id"`. `RuleSet::mechanics_for` chama logo depois de desserializar cada
        mecânica, antes do filtro de dificuldade, e prefixa `"{arquivo}: "` como nos outros erros dele.
        Como o `RuleSet::parse` já chama `mechanics_for`, a regra inválida é recusada ao carregar.
    *   `RuleTracker::waves_for_aura`: passa a olhar só specs com `aura` (`w.aura == Some(aura)`).
    *   `RuleTracker::soak_for` vira `spot_for(spell_id: u32, amount: i64, periodic: bool) ->
        Option<usize>`: devolve a mecânica com `soak` ou com `waves.cast_id` (esta só com `periodic`
        falso, isto é, fora de `SPELL_PERIODIC_DAMAGE`) cujo `damage_ids` contém `spell_id` e, se houver
        `detect.min_amount`, com `amount ≥ min_amount`. `amount` é `amount + absorbed`, o mesmo valor
        que o `on_damage` recebe. Mudança de comportamento: um soak com `min_amount` deixa de capturar
        acertos abaixo dele (nenhum soak usa `min_amount` hoje).
    *   Novo `pub struct CastWaveInfo { index: usize, key: String, name: String, spell_id: u32,
        cast_id: u32, start: f32, speed: f32, width: f32, duration_s: f32 }`, ao lado de `SoakInfo`, e
        `RuleTracker::cast_waves(&self) -> Vec<CastWaveInfo>`: uma entrada por mecânica com
        `waves.cast_id` (`spell_id` = primeiro `damage_ids`).
    *   No `finish()`, o literal de `MechanicResult` ganha `cast_waves: None`.
    *   Testes:
        *   o Vashnik continua dando o mesmo spec (`vashnik_plague_froth_sends_four_axis_waves`, com
            uma checagem nova de que `cast_waves()` vem vazio);
        *   `waves` com `aura` e `cast_id` juntos, e sem nenhum dos dois, são recusados, e a mensagem
            cita a key;
        *   `waves: { cast_id, speed, width, duration_s }` carrega;
        *   `waves_for_aura` não devolve spec de cast;
        *   `spot_for` devolve a mecânica de soak e a de `waves.cast_id`; um acerto de 200k com 50k
            absorvidos (`amount` 250k) passa num `min_amount` de 230k, e um de 200k sem absorção não.

#### 2. `crates/wipe-core/src/analysis.rs` (Modify)

*   **Type / Scope**: Rust, análise do pull.
*   **Proposed Changes**:
    *   `soak_hits` vira `spot_hits` (mesma tupla `(i64, f32, f32, usize, String)`: hora, x, y, índice,
        player). No ramo do dano em player (onde hoje se chama `soak_for`), chama `spot_for(spell_id,
        amount + absorbed, periodic)`, que para mecânica com `waves.cast_id` descarta só
        `SPELL_PERIODIC_DAMAGE`. O resto da
        captura continua como hoje: usa a posição do bloco avançado ou a última posição conhecida do
        player e só roda com `counting` ativo (do início do encontro ao corte da análise). A captura por
        aura (`soak_for_aura`) não muda.
    *   `BossCast`: no fechamento do cast (onde hoje se grava `c.facing`), grava também `c.x`, `c.y` do
        mesmo bloco avançado de quem lança; no cast instantâneo (que cria o `BossCast` já fechado), do
        mesmo jeito. Os outros literais de `BossCast` ganham `x: None, y: None`: o do início de cast
        (`SPELL_CAST_START`) e os três dos testes do arquivo.
    *   Constantes `CAST_WAVE_TOL_YD = 7.0`, `CAST_WAVE_SPREAD_DEG = 6.0`, `CAST_WAVE_AMBIGUOUS_YD = 3.0`,
        `CAST_WAVE_REACH_YD = 5.0`, com comentário citando a medida da cauda da Ula'tek (2026-11-12).
    *   Novo `fn build_cast_waves(hits: &[(i64, f32, f32, usize, String)], infos: &[CastWaveInfo],
        casts: &[BossCast]) -> (Vec<WaveView>, HashMap<String, CastWaveSummary>)`, ao lado do
        `build_soaks`, com os passos 1–7 do [plano técnico](#núcleo-rust).
    *   Ordem no fim da análise: `cast_waves()` é lido do `RuleTracker` antes do `finish()` (como o
        `soak_meta`); `build_cast_waves` roda logo depois de montar os resultados das mecânicas e antes
        de `refs`, e grava cada `CastWaveSummary` no `MechanicResult` da mesma key. Na montagem do
        replay (onde hoje está `waves: std::mem::take(&mut self.waves)`), as ondas da aura ficam como
        estão e as de cast entram depois, filtradas pela janela do passo 8.
    *   Testes (com `speed` 13,5, `start` 0, `duration_s` 7):
        *   cast em (0, 0); acertos a 40 e 60 jd na mesma direção, cada um no instante em que a frente
            passa por ele → uma onda, um ângulo, `inferred: true`, `duration_ms` = (60 + 5) / 13,5 ×
            1000 ≈ 4815;
        *   acertos em direções separadas por 20° → dois ângulos; separadas por 3° → um;
        *   acertos em 178° e −178° → um grupo;
        *   o mesmo player acertado duas vezes no mesmo cast → conta uma, o de menor erro;
        *   acerto fora da tolerância → não entra, conta em `unassigned`;
        *   dois casts simultâneos em (−30, 0) e (30, 0), com um acerto em (0, 0) na hora da frente dos
            dois → `ambiguous`, sem onda; com mais um acerto claro do cast de (−30, 0) a até 6° do
            ambíguo → o ambíguo vai para esse cast;
        *   cast sem acerto → nenhuma onda, conta em `no_hits`; cast interrompido → ignorado;
        *   cast sem `x, y` → nenhuma onda, conta em `no_pos`;
        *   a onda da aura (Vashnik) continua saindo igual, na mesma ordem e sem `inferred`: conferido
            pelo `replay:check` do Vashnik contra a linha de base (passo 2 do Verification Plan), sem
            teste de unidade próprio.

#### 3. `crates/wipe-core/src/report.rs` (Modify)

*   **Type / Scope**: Rust, formato do relatório.
*   **Proposed Changes**:
    *   `WaveView` ganha `#[serde(skip_serializing_if = "std::ops::Not::not")] pub inferred: bool`; o
        comentário troca "player marcado" por "quem lança a onda". `wave_aura` preenche
        `inferred: false`.
    *   `BossCast` ganha dois campos, cada um com `#[serde(skip)]`: `x: Option<f32>` e `y: Option<f32>`
        (posição de quem lança no fim do cast; não vão para o JSON; o `BossCast` só deriva `Serialize`).
    *   Novo `CastWaveSummary` (`u32` em todos os campos, `rename_all = "camelCase"`), e
        `MechanicResult` ganha `#[serde(skip_serializing_if = "Option::is_none")] pub cast_waves:
        Option<CastWaveSummary>` (JSON `castWaves`), ao lado do `assign`. É `Some` sempre que a mecânica
        tem `waves.cast_id` na regra do pull, mesmo com zero casts.

| Campo (JSON) | Conta |
| :----------- | :---- |
| `casts` | casts não interrompidos do `cast_id`; `casts = noPos + noHits + drawn` |
| `noPos` | casts sem `x, y` na linha que os fecha |
| `noHits` | casts com posição e sem grupo |
| `drawn` | casts que viraram onda (`WaveView`) |
| `hits` | acertos com pelo menos um cast candidato (passo 2), um por player por cast |
| `ambiguous` | acertos de `hits` que não ficaram em cast nenhum (passo 5) |
| `unassigned` | acertos sem cast candidato |

#### 4. `src/types.ts` (Modify)

*   **Type / Scope**: TypeScript, tipos do relatório.
*   **Proposed Changes**: `WaveView` ganha `inferred?: boolean`; o comentário troca "player marcado" por
    "quem lança a onda". O resumo `castWaves` não é tipado no front (só o `replay:check` lê).

#### 5. `src/components/replayLayers.tsx` (Modify)

*   **Type / Scope**: React, camada do mapa.
*   **Proposed Changes**: na parte "depois de sair" da `Waves`, onda com `inferred` vira um `<g>` com a
    chave de hoje e, dentro dele:
    *   `<title>{t.waveInferred(w.name)}</title>` (no lugar do `<title>{w.name}</title>` de hoje);
    *   `<g className="replay-wave replay-wave--inferred" opacity={fade}>` sem `clipPath`, com
        `<circle className="replay-wave-origin" cx={sx(w.x)} cy={sy(w.y)} r={1 * scale} />` e os
        rastros;
    *   `<g className="replay-wave replay-wave--inferred" opacity={fade} clipPath={clip}>` com as
        frentes.

    A onda sem `inferred` continua exatamente como hoje. O comentário da função troca "player marcado"
    por "quem lança a onda". A parte "antes de sair" não muda.

#### 6. `src/styles.css` (Modify)

*   **Type / Scope**: CSS.
*   **Proposed Changes**: `.replay-wave--inferred .replay-wave-front { stroke-linecap: butt;
    stroke-dasharray: 6 4; }` (a frente de hoje tem `stroke-width: 4` e ponta redonda, que fecharia um
    tracejado curto) e `.replay-wave-origin { fill: currentColor; }`. O rastro (`stroke-dasharray: 4
    4` em toda onda) não muda. A cor vem do `WAVE_COLOR` (`#a3e635`) já aplicado no
    `<g className="replay-waves">` em `replayLayers.tsx`.

#### 7. `src/components/ReplayView.i18n.ts` (Modify)

*   **Type / Scope**: textos pt-BR e en.
*   **Proposed Changes**:
    *   novo `waveInferred: (name: string) =>` pt `${name}: direção inferida dos acertos` / en
        `${name}: direction inferred from hits`;
    *   no array `legend`, o último item (o das ondas) ganha a frase: pt "Frente tracejada saindo de um
        ponto: onda de um inimigo, na direção de quem ela acertou (inferida). Onda que não acertou
        ninguém não aparece." / en "Dashed front coming out of a dot: an enemy's wave, toward whoever
        it hit (inferred). A wave that hit no one is not shown.".

#### 8. `src/components/replayLayers.test.tsx` (Create; antes só existia `ReplayView.test.tsx`, sem mapa)

*   **Type / Scope**: teste do front.
*   **Proposed Changes**: renderiza `Waves` direto com `clip="url(#x)"`, uma onda `inferred` e uma sem:
    *   antes de `at`, a inferida não desenha nada;
    *   depois de `at`, o `<circle class="replay-wave-origin">` não está dentro de nenhum `<g>` com
        `clip-path`, a `.replay-wave-front` está, o título é o de inferida e o grupo tem
        `replay-wave--inferred`;
    *   a onda sem `inferred` não tem a classe nem o ponto.

#### 9. `encounters/venomous-abyss/ulatek.yaml` (Modify)

*   **Type / Scope**: regra do boss.
*   **Proposed Changes**: no `caustic_waves`, `waves: { cast_id: 1298570, speed: 13.5, width: 6,
    duration_s: 7 }`, com comentário citando a medida (2026-11-12; reports `kW7y1qfK8zR39LAn`,
    `BPR9KFWZYnwy7T4f`, `pRJDTa1j7qc9tAx8`, `DVYRKLqg3zw6tC8c`, `JwC1GWMzmjZD72Yv`). As `notes` ganham
    `{ pt: "A direção da onda da cauda não está no log; o replay mostra só as ondas que acertaram
    alguém, na direção dos acertos.", en: "The tail wave's direction is not in the log; the replay
    shows only the waves that hit someone, in the direction of the hits." }`.

#### 10. `scripts/replay-check.mjs` (Modify)

*   **Type / Scope**: ferramenta de conferência.
*   **Proposed Changes**:
    *   `idsOf` inclui `m.waves?.cast_id` (não a `aura`, para o resultado do Vashnik não mudar);
        `shapesOf` acrescenta `ondas` quando há `m.waves`.
    *   Nova seção "Ondas de cast — {nome} ({key})" por mecânica com `castWaves`, somando
        `p.mechanics[].castWaves` de todos os pulls, no formato da seção do `assign`: casts, sem
        posição, sem acerto, com onda, acertos, ambíguos, sem cast.
    *   ATENÇÃO "mais da metade dos acertos sem cast" se `unassigned > (hits + unassigned) / 2`, e
        "mais de 1/4 dos casts sem posição" se `noPos > casts / 4`.
    *   `castWaves` também no JSON do `writeReport`, ao lado de `assigns`.

#### 11. `docs/replay-methods.md` (Modify)

*   **Type / Scope**: método do replay.
*   **Proposed Changes**: a seção "Ondas que saem do marcado (`waves`)" vira "Ondas (`waves`)", com o
    texto de antes na subseção "Onda que sai do marcado (`aura`)" e a subseção "Onda de cast, direção pelos acertos (`cast_id`)": quando usar (a direção muda de cast para
    cast e nenhuma forma fixa explica os acertos, pela taxa de acerto nas passagens da frente), como
    medir velocidade e largura, as quatro constantes e quando virariam campo, a ambiguidade de casts no
    mesmo instante e o limite (onda sem acerto não aparece).

#### 12. `.claude/skills/boss-rules/references/schema.md` (Modify)

*   **Type / Scope**: esquema da regra.
*   **Proposed Changes**: linha do `waves` (antes ausente) com os dois gatilhos (`aura`: ângulo fixo;
    `cast_id`: direção pelos acertos, inferida, e `directions`/`angle` sem efeito) e os exemplos do
    Vashnik e da Ula'tek.

#### 13. `.claude/skills/replay-build/SKILL.md` (Modify)

*   **Type / Scope**: skill do processo padrão.
*   **Proposed Changes**: a linha "Ondas que saem de um player marcado" ganha o caso "ondas que saem do
    cast de um NPC em direção que muda a cada cast → `waves: { cast_id, speed, width, duration_s }`",
    com o teste de direção antes (se uma direção fixa explica os acertos, o caso não é este).

#### 14. `docs/ulatek-replay-audit.md` (Modify)

*   **Type / Scope**: auditoria do boss.
*   **Proposed Changes**:
    *   em "Fora, e por quê", na linha do Volatile Purge, troca "o `waves` hoje só aceita ângulo fixo"
        por "o `waves` com aura só aceita ângulo fixo, e a direção pelos acertos é só para gatilho por
        cast (mesmo dano do `caustic_waves`)";
    *   a seção de medidas ganha o resultado do `replay:check` com a regra nova (casts com onda,
        ambíguos, sem cast).

#### 15. `docs/designs/replay-cast-waves.md` e `docs/designs/SITEMAP.md` (Modify)

*   **Type / Scope**: design.
*   **Proposed Changes**: Status Approved no design e no SITEMAP no PR da feature; Implemented no
    último commit do PR, antes do merge (`CLAUDE.md`).

### Verification Plan

*   **Compilation/Build**: `cargo build -p wipe-core`, `npm run wasm`, `npm run typecheck`.
*   **Unit Tests**: `cargo test -p wipe-core` (itens 1 e 2) e `npm test` (item 8).
*   **Static Analysis & Linting**: `cargo clippy -p wipe-core --all-targets -- -D warnings` e
    `cargo clippy -p wipe-wasm --target wasm32-unknown-unknown -- -D warnings`.
*   **E2E/Integration**:
    1.  **Linha de base, antes da mudança:** gerar o relatório da Ula'tek com `wipe-cli wcl` sobre as
        pastas baixadas dos reports `kW7y1qfK8zR39LAn`, `BPR9KFWZYnwy7T4f`, `pRJDTa1j7qc9tAx8` e
        `DVYRKLqg3zw6tC8c` (`--json` para um arquivo), e o do Vashnik do mesmo jeito; guardar a saída
        de `npm run replay:check -- <json> --boss "Ula'tek" --difficulty Mythic` e a do Vashnik.
    2.  **Depois, Ula'tek mítico:** a seção de ondas de cast do `caustic_waves` existe, com
        `casts > 0`, `drawn` entre 130 e 170 e `ambiguous` até 25% de `hits` (a simulação do algoritmo
        nesses 36 pulls deu 151 casts com onda, 318 acertos com candidato e 56 ambíguos; o `replay:check`
        de 12/11, com 40 pulls, deu 131, 236 e 51, ou 21,6%: dentro da faixa, perto da borda de baixo
        do `drawn`, que vale também para os 40 pulls); nenhum
        REVISAR novo em relação à linha de base. O heroico (`JwC1GWMzmjZD72Yv` e o kill do DVYR) roda à
        parte só para conferir que não há erro.
    3.  **Fora da faixa:** abrir 3 pulls no replay e comparar ondas e acertos antes do PR.
    4.  **Vashnik:** a saída do `replay:check` igual à linha de base.
    5.  **App e versão web:** abrir um pull da Ula'tek e conferir o CUJ 1 (ponto no veneno, frente
        tracejada passando por quem tomou na hora do acerto) e um pull do Vashnik (CUJ 3).
    6.  `npm run docs:links`.

--------------------------------------------------------------------------------

*Drafted with EGM*

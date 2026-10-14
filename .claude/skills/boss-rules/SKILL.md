---
name: boss-rules
description: Gera ou atualiza o arquivo de regras de um boss (encounters/<raid>/<boss>.yaml) a partir de um guia (link como mythictrap.com, wowhead, icy-veins) ou de um texto livre descrevendo as habilidades e o que fazer. Use quando o usuário pedir para "cadastrar boss", "criar regras do boss", "ler guia da luta", colar um link de guia de raid, ou colar uma lista de mecânicas. Também use para preencher spell IDs faltantes a partir de um dump de spells de um log.
---

# boss-rules

Transforma um guia de luta em regras que o motor de análise do wipe-cause consegue checar contra o combat log.
Saída: um YAML por boss em `encounters/<raid-slug>/<boss-slug>.yaml`, seguindo `references/schema.md`.

Leia `references/schema.md` antes de escrever qualquer arquivo. `encounters/venomous-abyss/the-twin-fangs.yaml` é um exemplo completo.

## Entradas aceitas

1. **URL de guia** — busque o texto da página (WebFetch; se vier vazio ou só navegação, use o browser e `get_page_text`). Se houver seletor de dificuldade, leia a versão **Mythic** e anote o que é exclusivo de Heroic/Mythic.
2. **Texto livre colado** — trate como fonte primária; pergunte só se o nome do boss/raid não estiver claro.
3. **Log real** — rode `cargo run -q -p wipe-core --bin wipe-cli -- spells <WoWCombatLog.txt> > samples/spells.csv` (spells inimigas por pull: casts, hits em players, dano). É a fonte que confirma os IDs; o Journal quase nunca traz os IDs de dano/explosão.

## Fluxo

1. **Identificar** raid, boss, slug (kebab-case em inglês) e, se possível, o `encounter_id` (ID do `ENCOUNTER_START` no log; wowhead/wago.tools listam). Se o arquivo já existir, leia-o e **atualize** em vez de sobrescrever — preserve `id`s, `tolerance`s e `notes` ajustados à mão.
2. **Extrair cada mecânica** do guia: nome da habilidade, quem causa (qual boss/add), o que acontece, o que o raid deve fazer, qual papel é afetado, dificuldade em que aparece, e *qual é a consequência da falha* (morte, stack, wipe, dano no raid).
3. **Classificar** cada mecânica em um `type` do schema. A pergunta-chave é: **"que evento no combat log prova que alguém errou?"** — essa resposta define `detect`. Exemplos:
   - "desvie das linhas/ondas/poças" → `avoidable_damage` (dano do spell em player = erro).
   - "soak os orbs senão explodem" → `soak` (o evento de explosão acontecer = falha).
   - "interrompa todos" → `interrupt` (cast do inimigo com sucesso = falha).
   - "saia para a borda com o debuff" → `spread` (dano do spell em player *sem* o debuff = erro de quem tinha).
   - "morre com N stacks" → `stack_limit`.
   - "se o orb encostar em outro, explode e wipa" → `failure_event` (a explosão é a falha; `culprit_auras` culpa quem carregava; `min_amount` se o mesmo spell tem tick normal).
   - "mate os dois juntos" → `hp_balance`.
   - Dano de raid que só se cura → `unavoidable` (serve de contexto, nunca culpa ninguém).
   Se nenhum evento de log prova a falha, use `type: info` e explique em `notes` — não invente detecção.
4. **Severidade**: `wipe` (falha sozinha acaba a try), `major` (mata alguém ou gasta CDs), `minor` (dano/stack evitável).
5. **Resolver spell IDs** (ver abaixo). Nunca chute um ID.
6. **Mostrar no replay** (regra do projeto: as habilidades do boss aparecem sempre). Releia a descrição de cada habilidade:
   - **frontal / cone / "na frente do boss"** → `cone: { cast_id, half_angle, range }` na mecânica. O cone aponta para o alvo do boss durante o cast; se o boss não bate corpo a corpo, ponha em `target_spells` um spell que só vai no alvo dele (ex.: o Dread Bolt do Malacrass). Sem tamanho no guia, comece em 40°/40yd e meça com os players atingidos num log (ângulo e distância até o boss no `SPELL_CAST_SUCCESS`).
   - **área em volta de alguém ou de uma unidade** (raio em volta de quem carrega algo, unidade que gira pela sala) → `area: { aura | npc, radius }` (ver o schema).
   - **deixa algo no chão** (poça, gota, área, rastro, círculo, projétil que cai) → `ground` ligado nos `damage_ids` (já é o padrão em `avoidable_damage`, `soak`, `positioning` e `spread`); para outro `type` (ex.: `unavoidable` que deixa poça), ponha `ground: true`, e `ground: { lingers_s: N }` quando a poça fica.
   - **dano em quem está perto de quem tem um debuff** (`avoidable_damage` com `excludes_aura`: o splash do orb, a bomba, o cuspe) → quase sempre é uma `area: { aura: <o excludes_aura>, radius }`.
   - **unidade do boss que some** (machado que para de girar, add que despawna sem morrer no log) → `area.vanish: { idle_s, from }`: some depois de N s sem acertar ninguém perto dela.
   - **add que precisa ser interrompido** → basta a regra `interrupt` com o `cast_id` certo: quem solta o cast entra no mapa com a barra de cast (cortado em vermelho) e some logo depois do último cast.
   - **add que importa** (tem que morrer, solta linhas, fica no meio) → `units` com `npc_id` e `replay: true`.
   - **linha do lançador até o alvo** ("sair da linha de quem é o alvo") → `line: { cast_id, width, target_aura }`.
   - **soak** (um ou mais players precisam estar onde a mecânica cai) → `soak: { radius, players }`; mede com `wipe-cli radius --soak`. O círculo do soak substitui as marcas de chão da mesma mecânica (tire o `ground`).
   Só fica de fora o que não tem forma no chão (dano no raid inteiro, DoT que segue o player). Na dúvida, mostre.
   **Medir o raio:** `wipe-cli radius <log> --damage <id> (--aura <id> | --npc <id>)` mostra a distância de cada atingido até o portador (ou a unidade) mais perto, num histograma por jarda: o raio é onde a contagem despenca (os golpes mais longe vêm de outros centros). Ex.: Mutagenic Venom cai de 92 para 33 na jarda 6; Axegrinder tem 90% até 5,6 jd (raio 4).
7. **Escrever o YAML**, validar mentalmente contra o schema (todo `type` com os campos obrigatórios; `difficulty` coerente) e mostrar ao usuário um resumo em tabela: mecânica → tipo → severidade → ID resolvido?

## Resolver spell IDs

Um guia quase nunca traz spell IDs, e o log pode estar com nomes em pt-BR, então o ID é o que realmente liga a regra ao log. Ordem de tentativa:

1. **warcraft.wiki.gg** (`https://warcraft.wiki.gg/wiki/<Boss_Name>`) — lista todas as habilidades do Encounter Journal com spell ID e os NPC IDs. Rápido e completo.
2. **Módulo do BigWigs** do boss (GitHub `BigWigsMods/BigWigs`, pasta da raid atual) — traz os IDs que o addon realmente escuta no combate, muitas vezes os IDs de dano/debuff que o Journal não mostra.
3. **Wowhead / wago.tools** — busca pelo nome da habilidade + nome do boss; confirme que o NPC de origem bate.
4. **Dump de um log real** — se o usuário fornecer, case por nome (inglês ou localizado) e origem. É a única fonte que confirma de verdade.

O ID do Journal nem sempre é o ID que aparece no `SPELL_DAMAGE` (ex.: cast ≠ dano ≠ explosão). Use o ID do Journal como ponto de partida e, quando não souber se ele vale para o evento que a regra detecta, deixe um `notes` pedindo confirmação no log.

Uma habilidade pode ter vários IDs (cast, dano, debuff, explosão). Coloque cada um no campo certo (`cast_id`, `damage_ids`, `aura_id`, `fail_ids`). Se não conseguir resolver, deixe `id: null` e `needs_id: true` — o app mostra essas regras como "não calibradas" e o usuário completa depois com um log.

## Lições do Coiled Altar (valem para todo boss)

- **O log dá contagens: use antes da geometria.** Quando o jogo marca quantas vezes algo aconteceu (stacks que o raid inteiro ganha, número de alvos), isso é mais confiável que reconstruir pela posição. Ex.: o raid ganha 1 stack de Venom Rupture por orb quebrado; o app quebra os N orbs mais alinhados com o frontal (`breaker.count_aura`). Antes, pelo ângulo do log, errava Severs inteiros.
- **A direção do boss no log pode estar errada** (90° fora num Sever). Para frontal, use também a direção do alvo do boss (`cone`, `target_spells`).
- **Falha sem culpado quase sempre tem uma causa:** procure o que o boss faz no mesmo instante. As explosões "sem culpado" do Coiled Altar caíam todas no cast de orbs novos (Toxic Deluge) ou no fim da P1: o boss explode o que sobrou no chão (`cleared_by`, `cleared_on_zero`), e a falha passa a dizer quais orbs sobraram.
- **Troca de fase sem morte:** o boss da fase anterior fica com 1 ponto de vida (imune), não morre no log. Use "vida abaixo de 0,1%" como o fim dele.
- **Unidades que o log quase não mostra** (machados): a posição entre uma aparição e outra é estimada. Quem passa por dentro sem levar dano desmente (o replay apaga), e o que para de acertar some (`vanish`). Antes de dizer que algo "some" numa fase, confira no log: alguns machados ainda aplicavam DoT na P2.
- **Confirme o que o usuário conta no log, e o que o log mostra com o usuário:** os dois pegaram erros um do outro (o raio pós-nerf, os orbs que o boss explode, os machados na P2).
- **Instantâneo no meio de um cast** (o add solta outro spell ao ser cortado) não fecha o cast aberto: o motor só fecha com o mesmo spell.

## Arena

A imagem de fundo e o chão andável de cada boss ficam em `data/arenas.json` (fora das regras: o Kith'ix não tem regra e tem arena). Para um boss novo:
1. Achar a imagem no raidplan.io (`/plan/create?raid=wow.<expansão>.<raid>&boss=N`; a URL do mapa aparece nos recursos da página, `cdn.raidplan.io/raid/.../map/...jpg`). O app carrega da CDN na hora, como os ícones do Wowhead; a imagem não entra no repositório.
2. `wipe-cli positions <log>` em logs com o boss (onde os players pisaram) e juntar por boss.
3. Marcar o chão em `scripts/arena-fit.mjs` (polígono na imagem com 1224 de largura, `holes` para buracos; ou `hazard` com amostras da cor do perigo; `disk`/`holeDisk` para sala redonda com poço; `core` quando o raid sai da sala principal) e rodar. Ele acha escala e posição com o norte para cima (o Twin Fangs, sem simetria, confirmou: X do log = norte, Y = oeste) e grava uma imagem de conferência por boss: os pisões têm que cair no chão, inclusive em detalhes (pontes, poço). Nota acima de ~0,9.
4. Copiar o resultado para `data/arenas.json`.

## Validar

Depois de escrever, rode `cargo test -p wipe-core` (o teste `embedded_rules_parse` falha se o YAML for inválido) e, com um log do boss, `wipe-cli analyze <log> --json` — confira em `pulls[].mechanics` se as falhas batem com o que aconteceu. Se uma regra marca quase todo mundo em todo pull, provavelmente não é erro (ex.: stacks que todo tank pega): tire o `warn_stacks`/`tolerance` ou mude para `info`.

Ao mudar uma regra que já existe, compare antes e depois em vários logs: guarde o `wipe-cli.exe` antigo, rode `analyze --json` com os dois e liste o que mudou (culpados, falhas, gatilhos). Toda mudança tem que ter uma explicação no log (no Coiled Altar: 2 culpados mudaram, os dois porque os orbs passaram a bater com as stacks); mudança sem explicação é bug.

Regras novas vão em `encounters/<raid>/<boss>.yaml` (embutidas no build). Para testar sem recompilar, o app também lê `*.yaml` da pasta de dados do app (`%APPDATA%/gg.wipecause.app/encounters`), que substitui a embutida com o mesmo `encounter_id`.

## Regras de escrita

- **Sempre nas duas línguas.** O app é pt-BR e inglês: `tip`, `message` e `blame_message` são `{ pt: "...", en: "..." }` (o teste `embedded_texts_are_bilingual` falha se faltar uma). Nomes de habilidades, bosses e mecânicas ficam em inglês nas duas, inclusive o qualificador entre parênteses (`"Guillotine (double soak)"`, não `"(soak duplo)"`); o teste `english_side_and_names_have_no_portuguese` confere. Para converter um arquivo escrito numa língua só: `node scripts/i18n-yaml.mjs extract <saida.json>`, traduzir e `apply`.
- **Não copie a prosa do guia.** Escreva `tip` e `message` com suas próprias palavras, curtas. Guarde a URL em `source`.
- `message` é o que aparece no relatório quando a regra dispara; use placeholders `{player}`, `{count}`, `{spell}`, `{time}`.
- Diferenças por dificuldade vão em `difficulty` (lista) e `overrides` — não crie arquivos separados por dificuldade.
- Mecânicas só de tank → `roles: [tank]`; o motor não culpa DPS/healer por elas.
- Seja conservador em `tolerance`: na dúvida, `0` para `wipe`/`major`, e deixe um `notes` dizendo que precisa calibrar com pulls reais.

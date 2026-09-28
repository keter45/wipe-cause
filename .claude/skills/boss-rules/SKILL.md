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
3. **Dump de spells de um log** (`id,name,source` de eventos hostis) — use para preencher `id: null` em um YAML existente (ver "Resolver spell IDs").

## Fluxo

1. **Identificar** raid, boss, slug (kebab-case em inglês) e, se possível, o `encounter_id` (ID do `ENCOUNTER_START` no log; wowhead/wago.tools listam). Se o arquivo já existir, leia-o e **atualize** em vez de sobrescrever — preserve `id`s, `tolerance`s e `notes` ajustados à mão.
2. **Extrair cada mecânica** do guia: nome da habilidade, quem causa (qual boss/add), o que acontece, o que o raid deve fazer, qual papel é afetado, dificuldade em que aparece, e *qual é a consequência da falha* (morte, stack, wipe, dano no raid).
3. **Classificar** cada mecânica em um `type` do schema. A pergunta-chave é: **"que evento no combat log prova que alguém errou?"** — essa resposta define `detect`. Exemplos:
   - "desvie das linhas/ondas/poças" → `avoidable_damage` (dano do spell em player = erro).
   - "soak os orbs senão explodem" → `soak` (o evento de explosão acontecer = falha).
   - "interrompa todos" → `interrupt` (cast do inimigo com sucesso = falha).
   - "saia para a borda com o debuff" → `spread` (dano do spell em player *sem* o debuff = erro de quem tinha).
   - "morre com N stacks" → `stack_limit`.
   - "mate os dois juntos" → `hp_balance`.
   - Dano de raid que só se cura → `unavoidable` (serve de contexto, nunca culpa ninguém).
   Se nenhum evento de log prova a falha, use `type: info` e explique em `notes` — não invente detecção.
4. **Severidade**: `wipe` (falha sozinha acaba a try), `major` (mata alguém ou gasta CDs), `minor` (dano/stack evitável).
5. **Resolver spell IDs** (ver abaixo). Nunca chute um ID.
6. **Escrever o YAML**, validar mentalmente contra o schema (todo `type` com os campos obrigatórios; `difficulty` coerente) e mostrar ao usuário um resumo em tabela: mecânica → tipo → severidade → ID resolvido?

## Resolver spell IDs

Um guia quase nunca traz spell IDs, e o log pode estar com nomes em pt-BR, então o ID é o que realmente liga a regra ao log. Ordem de tentativa:

1. **warcraft.wiki.gg** (`https://warcraft.wiki.gg/wiki/<Boss_Name>`) — lista todas as habilidades do Encounter Journal com spell ID e os NPC IDs. Rápido e completo.
2. **Módulo do BigWigs** do boss (GitHub `BigWigsMods/BigWigs`, pasta da raid atual) — traz os IDs que o addon realmente escuta no combate, muitas vezes os IDs de dano/debuff que o Journal não mostra.
3. **Wowhead / wago.tools** — busca pelo nome da habilidade + nome do boss; confirme que o NPC de origem bate.
4. **Dump de um log real** — se o usuário fornecer, case por nome (inglês ou localizado) e origem. É a única fonte que confirma de verdade.

O ID do Journal nem sempre é o ID que aparece no `SPELL_DAMAGE` (ex.: cast ≠ dano ≠ explosão). Use o ID do Journal como ponto de partida e, quando não souber se ele vale para o evento que a regra detecta, deixe um `notes` pedindo confirmação no log.

Uma habilidade pode ter vários IDs (cast, dano, debuff, explosão). Coloque cada um no campo certo (`cast_id`, `damage_ids`, `aura_id`, `fail_ids`). Se não conseguir resolver, deixe `id: null` e `needs_id: true` — o app mostra essas regras como "não calibradas" e o usuário completa depois com um log.

## Regras de escrita

- **Não copie a prosa do guia.** Escreva `tip` e `message` com suas próprias palavras, curtas, em pt-BR. Guarde a URL em `source`.
- `message` é o que aparece no relatório quando a regra dispara; use placeholders `{player}`, `{count}`, `{spell}`, `{time}`.
- Diferenças por dificuldade vão em `difficulty` (lista) e `overrides` — não crie arquivos separados por dificuldade.
- Mecânicas só de tank → `roles: [tank]`; o motor não culpa DPS/healer por elas.
- Seja conservador em `tolerance`: na dúvida, `0` para `wipe`/`major`, e deixe um `notes` dizendo que precisa calibrar com pulls reais.

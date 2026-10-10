---
name: rotation-refresh
description: Atualiza a rotação base de uma spec (rotations/<classe>-<spec>.yaml) quando o relatório do `npm run refresh` marca a spec como REVISAR — APL do SimulationCraft mudou, habilidade que os tops pararam de usar, habilidade nova que eles usam e o YAML não tem, checagem que nem os tops cumprem, nota baixa dos próprios tops. Use quando o usuário pedir para "revisar a spec", "atualizar a rotação", "corrigir o REVISAR", depois de um patch, de uma raide nova ou de buffs/nerfs, ou colar um trecho do relatório samples/refresh/*.md.
---

# rotation-refresh

O `npm run refresh` faz sozinho tudo o que é número: metas das checagens, ids trocados (alt_ids), eventos repetidos do mesmo botão (ignore_casts), referência dos tops por boss, procs, cooldowns, contexto (alvo único x AoE) e builds. Esta skill cuida só do que muda **o que a spec é** e que o script não decide sozinho. Ela não refaz o que o refresh já faz: rode o refresh, leia o relatório e trabalhe só nos itens REVISAR.

## Fluxo

1. **Relatório da spec**: `npm run refresh -- --dry <spec>` (ex.: `paladin-retribution`). Lê `samples/refresh/<data>-<spec>.md`. Cada linha **revisar** é um item desta skill; **atenção** só se o usuário pedir.
2. **Fontes** (nesta ordem de confiança):
   - os logs dos tops, pelo motor: `node scripts/rotation.mjs check <spec>` mostra, checagem por checagem, quanto os tops cumprem; `wipe-cli wcl samples/rotation/<spec>/tops/<report> --json` dá os casts e buffs de cada um;
   - a APL do SimulationCraft (`samples/rotation/simc/<spec>.simc`; a anterior em `.prev.simc` quando mudou) e o dump de spells (`dump-<classe>.txt`: ids, cooldowns, cargas);
   - o guia de rotação do Wowhead, pelo browser embutido (`[role=tabpanel]` textContent; WebFetch não traz o texto). Serve para confirmar a prioridade e escrever as notas **com palavras nossas** — nunca copiar trechos.
3. **Resolver cada item** (abaixo), editando só o YAML da spec.
4. **Validar**: `cargo test -p wipe-core` (o YAML vai embutido; erro de parse aparece aqui), depois `npm run refresh -- --dry <spec>` até não sobrar **revisar**, e `npx vitest run`.
5. **Mostrar ao usuário** o diff do YAML e o relatório antes/depois. Commit e release só com o "pode subir" dele.

## Cada tipo de item

- **"A APL do SimulationCraft mudou"**: compare `.prev.simc` com a atual (ações que entraram/saíram e a ordem). Atualize `priority.<árvore>.st/aoe` na ordem nova; ações novas viram `abilities` (id, nome e cooldown pelo dump). Condições da APL viram `note` curta, pt e en.
- **"está no YAML e nenhum top usou"**: talento removido, renomeado ou id trocado. Procure o nome no dump e nos casts dos tops: id novo → troque `id` (o antigo em `alt_ids` se ainda aparecer em logs velhos); talento que saiu da árvore → tire de `abilities`, `priority`, `opener` e `checks`; talento que só parte dos tops pega → `optional: true`.
- **"não está no YAML"** (habilidade que os tops usam): é botão da rotação? Sim → `abilities` + lugar na prioridade (pela APL). Não (proc automático, ataque automático como Crusading Strikes, evento de pet, parte de outro cast) → `ignore_casts` com comentário do porquê.
- **Checagem que "nem os tops cumprem"** (proc abaixo de 85%, DoT abaixo de 60%, recurso desperdiçado, cooldown abaixo de 60%): quase sempre leitura errada. Proc gasto por outro spell ou no fim de canal → `spenders`/`channel`; buff consumido por proc automático → tire a checagem; recurso gerado sem apertar botão → `resource_waste.from`; cooldown que um quarto dos tops quase não usa → tire da checagem ou `optional`.
- **"Os próprios tops tiram N na rotação"**: rode `scripts/rotation.mjs check` e ache a checagem que derruba os tops; resolva como acima.

## Regras

- Textos sempre em pt-BR e inglês (`{ pt, en }`); nomes de spell e boss em inglês.
- Títulos com dois-pontos quebram o parse em silêncio: rode o `cargo test` antes de confiar no resultado.
- Não mexa nos números que o refresh calibra (`min_uptime`, `min_usage`): a próxima rodada ajusta.
- Formato do YAML: veja uma spec pronta (ex.: `rotations/paladin-retribution.yaml`) e o `Check` em `crates/wipe-core/src/rotation.rs`.

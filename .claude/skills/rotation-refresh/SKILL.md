---
name: rotation-refresh
description: Atualiza a rotação base de uma spec (rotations/<classe>-<spec>.yaml) quando o relatório do `npm run refresh` marca a spec como REVISAR — APL do SimulationCraft mudou, habilidade que os tops pararam de usar, habilidade nova que eles usam e o YAML não tem, checagem que nem os tops cumprem. Use quando o usuário pedir para "revisar a spec", "atualizar a rotação", "corrigir o REVISAR", depois de um patch, de uma raide nova ou de buffs/nerfs, ou colar um trecho do relatório samples/refresh/*.md.
---

# rotation-refresh

O `npm run refresh` faz sozinho tudo o que é número: metas das checagens, ids trocados (alt_ids), eventos repetidos do mesmo botão (ignore_casts), referência dos tops por boss, procs, cooldowns, contexto (alvo único x AoE) e builds. Esta skill cuida só do que muda **o que a spec é** e que o script não decide sozinho. Ela não refaz o que o refresh já faz: rode o refresh, leia o relatório e trabalhe só nos itens REVISAR.

## Fluxo

1. **Relatório da spec**: `npm run refresh -- --dry <spec>` (ex.: `paladin-retribution`). Lê `samples/refresh/<data>-<spec>.md`. Cada linha **revisar** é um item desta skill; **atenção** só se o usuário pedir. "Sem tops baixados: rode com --tops." não se resolve no YAML: rode `npm run refresh -- --tops <spec>` antes de seguir.
2. **Fontes** (nesta ordem de confiança):
   - os logs dos tops, pelo motor: `node scripts/rotation.mjs check <spec>` mostra, checagem por checagem, quanto os tops cumprem; `target/release/wipe-cli wcl samples/rotation/<spec>/tops/<report> --json` (depois de `cargo build --release -p wipe-core --bin wipe-cli`) dá os casts e buffs de cada um;
   - a APL do SimulationCraft (`samples/rotation/simc/<classe>_<spec>.simc`, ex.: `paladin_retribution.simc`; a anterior em `<classe>_<spec>.prev.simc` quando mudou) e o dump de spells (`dump-<classe>.txt`: ids, cooldowns, cargas);
   - o guia de rotação do Wowhead, pelo browser embutido (`[role=tabpanel]` textContent; WebFetch não traz o texto). Serve para confirmar a prioridade e escrever as notas **com palavras nossas** — nunca copiar trechos.
3. **Resolver cada item** (abaixo), editando só o YAML da spec.
4. **Validar**: `cargo test -p wipe-core` (o YAML vai embutido; erro de parse aparece aqui), depois `npm run refresh -- --dry <spec>` até não sobrar **revisar**, e `npx vitest run`. O item "A APL do SimulationCraft mudou" só aparece na rodada que baixou a APL nova (ela é gravada mesmo com `--dry`): ele some na rodada seguinte sem estar resolvido. A validação dele é comparar `.prev.simc` com a atual e conferir que a prioridade do YAML acompanha.
5. **Mostrar ao usuário** o diff do YAML e o relatório antes/depois. Commit e release só com o "pode subir" dele.

## Cada tipo de item

- **"A APL do SimulationCraft mudou"**: compare `.prev.simc` com a atual (ações que entraram/saíram e a ordem). Atualize `priority.<árvore>.st/aoe` na ordem nova; ações novas viram `abilities` (id, nome e cooldown pelo dump). Condições da APL viram `note` curta, pt e en.
- **"está no YAML e nenhum top usou"**: talento removido, renomeado ou id trocado. Procure o nome no dump e nos casts dos tops: id novo → troque `id` (o antigo em `alt_ids` se ainda aparecer em logs velhos); talento que saiu da árvore → tire de `abilities`, `priority`, `opener` e `checks`; talento que só parte dos tops pega → `optional: true`.
- **"não está no YAML"** (habilidade que os tops usam): é botão da rotação? Sim → `abilities` + lugar na prioridade (pela APL). Não (proc automático, evento de pet, parte de outro cast) → `ignore_casts` com comentário do porquê. Ataque automático que gera recurso (ex.: Crusading Strikes) não vai em `ignore_casts` nem em `resource_waste.from`: o `from` lista só os geradores castados (cada um com cast a menos de 100 ms do ganho), e o recurso automático fica fora da conta.
- **Checagem que os tops não cumprem** (no relatório: "os tops cumprem X%", "os tops ficam X% com ele", "os tops usam X% dos possíveis"; proc abaixo de 85%, DoT abaixo de 60%, recurso desperdiçado, cooldown abaixo de 60%): quase sempre leitura errada. Proc gasto por outro spell ou no fim de canal → `spenders`/`channel`; buff consumido por proc automático → tire a checagem; recurso gerado sem apertar botão → fica fora do `resource_waste.from` (só geradores castados entram); cooldown que um quarto dos tops quase não usa → tire da checagem ou `optional`.
- **"Tabela de CDs de cura" do `heal-bench.mjs`** (specs de healer; regra da [note de CDs](../../../docs/heal-cd-note.md)): REVISAR = CD de 60 s ou mais da rotação, castado nas referências, fora de `data/heal-cooldowns.json`. Não é CD de raide (cura de alvo único, buff de dano, botão da rotação) → entrada só com `id`, `name`, `class` (e `alt_ids`), sem `kind`. É CD de raide → entrada completa: `specs`, `talent` se for talento, `kind` (`heal` ou `mitigation`), `effect` (`burst`, `sustained`, `active`), `duration_ms` medida na aura do CD num log, `cooldown_ms` igual ao YAML e `heal_ids` (curas que só existem com o CD ativo; confira nas referências que o id aparece). ATENÇÃO = `heal_id` que nenhuma referência tem: id errado (procure o nome da cura nas referências) ou CD que ninguém usa. Valide com `cargo test -p wipe-core` (`tests/heal_cooldowns.rs`) e rode de novo `node --experimental-strip-types scripts/rotation/heal-bench.mjs <spec>`.
- **"Os próprios tops tiram N na rotação"** (é ATENÇÃO, não REVISAR: só se o usuário pedir): rode `scripts/rotation.mjs check` e ache a checagem que derruba os tops; resolva como acima.

## Regras

- Textos sempre em pt-BR e inglês (`{ pt, en }`); nomes de spell e boss em inglês.
- Títulos com dois-pontos quebram o parse em silêncio: rode o `cargo test` antes de confiar no resultado.
- Não mexa nos números que o refresh calibra (`min_uptime`, `min_usage`): a próxima rodada ajusta.
- Formato do YAML: veja uma spec pronta (ex.: `rotations/paladin-retribution.yaml`) e o `Check` em `crates/wipe-core/src/rotation.rs`.
- Se a spec pedir um tipo de checagem que `rotations/` não tem, pare e proponha o EGM: é o
  critério (b) do Fluxo de feature (CONTRIBUTING).

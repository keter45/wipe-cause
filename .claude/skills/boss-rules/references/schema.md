# Schema das regras de boss

Um arquivo por boss: `encounters/<raid-slug>/<boss-slug>.yaml`.

**Regras globais** (valem para todos os encontros, somadas às do boss) ficam em `encounters/_global/*.yaml` com `scope: global` no cabeçalho e sem `encounter_id`. Use para o que não depende do boss (ex.: dano de ambiente/queda, spell id 0). Análises genéricas — morte lenta, defensivos, poções, interrupts — já são feitas pelo wipe-core e não precisam de regra.

## Cabeçalho

```yaml
schema_version: 1
raid: venomous-abyss            # slug da raid
boss: the-twin-fangs            # slug do boss
name: "The Twin Fangs"
encounter_id: null              # ID do ENCOUNTER_START no log (null se desconhecido)
source:                         # de onde as regras vieram
  - https://www.mythictrap.com/en/venomous-abyss/the-twin-fangs/mythic
updated: 2026-09-28
difficulties: [normal, heroic, mythic]

units:                          # bosses e adds relevantes (nome em inglês → npc_id)
  - { key: vexhul, name: "Vexhul", npc_id: null, boss: true }
  - { key: broodling, name: "Broodling of Ithraz", npc_id: null }

phases:                         # opcional; luta de fase única pode omitir
  - { key: p1, name: "Phase 1", start: pull }
  - { key: transition, name: "Vile Flood", start: { cast: vile_flood } }

mechanics: [ ... ]              # lista de regras (abaixo)
```

## Campos comuns a toda mecânica

| campo | obrig. | descrição |
|---|---|---|
| `key` | sim | slug único no arquivo (`caustic_globule`) — outras regras referenciam por ele |
| `name` | sim | nome em inglês da habilidade |
| `type` | sim | um dos tipos abaixo |
| `source_unit` | não | `key` de `units` |
| `severity` | sim | `wipe` \| `major` \| `minor` \| `none` |
| `roles` | não | `[tank, healer, dps]` — quem pode ser culpado; default todos |
| `difficulty` | não | lista; default = todas do cabeçalho |
| `overrides` | não | mapa dificuldade → campos que mudam (`mythic: { severity: wipe }`) |
| `tip` | sim | o que fazer, 1 frase, pt-BR, palavras próprias |
| `message` | sim | texto do relatório quando dispara (placeholders `{player}` `{count}` `{spell}` `{time}` `{stacks}`) |
| `needs_id` | não | `true` enquanto algum ID estiver `null` |
| `notes` | não | observações de calibração |

IDs: `cast_id` (SPELL_CAST_SUCCESS), `damage_ids` (lista; SPELL_DAMAGE/PERIODIC), `aura_id` (SPELL_AURA_*), `fail_ids` (spell que só acontece quando a mecânica falha, ex.: explosão), `soak_aura_id`, `enrage_aura_id`, `requires_aura` (o dano só conta se o player estiver com essa aura — ex.: soak duplo com vulnerabilidade).

Opções extras:

| campo | descrição |
|---|---|
| `ignore_first_hit_in_burst` | `avoidable_damage`: o 1º hit de cada rajada (hits a <1,5s um do outro) é o alvo da mecânica e não conta como erro. Ex.: linha mirada em um player. |
| `detect.requires_aura` | o dano só conta se o player **já** tinha a aura há 0,5s+ (a vulnerabilidade aplicada pelo próprio hit não conta). Ex.: soak duplo. |
| `detect.excludes_aura` | o dano não conta em quem tem a aura ou a perdeu há <0,5s: é o portador. Ex.: bomba/orb que machuca quem está perto. |
| `detect.min_amount` | hits abaixo do valor não contam (nem para culpa no recap). Ex.: separar a explosão do tick normal do mesmo spell. |
| `detect.culprit_auras` | falha coletiva: culpa quem perdeu uma destas auras entre 0,5s antes e 50ms depois do 1º hit da falha (quem carregava o orb que explodiu). |
| `blame_message` | texto por jogador numa regra coletiva (`{player}`); `message` fica para o resumo. |

> **IDs do Journal ≠ IDs do log.** O cast, o dano, o debuff e a explosão da mesma habilidade costumam ter IDs diferentes, e o Encounter Journal (wiki/wowhead) mostra só um deles. Calibre sempre com `wipe-cli spells <log>` ou a aba "Habilidades do boss" do app.

### O que o motor avalia hoje

`avoidable_damage`, `tank_range`, `positioning`, `stack_limit`, `soak`, `tank_soak`, `interrupt`, `enrage`, `failure_event`, `dispel`, `phase_duration` são avaliados automaticamente. `cc_required`, `spread`, `add_kill`, `hp_balance` e `info` aparecem só como dica ("não avaliadas"). `unavoidable` não aparece no relatório, mas liga o golpe final de uma morte à mecânica.

## Tipos

### `avoidable_damage`
Qualquer dano do spell em player é erro.
```yaml
detect: { damage_ids: [..] }
tolerance: 0          # hits permitidos por player por ocorrência da mecânica
```
Log: `SPELL_DAMAGE`/`SPELL_PERIODIC_DAMAGE` com destino player e spellId em `damage_ids`.

### `stack_limit`
Debuff acumulativo com limite letal.
```yaml
detect: { aura_id: .. }
lethal_stacks: 9
warn_stacks: 7
sources: [corrosive_spit, stir_the_depths]   # keys das mecânicas que dão stack (para atribuir a causa)
removed_by: [ravenous_feast]                  # keys que removem stack
```
Log: `SPELL_AURA_APPLIED_DOSE`/`REMOVED_DOSE`. Relatório mostra a curva de stacks e de onde veio cada uma.

### `soak`
Algo precisa ser absorvido por players; se não, acontece um evento de falha.
```yaml
detect:
  soak_aura_id: ..      # aura/dano recebido por quem soakou (opcional)
  fail_ids: [..]        # explosão/dano no raid quando ninguém soakou
min_soakers: 1
```
Log: evento em `fail_ids` = falha (culpa coletiva; lista quem estava vivo e sem soak). `soak_aura_id` mostra quem ajudou.

### `interrupt`
Cast inimigo que tem que ser interrompido (ou CCado).
```yaml
detect: { cast_id: .. }
accept: [interrupt, cc, kill]   # o que conta como sucesso
```
Log: `SPELL_CAST_SUCCESS` do inimigo = falha; `SPELL_INTERRUPT` credita quem cortou. Relatório: cada cast em ordem (add, quem cortou ou se passou) — a UI compara com a escala de interrupts colada pelo líder (nota do MRT/NSRT).

### `failure_event`
Evento que só acontece quando o raid erra, sem "soak" envolvido (explosão por contato, timer estourado).
```yaml
detect:
  fail_ids: [..]
  min_amount: 800000          # opcional: quando o mesmo spell também tem tick normal
  culprit_auras: [..]         # opcional: auras de portador consumidas na falha
blame_message: "{player} carregava o orb"
```
Log: evento em `fail_ids` = falha coletiva (rajadas a <1,5s contam uma vez). A lista de jogadores tem **só culpados** (via `culprit_auras`); sem elas, fica vazia. Ex.: `the-coiled-altar.yaml` → `purple_detonation`.

### `dispel`
Debuff que um healer/dispeller precisa tirar.
```yaml
detect: { aura_id: .. }
max_delay: 4          # segundos até o dispel; depois disso conta como atrasado
```
Log: `SPELL_AURA_APPLIED` no player abre; `SPELL_DISPEL` (extraSpellId = aura) credita quem dispelou e mede o tempo; debuff que sai sem dispel (ou depois de `max_delay`) = falha. Relatório: tempo de cada dispel, quem dispelou e quem ficou sem.

### `phase_duration`
Fase cronometrada: o boss fica numa aura (imune, intermissão) até o raid resolver a mecânica — quanto mais rápido, melhor.
```yaml
detect: { aura_id: .. }   # aura no boss: entra no começo, sai quando o raid resolve
target_s: 9               # tempo bom
max_s: 12                 # acima disto, lenta (conta como falha)
overrides:
  mythic: { target_s: 11, max_s: 16 }
```
Log: `SPELL_AURA_APPLIED` num inimigo abre a janela (dois bosses com a aura juntos = uma janela só) e `SPELL_AURA_REMOVED` fecha. Compara em segundos arredondados (a aura sai no tick do servidor). Falha = fase lenta, fase com 3+ mortes de players (a mecânica deu errado) ou wipe com a fase aberta. Relatório: cada janela com a duração e as mortes (aba Mecânicas) e a tabela pull a pull com o melhor da noite (resumo do boss). Ex.: `entombed-sentinels.yaml` → `vitriolic_stasis`.

### `cc_required`
Precisa de CC/stop para quebrar algo (escudo, cast).
```yaml
detect: { aura_id: .. }         # o escudo/buff que deve ser removido
fail_ids: [..]                  # opcional
window: 8s                      # tempo máximo que a aura pode ficar
```

### `spread`
Player marcado deve se afastar; erro é atingir outros ou deixar poça no lugar errado.
```yaml
detect:
  aura_id: ..           # debuff de marcação
  damage_ids: [..]      # dano que não deveria atingir outros
```
Log: dano em player **sem** o `aura_id` atribuído ao portador mais próximo no tempo. Posição não existe no log (só em alguns eventos com Advanced Logging) — trate como heurística e diga isso em `notes`.

### `tank_soak`
Tank precisa receber o hit; falha gera dano no raid.
```yaml
roles: [tank]
detect: { damage_ids: [..], fail_ids: [..] }
expected_hits: 3
```

### `add_kill`
Adds precisam morrer dentro de um tempo.
```yaml
detect: { unit: spawn_of_vexhul }
kill_within: 20s
```
Log: `SPELL_SUMMON`/primeiro evento do NPC → `UNIT_DIED`.

### `enrage`
Buff de enrage aplicado em inimigo = falha coletiva.
```yaml
detect: { enrage_aura_id: .. }
```

### `hp_balance`
Bosses precisam morrer juntos.
```yaml
detect:
  units: [vexhul, ithraz]
  enrage_aura_id: ..
max_hp_diff_pct: 10
```
Log: HP dos bosses via Advanced Logging; aura de enrage = falha.

### `tank_range` / `positioning`
Spell que só dispara quando alguém está no lugar errado (ex.: bolt quando o tank sai do alcance).
```yaml
detect: { damage_ids: [..] }
```
Qualquer ocorrência = erro de quem estava fora de posição.

### `unavoidable`
Dano de raid inevitável. Nunca gera culpa; usado para contexto no death recap e análise de healer/defensivos.
```yaml
detect: { damage_ids: [..] }
severity: none
```

### `enrage`
Soft/hard enrage por tempo ou condição.
```yaml
detect: { aura_id: .. }
at: 540s        # se hard enrage por tempo
```

### `info`
Mecânica sem detecção confiável pelo log. Aparece só como dica no relatório.

# Designs

Índice dos design docs do wipe-cause. Cada design novo ganha uma linha em
"Designs", com a coluna Status mantida à mão. O projeto não usa mais o EGM
desde 2026-11-20: os designs são escritos à mão, pelo template abaixo.
Quando usar o fluxo: seção "Fluxo de feature" do
[guia de contribuição](../CONTRIBUTING.pt-BR.md#fluxo-de-feature).

## Designs

| Link | Status | Data | Autor | Componentes | Descrição |
| :--- | :----- | :--- | :---- | :---------- | :-------- |
| [egm-adoption.md](egm-adoption.md) | Implemented | 2026-10-26 | @keter45 | `docs/`, `CLAUDE.md`, `.claude/skills/`, `scripts/` | Regras do projeto e auditoria dos docs (o fluxo EGM saiu em 2026-11-20) |
| [gloombomb-assignment.md](gloombomb-assignment.md) | Implemented | 2026-10-27 | @keter45 | `crates/wipe-core`, `encounters/`, `data/defensives.json`, `scripts/replay-check.mjs` | Atribuição por posição: quem da Gloombomb não chegou ao add |
| [heal-cd-note.md](heal-cd-note.md) | Implemented | 2026-10-27 | @keter45 | `src/`, `data/heal-cooldowns.json`, `crates/wipe-core` | Note de CDs de cura: timing, uso, momentos sem CD e note sugerida |
| [heal-cd-timeline.md](heal-cd-timeline.md) | Implemented | 2026-11-03 | @keter45 | `src/` | Timeline dos CDs de cura: buracos na cura e CDs que renderam pouco |
| [replay-unit-exit.md](replay-unit-exit.md) | Implemented | 2026-11-09 | @keter45 | `crates/wipe-core`, `encounters/`, `scripts/replay-check.mjs`, `docs/replay-methods.md` | Saída do replay para unidade sem UNIT_DIED: última linha do log ou aura de quem pegou (ovos do Ula'tek) |
| [replay-cast-waves.md](replay-cast-waves.md) | Implemented | 2026-11-12 | @keter45 | `crates/wipe-core`, `src/`, `encounters/`, `scripts/replay-check.mjs`, `docs/replay-methods.md` | Ondas do replay disparadas por cast de NPC, na direção dos acertos (caudas do Ula'tek) |
| [boss-new.md](boss-new.md) | Implemented | 2026-11-20 | @keter45 | `scripts/`, `crates/wipe-core`, `encounters/`, `data/arenas.json`, `.claude/skills/` | Boss novo num comando: coleta do Journal/BigWigs/WCL, rascunho da regra, `wipe-cli probe`, forma medida no `replay:check`, `history` por data |

Status: Proposed → Approved → Implemented → Superseded by `<design>`.

Regras e docs de método: seção
[Regras do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto) e os blocos de
"Processos padrão" do guia de contribuição.

## Template

Cabeçalho com Author, Status e Date;
depois, nesta ordem:

1.  Overview
2.  The Problem
3.  Goals
4.  Non-Goals
5.  Open Questions
6.  Critical User Journeys
7.  Technical Plan
8.  Alternatives Considered
9.  Non-Functional Requirements
10. Detailed Implementation Plan (com Verification Plan)

Exemplo completo: [egm-adoption.md](egm-adoption.md).

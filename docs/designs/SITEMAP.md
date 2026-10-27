# Designs

Índice dos design docs do wipe-cause. O `/egm:egm-draft` acrescenta uma linha em
"Designs" a cada design salvo; a coluna Status é preenchida e mantida à mão.
Quando usar o fluxo: seção "Fluxo de feature" do
[guia de contribuição](../CONTRIBUTING.pt-BR.md#fluxo-de-feature).

## Designs

| Link | Status | Data | Autor | Componentes | Descrição |
| :--- | :----- | :--- | :---- | :---------- | :-------- |
| [egm-adoption.md](egm-adoption.md) | Implemented | 2026-10-26 | @keter45 | `docs/`, `CLAUDE.md`, `.claude/skills/`, `scripts/` | Regras do projeto, fluxo EGM e auditoria dos docs |
| [gloombomb-assignment.md](gloombomb-assignment.md) | Approved | 2026-10-27 | @keter45 | `crates/wipe-core`, `encounters/`, `data/defensives.json`, `scripts/replay-check.mjs` | Atribuição por posição: quem da Gloombomb não chegou ao add |

Status: Proposed → Approved → Implemented → Superseded by `<design>`.

Regras e docs de método: seção
[Regras do projeto](../CONTRIBUTING.pt-BR.md#regras-do-projeto) e os blocos de
"Processos padrão" do guia de contribuição.

## Template

Para escrever um design sem o plugin EGM. Cabeçalho com Author, Status e Date;
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

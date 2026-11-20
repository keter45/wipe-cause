# wipe-cause

App que lê o combat log do WoW (ou um report do Warcraft Logs) e explica por
que a raide morreu. Comece por [README.md](README.md),
[docs/CONTRIBUTING.pt-BR.md](docs/CONTRIBUTING.pt-BR.md) e
[docs/designs/SITEMAP.md](docs/designs/SITEMAP.md).

## Regras

As regras do projeto estão em
[Regras do projeto](docs/CONTRIBUTING.pt-BR.md#regras-do-projeto).

## Antes de escrever código

Feature grande = (a) muda núcleo e interface juntos, (b) cria tipo novo de
campo ou checagem em `encounters/`, `rotations/` ou `data/*.json`, ou
(c) traz integração externa nova. Ficam fora: correção com causa conhecida,
boss ou spec com campos existentes, mudança só de texto, mudança só visual
sem tela ou componente novo. Texto completo:
[Fluxo de feature](docs/CONTRIBUTING.pt-BR.md#fluxo-de-feature).

- Cumpre: escreva o design à mão em `docs/designs/<feature>.md`, pelo
  template do [SITEMAP](docs/designs/SITEMAP.md), e só codifique com ele
  aprovado pelo desenvolvedor.
- Não cumpre e é boss ou spec: use a skill do processo padrão.
- Na dúvida: pergunte.

O projeto não usa mais o EGM (plugin `egm@egm`) desde 2026-11-20: nada de
`/egm:*` nem de agentes `egm:*`.

## Design de feature grande

- Design salvo: `docs/designs/<feature>.md` com Status Approved e a linha no
  SITEMAP (com a coluna Status), dentro do PR da feature; a descrição do PR
  cita o design.
- Antes de aprovar a feature: confira o design contra o código com a
  variante de design do prompt em "Auditoria: prompt literal de cada
  agente" de [egm-adoption.md](docs/designs/egm-adoption.md), num subagente
  comum só de leitura. No último commit do PR, antes do merge: Status
  Implemented no design e no SITEMAP.

## Layout de tela

Se a skill `zero-draft` estiver instalada, use-a no layout de tela nova ou
alterada, no design e na implementação, só para conferir hierarquia,
composição, estados de interação, acessibilidade e tipografia; ela não
define direção visual nova. Em conflito, vale a regra 5 de "Regras do
projeto". Sem a skill, siga só a regra 5.

## Antes de uma release minor

`npm run docs:links` e a conferência dos docs (Parte 3, item 6, de
[egm-adoption.md](docs/designs/egm-adoption.md)), com um subagente comum só
de leitura por unidade no lugar do `egm:egm-codebase-details`.

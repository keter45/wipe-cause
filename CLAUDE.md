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

- Cumpre: proponha `/egm:egm-brainstorm` (solução ainda não escolhida) ou
  `/egm:egm-draft` (solução escolhida) antes de codar.
- Não cumpre e é boss ou spec: use a skill do processo padrão.
- Na dúvida: pergunte.

## EGM

EGM artifact directory: .egm

- Plugin `egm@egm` 0.1.0; Claude Code 2.1.271 ou mais novo (abaixo disso,
  os revisores não rodam isolados).
- No `/egm:egm-review`, passe como contexto dos revisores
  `docs/CONTRIBUTING.pt-BR.md`, `docs/designs/SITEMAP.md` e os docs de
  regras que o design cita, e diga a todo revisor: "não leia nada em
  `samples/`".
- Design salvo: `docs/designs/<feature>.md` com Status Approved e a linha no
  SITEMAP (com a coluna Status), dentro do PR da feature; a descrição do PR
  cita o design.
- Antes de aprovar a feature: confira o design contra o código com a
  variante de design do prompt em "Auditoria: prompt literal de cada
  agente" de [egm-adoption.md](docs/designs/egm-adoption.md). No último
  commit do PR, antes do merge: Status Implemented no design e no SITEMAP.

## Layout de tela

Se a skill `zero-draft` estiver instalada, use-a no layout de tela nova ou
alterada, no design e na implementação, só para conferir hierarquia,
composição, estados de interação, acessibilidade e tipografia; ela não
define direção visual nova. Em conflito, vale a regra 5 de "Regras do
projeto". Sem a skill, siga só a regra 5.

## Antes de uma release minor

`npm run docs:links` e a conferência dos docs (Parte 3, item 6, de
[egm-adoption.md](docs/designs/egm-adoption.md)).

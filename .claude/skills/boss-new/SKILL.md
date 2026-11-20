---
name: boss-new
description: Cadastra um boss novo de ponta a ponta com o `npm run boss:new` — coleta do Encounter Journal, das tabelas de spell e do BigWigs, rascunho da regra, medição das formas no log (wipe-cli probe), arena e conferência (replay:check, sim:check) — e resolve os REVISAR do relatório. Use quando o usuário pedir para "criar um boss novo", "cadastrar o boss X", "começar o boss da raide nova", der um encounter id, quando sair um boss novo no patch, ou colar um trecho de samples/boss/*/*.md. Para mexer num boss que já existe, use direto boss-rules, replay-build ou sim-calibrate.
---

# boss-new

O `npm run boss:new` faz tudo o que é número e escreve `samples/boss/<slug>/<data>-<dificuldade>.md`,
com OK / ATENÇÃO / REVISAR por etapa. Esta skill decide o que o script não decide: **que tipo** cada
mecânica é, **quem leva a culpa**, **que forma** ela tem no replay e se o número medido vale. Design:
`docs/designs/boss-new.md`.

## Rodar

1. Ache o `encounter_id` (o do `ENCOUNTER_START`; o BigWigs usa `SetEncounterID`, o WCL mostra na URL do
   ranking).
2. Escolha as fontes, da mais forte para a mais fraca:
   - `--log <WoWCombatLog.txt>`: a noite da guilda (também roda o `sim:check` e o `arena-check`);
   - `--tops N`: os N reports mais recentes com kill no Warcraft Logs (credenciais do `refresh`);
   - `--wcl <código>`: reports escolhidos;
   - nenhuma: só coleta e rascunho (boss do próximo patch).
3. `npm run boss:new -- <id> [fontes] --difficulty Mythic`. Rodar de novo reaproveita o cache; `--only
   <etapa>` refaz uma; `--fresh` baixa tudo de novo.

## Resolver, na ordem das etapas

1. **Coleta.** Sem Journal: id errado. Sem BigWigs: siga só com o log (precisa do `gh` autenticado).
2. **Rascunho.** O arquivo novo em `encounters/<raide>/<boss>.yaml` tem uma mecânica por spell do Journal,
   `type: info`, textos "A revisar" e `needs_id` onde nada confirmou o id. Enquanto o cabeçalho `# RASCUNHO`
   estiver no arquivo, o `boss:new` refaz o rascunho a cada rodada (com os ids do log, quando houver):
   **tire o cabeçalho ao começar a editar à mão**. Para cada uma, com a skill
   `boss-rules`: confirme o id pelo papel (`wipe-cli probe ids <fonte> --encounter <id>`: cast, aura em
   player, dano em player), escolha o `type` pela pergunta "que evento prova que alguém errou?", escreva
   `tip`/`message` nas duas línguas e tire o `needs_id`. Spell do Journal que é só estado ou outro id da
   mesma habilidade: junte na mecânica certa ou apague. Complete `phases` (gatilho e `hp`). Se a regra já
   existia, o script grava `<boss>.draft.yaml` ao lado: compare e traga o que faltar, depois apague o draft.
3. **Medição.** A tabela "Medidas" tem um candidato por forma que a regra já tem (raio por pulso, frontal,
   ponto na frente de quem lança, ondas, poça). Antes de pôr o número na regra, confira a premissa
   (`docs/replay-methods.md`, princípio 10) e anote no comentário da regra de onde veio (data, logs,
   casos). Forma nova (a mecânica não tem `area`/`cone`/`soak`/...): escolha a forma com a `replay-build`
   e rode o `probe` certo à mão (`wipe-cli probe` sem argumentos lista as medidas).
4. **Arena.** Sem arena: seção "Arena" da `replay-build` (`arena-fit --write`, `--anchors` com os lugares
   onde cada add nasce, que o `probe units` lista).
5. **Conferência.** Os itens do `replay:check` (forma medida contra o log, ids fora do papel, dano que cai
   com a distância sem forma) vão para a `replay-build`; os do `sim:check`, para a `sim-calibrate`.
6. Rode o `boss:new` de novo até não sobrar REVISAR sem explicação. Escreva a auditoria em
   `docs/<boss>-replay-audit.md` a partir do "Esboço da auditoria" do relatório.

## Regras

- O log manda: Journal, tooltip e BigWigs só dizem o que procurar. Raio de 50 jd ou mais nas tabelas do jogo
  costuma ser alcance, não área.
- Nunca chute id nem tamanho; o que fica sem número continua `needs_id` ou `info`, com `notes`.
- Nerf de tamanho ou de dano: `history` na mecânica (schema da `boss-rules`), não um campo novo.
- Textos nas duas línguas; nomes de habilidades e bosses em inglês.
- Mostre ao usuário o relatório antes/depois. Commit e release só com o "pode subir" dele.

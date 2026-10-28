# Como contribuir

[← Voltar ao README](../README.pt-BR.md)

### Estrutura

| pasta | o quê |
|---|---|
| `crates/wipe-core` | parser do combat log e análise dos pulls (Rust, sem dependência de UI) |
| `src-tauri` | app desktop (Tauri) que expõe o `wipe-core` para a UI |
| `src` | interface (React + TypeScript) |
| `crates/wipe-wasm` | o núcleo compilado para WebAssembly para a versão web (bindings em `src/web/pkg`, gerados pelo `npm run wasm`; o backend web é `src/web/`) |
| `encounters/` | regras por boss (YAML), geradas pela skill `boss-rules`; o que cada habilidade desenha no replay vem da skill `replay-build` |
| `rotations/` | rotação base por spec (YAML), mantida pelo `npm run refresh` e pela skill `rotation-refresh` |
| `src/lib/simProfile.ts` | o modelo da luta que o robô do SimulationCraft joga, conferido por boss pelo `npm run sim:check` e pela skill `sim-calibrate` |
| `data/` | tabelas editáveis: defensivos por classe, consumíveis, interrupts, utilidade dos players como CC (`utility.json`) e as arenas dos bosses (`arenas.json`) |
| `docs/screenshots/` | prints e clipes animados do README e do guia de uso (`pt/` e `en/`) |
| [`docs/designs/`](designs/SITEMAP.md) | design docs das features grandes, com índice no `SITEMAP.md` |
| [`docs/APP-MAP.pt-BR.md`](APP-MAP.pt-BR.md) | mapa das telas e de como elas se ligam |

### Desenvolvimento

Pré-requisitos: Node 22.12+ (o Vite e o Vitest pedem; o `npm run refresh` usa `--experimental-strip-types`), Rust (rustup) e MSVC Build Tools (Windows).

```bash
npm install
npm run tauri dev
```

Rodar só o analisador, sem UI:

```bash
cargo run -p wipe-core --bin wipe-cli -- analyze caminho/do/WoWCombatLog.txt
```

Subcomandos do `wipe-cli` (os scripts usam o build de release, `cargo build --release -p wipe-core --bin wipe-cli`, em `target/release/`):

- `analyze <arquivo> [--json] [--cutoff N] [--tuning <pasta>]`: os pulls, ou o relatório inteiro em JSON; `--cutoff N` ignora eventos depois de N mortes; `--tuning` aplica os ajustes de regra do usuário (`<encounter_id>.json`). O `--cutoff` também vale no `wcl`, no `spells` e no `fight`, e o `--tuning` no `spells` e no `fight` (no `wcl`, só nos pulls do `--local`).
- `spells <arquivo>`: spells inimigas por pull, em CSV (encontro, spell, casts, hits, dano), para calibrar regras de boss.
- `rules`: as regras de boss embutidas, em JSON.
- `peek <arquivo>`: só os encontros do log (leitura rápida).
- `positions <arquivo>`: onde os players pisaram em cada boss, para alinhar a imagem da arena.
- `radius <arquivo> --damage <id> (--aura <id> | --npc <id> | --soak)`: o raio de uma área.
- `wcl <pasta>[,<pasta>] [--json] [--local <log>]`: analisa reports baixados do Warcraft Logs (`scripts/wcl-fetch.mjs`); `WIPE_TZ` define o fuso deles (padrão -3).
- `fight <arquivo> --pull <id>`: o replay completo de um pull.

Versão web (o mesmo núcleo em WebAssembly, publicado no GitHub Pages):

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run wasm
npm run dev:web
```

O `npm run wasm` compila o `crates/wipe-wasm` em `src/web/pkg`; o `npm run build:web` gera o site.

Para testar o ao vivo sem estar em raid: `node scripts/simulate-live.mjs <log antigo> <pasta Logs> [pulls=3] [segundos por pull=8]` escreve alguns pulls de um log real, aos poucos, num `WoWCombatLog` novo.

Outras ferramentas de desenvolvimento:

| Comando | O quê |
|---|---|
| `npm test` | testes do Vitest (interface, guardas de idioma, scripts) |
| `npm run typecheck` | confere o TypeScript sem gerar build |
| `npm run dev` / `npm run build` / `npm run preview` | a interface no Vite sem o Tauri, o build de produção (o CI roda) e uma prévia desse build |
| `cargo clippy -p wipe-core --all-targets -- -D warnings` | lint do núcleo; o CI falha com qualquer aviso |
| `cargo clippy -p wipe-wasm --target wasm32-unknown-unknown -- -D warnings` | lint do núcleo web (CI) |
| `cargo test -p wipe-core` | testes do núcleo (como no CI; `cargo test` sozinho roda o workspace inteiro) |
| `npm run fixture` | gera de novo o log de teste do núcleo (`crates/wipe-core/tests/fixtures/`) |
| `npm run docs:links` | confere os links entre os docs |
| `node scripts/wcl-fetch.mjs <código> [pasta]` | baixa um report do Warcraft Logs para `samples/wcl-<código>/` (credenciais só por variável de ambiente) |
| `node scripts/compare-reports.mjs a.json b.json` | compara dois relatórios do `wipe-cli` pull a pull |
| `node scripts/arena-check.mjs <log> <encounter id> [--difficulty 16] [--draw saida.svg]` | confere que tudo o que não é player fica dentro do chão da arena |
| `node scripts/i18n-yaml.mjs extract <saida.json>` / `apply <entrada.json>` | converte textos de YAML escritos numa língua só |

Variáveis de ambiente de desenvolvimento: `WIPE_DEV_SIMC_EXE` (o SimulationCraft que a ponte de desenvolvimento do Vite roda), `WIPE_DEV_VIDEO_DIR` (vídeos servidos em desenvolvimento), `WIPE_GAZE_DUMP` (grava os dados dos fantasmas para o `scripts/ghost-calibrate.mjs`) e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (a senha da chave de assinatura, se ela tiver uma).

Workflows do GitHub: `ci.yml` (testes, clippy e builds, em todo PR e push na `main`), `pages.yml` (publica a versão web, no push na `main` ou à mão) e `simc.yml` (compila o SimulationCraft que o app baixa, toda semana e à mão; um PR que muda o `simc.yml` só compila).

### Textos nas duas línguas

Todo texto novo entra em português e inglês na mesma mudança.

- **Interface:** os textos ficam em dicionários (`*.i18n.ts` ou `*.i18n.tsx`, com `defineMessages(pt, en)`; e em `src/i18n/`); o inglês é tipado contra o português, então faltar uma frase não compila. Um teste falha se aparecer português fora dos dicionários, outro se o lado inglês de um dicionário tiver português, e um terceiro se uma string do Rust tiver português fora de `pick()`, `tx!` ou `Text` (pares pt/en montados à mão levam `i18n-ignore` na linha).
- **Regras de boss e rotações (YAML):** dicas, mensagens, títulos e notas são `{ pt: "...", en: "..." }`; os nomes ficam em inglês. O teste do `wipe-core` confere as duas coisas.
- **Notas de versão:** uma seção `## Português` e uma `## English` (o app mostra a do idioma escolhido).

### Regras do projeto

Regras que decidem como uma feature é desenhada neste projeto.

1. **Boss é dado, não código.** O que um boss mostra ou cobra sai da regra dele (`encounters/`) ou de `data/*.json`. Boss que pede algo novo ganha um campo genérico, pensado para outros bosses, pelo [Fluxo de feature](#fluxo-de-feature) (critério b); nunca um `if` para um boss. Detalhe: [replay-methods.md](replay-methods.md), princípio 1.
2. **Referência de healer vem de fora da guilda.** A análise de healer compara só com logs de outras guildas. Os logs da nossa raid nunca são o "certo": nem o colega da mesma spec, nem um kill anterior do próprio player, nem para calibrar metas. Parâmetros da luta, como o golpe e a raide baixa da [note de CDs de cura](heal-cd-note.md), medem o boss, não o healer, e podem ser calibrados nos nossos logs (decisão de 2026-10-27). Detalhe: [healer-analysis.md](healer-analysis.md).
3. **Release só com feature aprovada.** Versão e release saem só depois que o desenvolvedor aprova a feature. Detalhe: bloco "Versões e atualização automática".
4. **Peça de boss ou de spec é processo padrão:** um script faz os números e, fora as regras de boss, escreve um relatório OK / ATENÇÃO / REVISAR; uma skill resolve os REVISAR. Detalhe: [Processos padrão](#processos-padrão).
5. **Interface.** Toda habilidade aparece com ícone e nome (ícone sozinho só onde não cabe texto, com o nome no tooltip). Todo boss aparece com o ícone do boss. Todo personagem aparece na cor da classe, também dentro de frases. Cartões, listas e avisos não têm faixa nem borda colorida na lateral ou no topo; item selecionado muda só o fundo. Exceção: mensagens de texto do Discord.
6. **O replay mostra as habilidades do boss.** Frontais como cone, o que fica no chão, áreas em volta de quem carrega algo ou de uma unidade do boss, linhas, soaks, explosões, orbs e adds aparecem sempre no mapa, em cima da arena do boss. Detalhe: [replay-methods.md](replay-methods.md).

### Fluxo de feature

Passa pelo EGM o pedido que cumpre pelo menos um destes:

- **(a)** muda o núcleo (`crates/` ou `src-tauri/`) e a interface (`src/`) na mesma mudança;
- **(b)** cria um tipo novo de campo ou de checagem em `encounters/`, `rotations/` ou `data/*.json`;
- **(c)** traz uma integração externa nova (serviço, programa ou formato de arquivo que o app ainda não lê).

Ficam fora, mesmo que cumpram (a): correção de bug com causa conhecida, e conteúdo de boss ou de spec que só usa campos que já existem (esses vão pelos processos padrão). Também ficam fora: mudança só de texto (docs ou frases da interface) e mudança só visual que não cria tela nem componente. Na dúvida, a sessão pergunta ao desenvolvedor.

Uma feature grande tem um design em `docs/designs/` (índice no [SITEMAP.md](designs/SITEMAP.md)), com Status Approved, dentro do PR da feature e citado na descrição do PR. Ele pode ser escrito à mão, pelo template do SITEMAP, ou com o plugin EGM (`egm@egm`).

Antes de uma release minor: `npm run docs:links` sai com 0, e a conferência dos docs do [design do EGM](designs/egm-adoption.md) roda no CONTRIBUTING, no APP-MAP e nos docs de regras, e em todo doc que mudou desde a última tag minor.

### Processos padrão

Cada peça de um boss e de uma spec tem o seu processo: um script faz o que é número (sem IA) e escreve um relatório com **OK**, **ATENÇÃO** ou **REVISAR**; uma skill do Claude Code cuida dos itens REVISAR. As regras de boss são a exceção: o `wipe-cli spells` (CSV) e o `wipe-cli radius` (histograma) dão os números sem status, e o relatório com status do boss vem do `replay:check`.

| O quê | Números | REVISAR |
|---|---|---|
| Regras do boss (o que é erro, quem leva a culpa) | `wipe-cli spells` / `wipe-cli radius` | skill `boss-rules` |
| Replay do boss (habilidades no mapa, arena) | `npm run replay:check` | skill `replay-build` |
| Rotação da spec | `npm run refresh` | skill `rotation-refresh` |
| Simulação do boss (o robô do SimulationCraft) | `npm run sim:check` | skill `sim-calibrate` |

Um boss novo passa pelos dois primeiros e pelo último; um patch ou uma raide nova, também pelo `refresh`.

<details>
<summary><b>Atualizar tudo depois de patch, raide nova ou nerf</b></summary>

`npm run refresh` refaz sem IA tudo o que muda com o jogo: baixa a APL do SimulationCraft (e marca as specs em que ela mudou), roda os tops de cada spec pelo motor, ajusta só os números das rotações (metas de uptime e de uso de cooldown pelo quartil de baixo dos tops; id novo da mesma habilidade em `alt_ids`; evento repetido do mesmo botão em `ignore_casts`), gera a referência dos tops por boss e escreve um relatório em `samples/refresh/<data>.md` (e `.json`; uma rodada em algumas specs escreve `<data>-<specs>.md`) com cada spec **OK**, **ATENÇÃO** ou **REVISAR**.

- `npm run refresh -- --tops`: baixa os tops antes (credenciais por variável de ambiente, `samples/wcl-credentials.env`, fora do git, ou o cofre do app; com mais de um cliente no arquivo, troca quando os pontos por hora acabam).
- `npm run refresh -- --tops --zone latest --fresh`: raide nova; os chefes vêm da zona mais nova do Warcraft Logs (sem regras escritas) e os tops do raide anterior saem da referência. O `--zone` também aceita o id de uma zona; o `--fresh` renomeia cada pasta de tops antiga para `tops-<data>`, sem apagar nada.
- `npm run refresh -- arcane fire`: só essas specs (sem nomes, todas as specs com YAML em `rotations/`).
- `npm run refresh -- --tops --per-boss N`: quantos tops baixar por boss (padrão 4).
- `npm run refresh -- --dry`: só o relatório, sem mudar YAML nem referência (o cache da APL do SimulationCraft é atualizado mesmo assim, então a rodada seguinte não marca mais "APL mudou"); dá para combinar com nomes de spec.

REVISAR é o que muda o que a spec é (habilidade que os tops pararam de usar, habilidade nova, APL nova, checagem que nem os tops cumprem): a skill `rotation-refresh` do Claude Code cuida disso.

</details>

<details>
<summary><b>Gerar a rotação de uma spec</b></summary>

Sem escrever à mão nem usar IA: `scripts/rotation.mjs` monta o YAML a partir da APL e dos dados de spell do SimulationCraft e calibra nos logs dos tops do Warcraft Logs.

1. `node scripts/rotation.mjs tops <spec> [--difficulty 5] [--per-boss 2]`: baixa os 2 melhores parses de cada chefe do raide (luta com Power Infusion de outra pessoa sai), com os eventos do player e dos pets, os buffs nele, as mortes, os casts dos inimigos e o dano de um colega, em `samples/rotation/<spec>/tops/`. Credenciais como no `refresh`: variável de ambiente, `samples/wcl-credentials.env` ou o cofre do app.
2. `node scripts/rotation.mjs calibrate <spec> [--dirs a,b] [--force]`: gera o rascunho e o roda nos tops pelo próprio motor do app.
   - **Prioridade:** sai da APL, por árvore de herói, em alvo único e AoE.
   - **Ids:** vêm do que os tops castam.
   - **Números:** cooldown, cargas e cast vêm do dump do SimC (ou do tooltip do Wowhead).
   - **Checagens inferidas:** DoT, pelo `dot.X.refreshable`; proc, pelo `buff.X.react` numa spell que o buff modifica; recurso, pelo custo dos gastos; cooldowns de 20s ou mais (ou de 15s ou mais com mais de uma carga).
   - **Calibração pelos tops:** metas de uptime e de uso de cooldown pelo que os tops fazem; abertura, pelo que 70% deles casta nos primeiros segundos; sai o que nem os tops cumprem.
   - **Destino:** escreve em `rotations/`; se já existe uma escrita à mão, vai para `samples/rotation/<spec>/` para comparar, a menos que use `--force`.
3. `node scripts/rotation.mjs check <spec> [--dirs a,b] [--opener]`: mostra como os tops se saem na rotação atual, para validar uma escrita à mão.

Também: `node scripts/rotation.mjs gen <spec> [--dirs a,b] [--force]` (só o rascunho, com a calibração anterior) e `node scripts/rotation.mjs refs <spec> [--per-boss 4]` (healers: logs de referência; regras em [healer-analysis.md](healer-analysis.md)). O `--dirs` recebe pastas no formato do `scripts/wcl-fetch.mjs` no lugar dos tops baixados; o `--build` recompila o `wipe-cli` antes; o `<spec>` pode ser `unholy`, `deathknight-unholy` ou o id (252). Depois do `refs`, `node --experimental-strip-types scripts/rotation/heal-bench.mjs [spec ...]` escreve `src/data/heal-refs/<spec>.json`, a referência de healer que o app lê.

Tipos de checagem: `proc` (buff que precisa ser gasto, carga por carga — ex.: Precise Shots, Demonic Core), `requires_buff` (casts que pedem um buff — ex.: Trick Shots, Demonbolt com Demonic Core), `downtime` (tempo sem castar, só quando a raid estava batendo), `cooldown` (usos vs. possíveis no tempo vivo), `resource_waste` (recurso estourado, ex.: Maelstrom, Astral Power, Soul Shards), `dot_uptime` (DoT no alvo, ex.: Flame Shock), `aoe_swap` (com N+ alvos o cast deveria ser outro, ex.: Chain Lightning), `ally_uptime` (healers: buff do player mantido em gente da raide, ex.: Beacon of Light, com meta de tempo ou de quantidade de alvos) e `after_cast` (cast que precisa vir logo antes ou depois de outro, ex.: Demonic Tyrant com os Dreadstalkers fora).

Os textos saem em modelo ("X perdido: use antes de acabar"): vale revisar os pontos principais antes de publicar.

</details>

<details>
<summary><b>Montar o replay de um boss</b></summary>

[Regra do projeto 6](#regras-do-projeto): as habilidades do boss aparecem sempre no replay (frontais como cone, o que fica no chão, áreas em volta de quem carrega algo ou de uma unidade do boss, linhas, soaks, explosões, orbs, adds), em cima da arena do boss (imagem do raidplan.io alinhada com as coordenadas do log, `data/arenas.json`).

`npm run replay:check -- <WoWCombatLog.txt | relatório.json> [--boss "<nome>"] [--difficulty Mythic]` (sem eles, o boss e a dificuldade com mais pulls) cruza o log com a regra do boss e com a arena e escreve `samples/replay/<data>-<boss>-<dificuldade>.md` (e `.json`): cada habilidade inimiga que acertou players, a regra em que ela está e o que desenha; os casts do boss que nenhuma regra conhece (frontais e linhas costumam começar aí); unidades que fazem dano e não aparecem no mapa; arena que falta ou mal encaixada. Precisa do `wipe-cli` compilado em release.

REVISAR é uma forma ou uma regra a escrever: a skill `replay-build` do Claude Code cuida disso (formas, tamanhos medidos com `wipe-cli radius`, a arena com `scripts/arena-fit.mjs`, os fantasmas com `scripts/ghost-calibrate.mjs`). Auditoria de exemplo: [docs/coiled-altar-replay-audit.md](coiled-altar-replay-audit.md). Método: [docs/replay-methods.md](replay-methods.md). Outra auditoria: [docs/twin-fangs-vashnik-replay-audit.md](twin-fangs-vashnik-replay-audit.md).

</details>

<details>
<summary><b>Configurar a simulação de um boss (o robô do SimulationCraft)</b></summary>

O robô joga **o modelo da luta**, tirado do log. Cada player é simulado no seu próprio pull daquele boss e dificuldade, na mesma noite (uma kill em que ficou vivo → uma kill → o pull mais longo sem morrer → o de mais tempo vivo); dentro de um pull, o modelo é o mesmo para todos: quanto a luta fez andar (a cada 30s, o quarto dos DPS que menos andaram), alvos e adds, tempo sem alvo, vida por fase (para o robô ficar em execute o mesmo tempo que a luta) e Bloodlust/Power Infusion nos mesmos momentos. Nada é escrito à mão por boss; quem decide é o log e as regras do boss (`phases` em `encounters/`).

`npm run sim:check -- <WoWCombatLog.txt | relatório.json> [--boss "<nome>"] [--difficulty Mythic] [--iterations 1000] [--cutoff 4]` simula os DPS e tanks da raide no boss (os healers ficam de fora) com o próprio código do app, compara com o que cada um fez e escreve `samples/sim/<data>-<boss>-<dificuldade>.md` (e `.json`) com **OK**, **ATENÇÃO** ou **REVISAR**: mediana dos DPS (sem tanks e Augmentation) fora de 85–105% do robô (o modelo da luta está fácil ou difícil demais), DPS acima de 110% (o robô está fraco para aquela spec: adds, execute ou a APL da spec), perfil que o SimulationCraft não rodou, perfil sem o movimento medido (um `wipe-cli` antigo); ATENÇÃO para DPS abaixo de 70% do robô. Precisa do `wipe-cli` compilado em release e do SimulationCraft do app (ou `WIPE_SIMC_EXE`).

REVISAR é o que muda o modelo da luta (uma medida no núcleo, as fases do boss, uma constante do modelo): a skill `sim-calibrate` do Claude Code cuida disso. As regras completas estão em [docs/simulation.md](simulation.md).

</details>

<details>
<summary><b>Versões e atualização automática</b></summary>

Versões seguem semver. Cada feature grande é fechada em uma release (`vX.Y.Z`) depois de aprovada.

O app instalado procura versão nova ao abrir (e a cada 6h): lê o `latest.json` da última release do GitHub e mostra uma faixa; em **Atualizar e reiniciar**, baixa o instalador, confere a assinatura e reinstala sozinho (em desenvolvimento não procura). Na barra lateral ou nas Configurações, "Procurar atualizações" força a checagem.

Publicar uma versão:

1. Numa versão minor, rode antes as conferências do [Fluxo de feature](#fluxo-de-feature).
2. Suba a versão em `Cargo.toml`, `package.json` e `src-tauri/tauri.conf.json`, e rode `npm install` para atualizar o `package-lock.json`.
3. `npm run release:build` — build assinado com a chave privada em `~/.tauri/wipe-cause.key` (ou em `TAURI_SIGNING_PRIVATE_KEY`, se definida; fora do repo; sem ela não dá para publicar atualizações, guarde um backup).
4. `node scripts/release.mjs docs/releases/vX.Y.Z.md` (com as seções `## Português` e `## English`) — gera `target/release/upload/` com o instalador (com a versão no nome e uma cópia `WipeCause_x64-setup.exe`, que é o link de download do README) e o `latest.json`, e mostra o `gh release create` para publicar os três.

</details>

<details>
<summary><b>Prints e clipes do README</b></summary>

Os prints e clipes WebP animados saem de relatórios reais com nomes fictícios de personagens. Ficam em `docs/screenshots/pt/` e `docs/screenshots/en/`, um conjunto por idioma. Use WebP sem perdas para manter os textos da interface nítidos (alguns do guia de uso ainda são PNG); mantenha os clipes curtos e focados em uma mecânica. Não versione logs ou relatórios brutos de `samples/`.

</details>

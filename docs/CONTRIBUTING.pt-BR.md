# Como contribuir

[← Voltar ao README](../README.pt-BR.md)

### Estrutura

| pasta | o quê |
|---|---|
| `crates/wipe-core` | parser do combat log e análise dos pulls (Rust, sem dependência de UI) |
| `src-tauri` | app desktop (Tauri) que expõe o `wipe-core` para a UI |
| `src` | interface (React + TypeScript) |
| `encounters/` | regras por boss (YAML), geradas pela skill `boss-rules` |
| `rotations/` | rotação base por spec (YAML) |
| `data/` | tabelas editáveis: defensivos por classe, consumíveis |
| `docs/screenshots/` | prints e clipes animados do README (`pt/` e `en/`) |

### Desenvolvimento

Pré-requisitos: Node 20+, Rust (rustup) e MSVC Build Tools (Windows).

```bash
npm install
npm run tauri dev
```

Rodar só o analisador, sem UI:

```bash
cargo run -p wipe-core --bin wipe-cli -- analyze caminho/do/WoWCombatLog.txt
```

Para testar o ao vivo sem estar em raid: `node scripts/simulate-live.mjs <log antigo> <pasta Logs>` escreve alguns pulls de um log real, aos poucos, num `WoWCombatLog` novo.

### Textos nas duas línguas

Todo texto novo entra em português e inglês na mesma mudança.

- **Interface:** os textos ficam em dicionários (`*.i18n.ts`, com `defineMessages(pt, en)`); o inglês é tipado contra o português, então faltar uma frase não compila. Um teste falha se aparecer português fora dos dicionários, e outro se o lado inglês de um dicionário tiver português.
- **Regras de boss e rotações (YAML):** dicas, mensagens, títulos e notas são `{ pt: "...", en: "..." }`; os nomes ficam em inglês. O teste do `wipe-core` confere as duas coisas.
- **Notas de versão:** uma seção `## Português` e uma `## English` (o app mostra a do idioma escolhido).

<details>
<summary><b>Atualizar tudo depois de patch, raide nova ou nerf</b></summary>

`npm run refresh` refaz sem IA tudo o que muda com o jogo: baixa a APL do SimulationCraft (e marca as specs em que ela mudou), roda os tops de cada spec pelo motor, ajusta só os números das rotações (metas de uptime e de uso de cooldown pelo quartil de baixo dos tops; id novo da mesma habilidade em `alt_ids`; evento repetido do mesmo botão em `ignore_casts`), gera a referência dos tops por boss e escreve um relatório em `samples/refresh/<data>.md` com cada spec **OK**, **ATENÇÃO** ou **REVISAR**.

- `npm run refresh -- --tops`: baixa os tops antes (credenciais por variável de ambiente, `samples/wcl-credentials.env`, fora do git, ou o cofre do app; com mais de um cliente no arquivo, troca quando os pontos por hora acabam).
- `npm run refresh -- --tops --zone latest --fresh`: raide nova; os chefes vêm da zona mais nova do Warcraft Logs (sem regras escritas) e os tops do raide anterior saem da referência.
- `npm run refresh -- --dry <spec>`: só o relatório, sem mudar nada.

REVISAR é o que muda o que a spec é (habilidade que os tops pararam de usar, habilidade nova, APL nova, checagem que nem os tops cumprem): a skill `rotation-refresh` do Claude Code cuida disso.

</details>

<details>
<summary><b>Gerar a rotação de uma spec</b></summary>

Sem escrever à mão nem usar IA: `scripts/rotation.mjs` monta o YAML a partir da APL e dos dados de spell do SimulationCraft e calibra nos logs dos tops do Warcraft Logs.

1. `node scripts/rotation.mjs tops <spec>`: baixa os 2 melhores parses de cada chefe do raide (sem buffs externos), só com os eventos do player. Usa as variáveis de ambiente `WCL_CLIENT_ID` e `WCL_CLIENT_SECRET`.
2. `node scripts/rotation.mjs calibrate <spec>`: gera o rascunho e o roda nos tops pelo próprio motor do app.
   - **Prioridade:** sai da APL, por árvore de herói, em alvo único e AoE.
   - **Ids:** vêm do que os tops castam.
   - **Números:** cooldown, cargas e cast vêm do dump do SimC (ou do tooltip do Wowhead).
   - **Checagens inferidas:** DoT, pelo `dot.X.refreshable`; proc, pelo `buff.X.react` numa spell que o buff modifica; recurso, pelo custo dos gastos; cooldowns de 20s ou mais.
   - **Calibração pelos tops:** metas de uptime e de uso de cooldown pelo que os tops fazem; abertura, pelo que 70% deles casta nos primeiros segundos; sai o que nem os tops cumprem.
   - **Destino:** escreve em `rotations/`; se já existe uma escrita à mão, vai para `samples/rotation/` para comparar.
3. `node scripts/rotation.mjs check <spec>`: mostra como os tops se saem na rotação atual, para validar uma escrita à mão.

Tipos de checagem: `proc` (buff que precisa ser gasto, carga por carga — ex.: Precise Shots, Demonic Core), `requires_buff` (casts que pedem um buff — ex.: Trick Shots, Demonbolt com Demonic Core), `downtime` (tempo sem castar, só quando a raid estava batendo), `cooldown` (usos vs. possíveis no tempo vivo), `resource_waste` (recurso estourado, ex.: Maelstrom, Astral Power, Soul Shards), `dot_uptime` (DoT no alvo, ex.: Flame Shock), `aoe_swap` (com N+ alvos o cast deveria ser outro, ex.: Chain Lightning) e `after_cast` (cast que precisa vir logo antes ou depois de outro, ex.: Demonic Tyrant com os Dreadstalkers fora).

Os textos saem em modelo ("X perdido: use antes de acabar"): vale revisar os pontos principais antes de publicar.

</details>

<details>
<summary><b>Versões e atualização automática</b></summary>

Versões seguem semver. Cada feature grande é fechada em uma release (`vX.Y.Z`) depois de aprovada.

O app instalado procura versão nova ao abrir (e a cada 6h): lê o `latest.json` da última release do GitHub, baixa o instalador, confere a assinatura e reinstala sozinho. Na barra lateral, "Procurar atualizações" força a checagem.

Publicar uma versão:

1. Suba a versão em `Cargo.toml`, `package.json` e `src-tauri/tauri.conf.json`.
2. `npm run release:build` — build assinado com a chave privada em `~/.tauri/wipe-cause.key` (fora do repo; sem ela não dá para publicar atualizações, guarde um backup).
3. `node scripts/release.mjs notas.md` (com as seções `## Português` e `## English`) — gera `target/release/upload/` com o instalador (com a versão no nome e uma cópia `WipeCause_x64-setup.exe`, que é o link de download deste README) e o `latest.json`, e mostra o `gh release create` para publicar os três.

</details>

<details>
<summary><b>Prints e clipes do README</b></summary>

Os prints e clipes WebP animados saem de relatórios reais com nomes fictícios de personagens. Ficam em `docs/screenshots/pt/` e `docs/screenshots/en/`, um conjunto por idioma. Use WebP sem perdas para manter os textos da interface nítidos; mantenha os clipes curtos e focados em uma mecânica. Não versione logs ou relatórios brutos de `samples/`.

</details>

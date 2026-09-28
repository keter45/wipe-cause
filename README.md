# wipe-cause

Ferramenta local para descobrir **por que a try deu wipe** no World of Warcraft, lendo o `WoWCombatLog.txt` direto da sua máquina — sem depender da API do Warcraft Logs e sem servidor.

## Como funciona

1. Ative o log no jogo: `/combatlog` + *Advanced Combat Logging* nas opções de rede.
2. Abra o arquivo `World of Warcraft\_retail_\Logs\WoWCombatLog-*.txt` no app.
3. Escolha o pull e veja:
   - o **gatilho** do wipe (a falha de mecânica que puxou as mortes) e os erros de mecânica do boss;
   - cada morte: spike ou morte lenta, se faltou cura, debuffs ativos (com stacks e descrição), golpe final, defensivos/poção/healthstone;
   - **interrupts**: casts que passaram, quem cortou, quem tentou e errou, quem podia e não cortou;
   - dano causado/tomado por player.

Wipes com menos de 30s são ignorados.

## Warcraft Logs

Cada pull pode abrir a mesma try no Warcraft Logs. Uma vez: crie um client gratuito em [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients/) e cole o client id/secret na engrenagem do app (fica salvo só na sua máquina). Por noite: cole o link do report na barra do Warcraft Logs — o app casa cada pull com a fight pelo boss e horário de início.

## Regras por boss

Cada boss tem um arquivo em `encounters/<raid>/<boss>.yaml` com as mecânicas (dano evitável, soaks, interrupts, stacks...) e os spell IDs que provam a falha no log. As regras são geradas pela skill `boss-rules` a partir de um guia e calibradas com `wipe-cli spells <log>`.

Para testar ou customizar sem recompilar, coloque `*.yaml` em `%APPDATA%\gg.wipecause.app\encounters` — um arquivo com o mesmo `encounter_id` substitui o embutido.

| boss | raid | status |
|---|---|---|
| The Twin Fangs | The Venomous Abyss | calibrado com log Mítico |

## Estrutura

| pasta | o quê |
|---|---|
| `crates/wipe-core` | parser do combat log e análise dos pulls (Rust, sem dependência de UI) |
| `src-tauri` | app desktop (Tauri) que expõe o `wipe-core` para a UI |
| `src` | interface (React + TypeScript) |
| `encounters/` | regras por boss (YAML), geradas pela skill `boss-rules` |
| `data/` | tabelas editáveis: defensivos por classe, consumíveis |

## Desenvolvimento

Pré-requisitos: Node 20+, Rust (rustup) e MSVC Build Tools (Windows).

```bash
npm install
npm run tauri dev
```

Rodar só o analisador, sem UI:

```bash
cargo run -p wipe-core --bin wipe-cli -- analyze caminho/do/WoWCombatLog.txt
```

## Versionamento

Versões seguem semver. Cada feature grande é fechada em uma release (`vX.Y.Z`) depois de aprovada.

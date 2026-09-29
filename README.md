# wipe-cause

Ferramenta local para descobrir **por que a try deu wipe** no World of Warcraft, lendo o `WoWCombatLog.txt` direto da sua máquina — sem depender da API do Warcraft Logs e sem servidor.

## Como funciona

1. Ative o log no jogo: `/combatlog` + *Advanced Combat Logging* nas opções de rede.
2. No app, escolha o log da noite na lista: ele encontra a pasta `World of Warcraft\_retail_\Logs` sozinho (ou você escolhe a pasta uma vez) e mostra os bosses de cada log.
3. Escolha o pull e veja:
   - o **gatilho** do wipe (a falha de mecânica que puxou as mortes) e os erros de mecânica do boss;
   - cada morte: spike ou morte lenta, se faltou cura, debuffs ativos (com stacks e descrição), golpe final, defensivos/poção/healthstone;
   - **interrupts**: casts que passaram, quem cortou, quem tentou e errou, quem podia e não cortou;
   - dano causado/tomado por player.

Wipes com menos de 30s são ignorados.

**Ignorar após N mortes** (topo da tela, padrão 4): depois de algumas mortes o wipe já está decidido. Erros de mecânica, falhas, interrupts e o gatilho só contam até a N-ésima morte de cada pull; o resto aparece esmaecido. Mudar o N é instantâneo (0 = conta tudo).

## Warcraft Logs

Cole o link do report da noite na barra do Warcraft Logs (fica salvo para aquele arquivo de log). Cada pull ganha um botão que abre o report já filtrado no boss e na dificuldade, com o número da try como o WCL mostra ("Wipe 13") — ele conta também os pulls curtos que o app ignora. Não usa a API do Warcraft Logs nem pede login.

## Warcraft Recorder

Se você grava as lutas com o [Warcraft Recorder](https://warcraftrecorder.com), cadastre a pasta onde ele salva os vídeos (botão 🎥 na barra: colar o caminho ou Procurar…). Ela fica salva no `settings.json` do app, porque varia de PC para PC. Sem cadastro, o app tenta detectar a pasta pela configuração do Recorder (lê só o caminho) e casa cada vídeo com o pull pelo boss e horário de início. No pull aparece o botão **▶ Vídeo** e cada morte, gatilho e evento de mecânica ganha um **▶** que abre o vídeo 5s antes do momento.

Vídeos só na nuvem do Recorder ainda não são suportados (a API da nuvem é privada).

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

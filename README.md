# wipe-cause

Ferramenta para descobrir **por que a try deu wipe** no World of Warcraft. Lê o `WoWCombatLog.txt` direto da sua máquina e, com a sua conta do Warcraft Logs, completa a noite com o que o seu log não pegou — sem servidor próprio.

## Primeiros passos

Na primeira vez, o app abre em **Configurações** com o passo a passo (depois ele fica em *Configurações → Como funciona*):

1. **Pasta de logs do WoW** — encontrada sozinha na maioria dos PCs (`World of Warcraft\_retail_\Logs`).
2. **No jogo** — em *Opções → Rede*, ligue o *Advanced Combat Logging*; antes do primeiro pull, `/combatlog` (ou o uploader do Warcraft Logs, que liga sozinho).
3. **Entrar com o Warcraft Logs** (recomendado) — com a sua conta o app vê os logs da sua guilda, completa o que faltou no seu log, liga o ao vivo sozinho e mostra o parse de cada um. Não precisa criar chave nem client.
4. **Opcional** — ligar o ao vivo quando o WoW abrir (com o app fechado, o jogo abre o Wipe Cause minimizado na bandeja e já ao vivo; um vigia leve, sem janela, inicia com o Windows), vídeos do Warcraft Recorder, Discord e IA.

## Como funciona

1. **Nova análise** mostra uma linha por noite: os logs do seu PC e os reports da guilda no Warcraft Logs, juntos. **Analisar** usa o log do seu PC (rápido, sem baixar nada).
2. Bosses e pulls que **não estão no seu log** mas estão no Warcraft Logs (você saiu antes, entrou depois, estava longe) aparecem com o ícone de download. **Completar** baixa só o que falta — demora alguns minutos, então é você quem decide; depois do primeiro download, reabrir é rápido. Masmorras (M+) ficam de fora.
3. Escolha o pull e veja:
   - o **gatilho** do wipe (a falha de mecânica que puxou as mortes) e os erros de mecânica do boss;
   - cada morte: spike ou morte lenta, se faltou cura, debuffs ativos (com stacks e descrição), golpe final, defensivos/poção/healthstone;
   - **interrupts**: casts que passaram, quem cortou, quem tentou e errou, quem podia e não cortou;
   - dano causado/tomado por player.

Wipes com menos de 30s são ignorados.

## Ajustar as regras do boss

Cada raid tem sua estratégia, então as regras dos bosses podem ser ajustadas sem mexer em arquivo:

- **Ajustar regras deste boss** (aba Mecânicas): ligar/desligar cada mecânica, mudar a gravidade, quantos hits por player são tolerados, com quantos stacks avisar, o tempo máximo até o dispel, quem pode ser culpado e os textos de dica e mensagem. Só o que muda em relação ao padrão é salvo, então os ajustes continuam valendo quando o app atualiza as regras. Tem "voltar ao padrão" por mecânica e de tudo.
- **Foco da progressão (★)**: as mecânicas que estão segurando a progressão entram no veredito mesmo quando leves, vêm primeiro e pesam 1,5× na nota.
- **Criar regra** (aba Habilidades do boss): para algo que as regras não pegam, escolha em linguagem simples o que aquela habilidade significa ("tomar isso é erro", "tem que ser cortado", "stack que mata"…); o ID vem do log e a prévia mostra o que ela marcaria no pull.
- **Marcar erro**: para o que o log não prova (posição, bait, escala), marque no pull quem errou e o quê — ou "essa morte foi erro do player" no detalhe da morte. Entra no veredito, na nota e no contexto da IA.
- **Exportar / Importar**: mande os ajustes de um boss para os officers usarem a mesma configuração.

Salvar reanalisa o log aberto. Os ajustes ficam em `rule-tuning/<encounter>.json` na pasta de dados do app (`wipe-cli analyze <log> --tuning <pasta>` também aplica).

## Configurações

Tudo o que o app precisa fica em **Configurações** (rodapé da barra lateral), cada item com o status (pronto, falta configurar, desligado):

- **Essencial:** a pasta de logs do WoW (detectada sozinha na maioria dos PCs) e o combat log no jogo (`/combatlog` + Advanced Combat Logging — o app avisa se o log aberto veio sem ele).
- **Análise:** o corte de mortes padrão para logs novos.
- **Integrações opcionais:** Warcraft Logs (entrar com a conta; um client próprio da API fica como opção avançada), pasta de vídeos do Warcraft Recorder, webhook do Discord e o provedor do "Perguntar à IA".
- **Sobre:** versão, atualizações e a pasta das regras de boss.

Quando um recurso depende de uma integração que ainda não foi ligada, ele mostra um atalho que abre a seção certa.

**Ignorar após N mortes** (topo da tela para o log aberto; o padrão, 4, fica em Configurações): depois de algumas mortes o wipe já está decidido. Erros de mecânica, falhas, interrupts e o gatilho só contam até a N-ésima morte de cada pull; o resto aparece esmaecido. Mudar o N é instantâneo (0 = conta tudo).

## Modo ao vivo e Discord

Com **Ao vivo** ligado (no topo), o app acompanha o `WoWCombatLog` mais recente da pasta de logs. Sem o WoW aberto neste PC e com a conta do Warcraft Logs, ele segue o log ao vivo da guilda (alguém precisa estar com o *Live Logging* do uploader ligado); com a opção *Ligar o ao vivo sozinho* (Configurações → Warcraft Logs), ele liga assim que a guilda começa a raid. Quando um pull termina, ele reanalisa o log em alguns segundos, abre o pull novo e mostra uma notificação — dá para ver o motivo do wipe antes do próximo pull.

Fechar a janela deixa o app na bandeja (perto do relógio), com o ao vivo rodando; clique no ícone para voltar e use **Sair** no menu do ícone para fechar de vez.

O aviso do pull tem um campo para anotar o motivo do wipe na hora, do jeito que a raid percebeu (ele não some enquanto você escreve). A anotação fica salva no PC, aparece no topo do pull (onde dá para editar depois), marca o pull na lista, vai no cartão de compartilhar e entra no contexto do "Perguntar à IA".

Em **Configurações → Discord**, cole o webhook do canal da raid. No modo ao vivo, tudo chega como imagem (o mesmo cartão do *Compartilhar*): em cada wipe, o motivo do wipe; em cada kill, o resumo do boss; e no fim da raid (ao vivo desligado ou 30 min sem pull novo), o resumo da noite. O pull, o resumo do boss e o resumo da noite também enviam na hora pelo *Compartilhar* (imagem ou mensagem).

Para testar sem estar em raid: `node scripts/simulate-live.mjs <log antigo> <pasta Logs>` escreve alguns pulls de um log real, aos poucos, num `WoWCombatLog` novo.

## Perguntar à IA

Cada pull tem a aba **Perguntar à IA**: a IA recebe um dossiê do pull (mecânicas do boss com as dicas das regras, veredito, mortes com recap resumido, defensivos, posições, escala de interrupts, dispels, notas e um resumo dos outros pulls da noite — ~3–5 mil tokens) e responde só com base nele. Dá para ver o dossiê em **Ver dossiê**.

Funciona com qualquer provedor no formato de chat da OpenAI, com presets para opções gratuitas: **Google Gemini** e **Groq** (planos gratuitos sem cartão), **OpenRouter** (modelos `:free`) e **Ollama** (roda no seu PC, grátis e offline), escolhidos em **Configurações → Perguntar à IA**. A chave de API fica no Gerenciador de Credenciais do Windows. Nos planos gratuitos, o provedor pode usar as perguntas para treinar modelos — o dossiê inclui os nomes dos players.

## Compartilhar

O pull e o resumo do boss têm **Compartilhar**: gera um cartão com o resumo (resultado, gatilho, o que deu errado, mortes decisivas, notas mais baixas e o mapa da falha) para **copiar como imagem** e colar no Discord/WhatsApp, **salvar como PNG ou HTML** ou **enviar a imagem ao Discord** pelo webhook configurado.

## Nota por player

Cada player recebe uma nota de 0 a 100 por pull: parte de 100, perde pontos por erros de mecânica (pela gravidade da regra, até 3 por mecânica), por deixar passar a própria vez na escala de interrupts e por morte decisiva (mais se tinha defensivo sobrando); no fim pesa o tempo vivo até a primeira morte. Morte em **wipe geral** (mais de 5 mortes em até 1,5s — explosão, Execution, enrage) não conta: é consequência do wipe, e a culpa fica com a mecânica e quem a causou. Aparece na aba Jogadores (passe o mouse para ver os descontos), como média no placar do boss e por noite na Evolução.

## Desempenho

A aba **Desempenho** de cada pull compara um player com os **top players da mesma spec no Warcraft Logs**, com item level parecido (e tempo de kill parecido, se o pull foi kill). Na progressão não há tempo de kill: o fight do top é recortado no mesmo tempo que o player ficou vivo, então um wipe de 2:30 é comparado com os 2:30 iniciais do kill (sem o execute e sem as fases que o wipe não viu).

- **Janelas de burst**: marque os cooldowns que quer comparar (os de dano da classe vêm marcados); cada uso vira um chip e mostra os casts de 3s antes a 20s depois numa linha do tempo, lado a lado com o mesmo uso do top.
- **Cooldowns**: quando cada um foi usado, quantas vezes e se o 1º uso veio atrasado ou adiantado.
- **Rotação**: casts por minuto e % do dano de cada habilidade, apontando o que ficou abaixo ou não foi usado.
- **Setup**: poção de combate, distribuição de status, talentos diferentes (com nome e ícone) e itens lado a lado, com encantamentos e gemas que faltam.
- **Exportar**: o relatório do jogador vira um cartão para copiar, salvar (PNG/HTML) ou mandar ao Discord — para quem não tem o app.

Para usar os tops, crie um client grátis em [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients/) e cole o client ID e o secret na aba (ficam no Gerenciador de Credenciais do Windows). As consultas enviam só boss, spec e códigos de report; as respostas ficam em cache. A comparação com a própria raid (outro da mesma spec, ou você mesmo em outra tentativa) fica na aba **Na própria raid**. Se o link do report da noite estiver cadastrado, o pull também ganha links para o seu fight no Warcraft Logs e no WoWAnalyzer.

## Modo solo

No topo, **Guilda / Solo** troca o foco do app. No modo guilda, a pergunta é por que a raid wipou. No solo, é como **você** pode melhorar. "Você" é quem gravou o log (o combat log marca o próprio personagem; se trocar de personagem no meio, cada pull fica certo). Na análise do Warcraft Logs, ou se quiser outro personagem, escolha na própria tela; o app lembra da escolha.

- **Pull → aba Você**: suas métricas, a sua sobrevivência e os seus erros de mecânica, em quatro partes.
  - **Para o próximo pull:** os seus erros ordenados pelo que custaram. Morte cedo, tempo parado, proc perdido e DoT fora do alvo viram uma estimativa de dano; mecânica e cooldown entram com peso pela gravidade. Cada um traz o momento (▶ no vídeo) e a dica.
  - **Onde a referência abriu vantagem:** o seu dano a cada 5s contra uma referência, que pode ser o top do Warcraft Logs, o melhor da raid ou o seu melhor pull da noite (só referências que ficaram vivas pelo menos 60% do seu tempo). Os 3 trechos de maior diferença vêm com os casts de cada um lado a lado e o que a referência usou a mais.
  - **Mecânicas:** só as suas (falhas nas regras do boss, mortes com o golpe final e o defensivo que estava disponível) e o dano que você tomou bem mais que a referência por minuto vivo, que costuma ser dano evitável.
  - **Rotação:** a leitura da rotação base da spec.
- **Resumo da noite e do boss**: os seus pulls boss a boss, o melhor de cada um e os erros que se repetem.
- **Evolução**: um boss ao longo das noites salvas: o seu melhor output, a rotação, as mortes e os erros de mecânica por pull.

## Rotação

Cada spec pode ter a **rotação base escrita** em `rotations/<classe>-<spec>.yaml` (pontos principais, prioridade por árvore de herói em alvo único e AoE, abertura e checagens), feita a partir do guia de rotação do Wowhead e da APL do SimulationCraft do patch. Na aba **Desempenho**, o log do player é lido contra ela: aproveitamento (0–100), os erros claros e os ajustes, com o momento de cada um (▶ no vídeo), a abertura e o uso dos cooldowns.

Tipos de checagem: `proc` (buff que precisa ser gasto, carga por carga — ex.: Precise Shots, Demonic Core), `requires_buff` (casts que pedem um buff, em AoE ou sempre — ex.: Trick Shots só para quem tem o talento, Demonbolt com Demonic Core), `downtime` (tempo sem castar, só quando a raid estava batendo: intermissões não contam), `cooldown` (usos vs. possíveis no tempo vivo; talentos opcionais só contam se usados), `resource_waste` (recurso estourado, ex.: Maelstrom, Astral Power, Soul Shards; pode contar só os geradores castados, fora os procs automáticos), `dot_uptime` (DoT no alvo, ex.: Flame Shock), `aoe_swap` (com N+ alvos o cast deveria ser outro, ex.: Chain Lightning) e `after_cast` (cast que precisa vir logo antes ou depois de outro, ex.: Demonic Tyrant com os Dreadstalkers fora, Vanish seguido de Garrote).

Specs com rotação: **Marksmanship Hunter**, **Elemental Shaman**, **Balance Druid**, **Demonology Warlock**, **Arcane Mage**, **Havoc Demon Hunter**, **Assassination Rogue**, **Retribution Paladin**, **Arms Warrior**, **Shadow Priest**, **Unholy Death Knight**, **Devourer Demon Hunter**, **Destruction Warlock**, **Devastation Evoker**, **Beast Mastery Hunter** e **Affliction Warlock**.

### Gerar a rotação de uma spec

Sem escrever à mão nem usar IA: `scripts/rotation.mjs` monta o YAML a partir da APL e dos dados de spell do SimulationCraft e calibra nos logs dos tops do Warcraft Logs.

1. `node scripts/rotation.mjs tops <spec>`: baixa os 2 melhores parses de cada chefe do raide (sem buffs externos), só com os eventos do player. Usa as variáveis de ambiente `WCL_CLIENT_ID` e `WCL_CLIENT_SECRET`.
2. `node scripts/rotation.mjs calibrate <spec>`: gera o rascunho e o roda nos tops pelo próprio motor do app.
   - **Prioridade:** sai da APL, por árvore de herói, em alvo único e AoE.
   - **Ids:** vêm do que os tops castam.
   - **Números:** cooldown, cargas e cast vêm do dump do SimC (ou do tooltip do Wowhead).
   - **Checagens inferidas:**
     - DoT, pelo `dot.X.refreshable`;
     - proc, pelo `buff.X.react` numa spell que o buff modifica;
     - recurso, pelo custo dos gastos;
     - cooldowns de 20s ou mais.
   - **Calibração pelos tops:**
     - metas de uptime e de uso de cooldown pelo que os tops fazem;
     - abertura: o que 70% deles casta nos primeiros segundos;
     - sai o que nem os tops cumprem (proc gasto por outra coisa, buff de janela, cooldown que não se usa no cooldown, recurso que eles também estouram).
   - **Destino:** escreve em `rotations/`; se já existe uma escrita à mão, vai para `samples/rotation/` para comparar.
3. `node scripts/rotation.mjs check <spec>`: mostra como os tops se saem na rotação atual, para validar uma escrita à mão.

Os textos saem em modelo ("X perdido: use antes de acabar"): vale revisar os pontos principais antes de publicar.

## Escala de interrupts e dispels

Na aba **Interrupts**, cole a nota do MRT/NSRT (ou escreva `Cast: Fulano, Ciclano, Beltrano`, uma linha por add): o app confere cast a cast de quem era a vez, quem cortou, quem cobriu e em que vez o cast passou — e o veredito do pull e o Discord passam a apontar quem deixou passar. Regras do tipo `dispel` medem o tempo até o dispel de cada debuff e quem ficou sem.

## Posições

Com Advanced Combat Logging, cada morte (antes do corte) guarda onde todo mundo estava: o detalhe da morte mostra um mini mapa, a distância até o boss e quem estava a menos de 8 jardas. As falhas coletivas de mecânica (ex.: detonação do orb roxo, Execution da Guillotine) também guardam a foto do momento, com quem carregava o orb destacado.

## Evolução

Na barra lateral, **Evolução** compara todas as noites salvas de um boss: melhor pull por noite, a % dos wipes em que cada mecânica foi o gatilho (dá para ver se o erro está diminuindo) e, por player, mortes por pull em cada noite, o que mais o mata e quantas dessas mortes tinham defensivo sobrando.

## Warcraft Logs

Com a conta do Warcraft Logs, os reports da sua guilda (inclusive os não listados) aparecem em **Nova análise**, junto dos logs do PC; um link de fora da lista pode ser colado no fim da tela. O que estiver num log do seu PC sai dele; do Warcraft Logs só se baixa o que falta (os eventos baixados ficam no disco, para reanalisar sem gastar a API). Várias pessoas subiram a mesma noite? Os reports viram uma análise só, com uma cópia de cada pull.

Cole o link do report da noite na barra do Warcraft Logs (fica salvo para aquele arquivo de log). Cada pull ganha um botão que abre o report já filtrado no boss e na dificuldade, com o número da try como o WCL mostra ("Wipe 13") — ele conta também os pulls curtos que o app ignora. Isso não usa a API nem pede login; a API (com client próprio) só entra na aba Desempenho.

## Warcraft Recorder

Se você grava as lutas com o [Warcraft Recorder](https://warcraftrecorder.com), cadastre a pasta onde ele salva os vídeos (**Configurações → Vídeos do Warcraft Recorder**, ou o botão **Vídeos** no topo: colar o caminho ou Procurar…). Ela fica salva no `settings.json` do app, porque varia de PC para PC. Sem cadastro, o app tenta detectar a pasta pela configuração do Recorder (lê só o caminho) e casa cada vídeo com o pull pelo boss e horário de início. No pull aparece o botão **▶ Vídeo** e cada morte, gatilho e evento de mecânica ganha um **▶** que abre o vídeo 5s antes do momento.

Vídeos só na nuvem do Recorder ainda não são suportados (a API da nuvem é privada).


**Vídeos da guilda (nuvem do Recorder):** em *Configurações → Vídeos*, entre com a conta da nuvem do Warcraft Recorder. Os vídeos que a guilda sobe viram outros pontos de vista de cada pull: no player, troque de POV e o vídeo continua no mesmo segundo.
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

## Atualização automática

O app instalado procura versão nova ao abrir (e a cada 6h): lê o `latest.json` da última release do GitHub, baixa o instalador, confere a assinatura e reinstala sozinho. Na barra lateral, "Procurar atualizações" força a checagem.

Publicar uma versão:

1. Suba a versão em `Cargo.toml`, `package.json` e `src-tauri/tauri.conf.json`.
2. `npm run release:build` — build assinado com a chave privada em `~/.tauri/wipe-cause.key` (fora do repo; sem ela não dá para publicar atualizações, guarde um backup).
3. `node scripts/release.mjs notas.md` — gera `target/release/upload/` com o instalador e o `latest.json` e mostra o `gh release create` para publicar os dois.

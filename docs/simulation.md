# Comparar com o robô (SimulationCraft) — regras

Como o wipe-cause simula um personagem da noite com o SimulationCraft e compara a rotação real com a
do robô (no app desde a v0.36). Decisões do usuário em 2026-10-20; o que está marcado *(decidido por nós)*
foi deixado para o projeto decidir.

Os textos que aparecem no app seguem a regra de sempre: pt-BR e inglês na mesma mudança, com nomes de
spells e bosses em inglês.

## 1. Por que

A aba Desempenho compara o player com os top logs. Os tops jogam com outro equipamento, outra raid e
outra luta, e boa parte da diferença não é rotação. O robô roda **com o equipamento, os talentos, os
buffs e a duração daquele pull**, então o que sobra de diferença é decisão do player.

Não existe API pública do Raidbots para criar sims (verificado em 2026-10-20). O SimulationCraft roda
dentro do app, sem o usuário abrir outro programa.

## 2. Quem e quando

- Qualquer usuário pode simular **qualquer DPS ou tank** que aparece no Desempenho, com um clique.
  Healer não tem o botão (o SimC não simula cura de forma útil). Para tank, compara só a rotação de
  dano; dano tomado e mitigação ficam fora.
- **Só no app.** Na versão web o botão aparece apagado, com tooltip explicando que a simulação roda
  só no app para Windows.
- A simulação fica **salva no computador de quem clicou** (pasta de dados do app), por
  personagem + boss + dificuldade + noite. Só é refeita quando alguém pede de novo.
  *(decidido por nós)* Se o SimC instalado é de um commit diferente do usado na simulação, a
  simulação salva continua aparecendo, com o aviso "Feita com uma versão antiga do SimulationCraft" e o botão de refazer.

## 3. Que pull simular

Sempre um pull **do mesmo dia** (mesma noite, mesmo boss, mesma dificuldade). Entre eles:

1. A **kill**. Se o player morreu nela, a janela vai até a morte (e a ficha avisa "com morte").
2. Sem kill, o pull **mais longo** em que o player **não morreu**. Erro de mecânica não tira o pull
   da lista: o robô não faz mecânica de qualquer jeito.
3. Sem nenhum assim, o de **maior tempo vivo**, com o aviso de que a simulação vai até a morte.

A janela simulada vai do pull até a morte do player, a call de wipe ou o fim da luta (o que vier
primeiro), igual ao corte que a análise já faz.

## 4. Como montar o perfil do SimC

Tudo sai do log daquele pull, nada é pedido ao player. Código em `src/lib/simProfile.ts`; o núcleo
guarda o que falta em `PlayerStats` (`setup.items[].bonusIds`, `setup.faction`, `setup.auras`,
`buffsReceived`).

- **Personagem:** classe e spec no formato do SimC (`demonhunter`, `beast_mastery`), nível 90,
  itens com `bonus_id` (crafted, sockets, faixa de upgrade), encantamento, gemas e `ilevel`. Camisa e
  tabardo ficam de fora.
- **Raça:** o log não traz. Sai da racial usada no pull (Berserking → troll, Blood Fury → orc…);
  Evoker é Dracthyr; sem racial, humano (Aliança) ou orc (Horda) pela facção do `COMBATANT_INFO`, e a
  tela avisa que a raça foi deduzida.
- **Talentos:** cada entrada do `COMBATANT_INFO` vai na opção da sua árvore (`class_talents`,
  `spec_talents`, `hero_talents`, como `id_da_entrada:rank`). A árvore de cada entrada vem do
  `talents.json` do Raidbots que o app já usa. A escolha da árvore de herói (nó de subárvore) fica de
  fora: o SimC a deduz dos nós de herói.
- **Consumíveis:** pelas auras do início do pull. Com os nomes (Warcraft Logs), o que o player **não**
  tinha vira `flask=disabled`, `food=disabled`, `augmentation=disabled`; o que tinha fica com o padrão
  da spec no SimC (não mapeamos qual frasco/comida exato). Log local só traz ids: frascos e comidas
  conhecidos contam; sem como saber, fica o padrão e a tela avisa. Poção e óleo de arma: padrão do
  SimC.
- **Buffs de raid:** `optimal_raid=0` e cada `override.*` ligado só se a classe que dá o buff estava
  no pull (Mage → Arcane Intellect, Warrior → Battle Shout, Druid, Priest, Shaman, Evoker, DH → Chaos
  Brand, Monk → Mystic Touch, Hunter → Hunter's Mark). Mortal Wounds e sangramento sempre ligados.
- **Buffs de fora:** o primeiro Bloodlust (ou tambor, pelo Sated/Exhaustion) no mesmo segundo
  (`bloodlust_time`); Power Infusion em todos os momentos em que chegou
  (`external_buffs.power_infusion`). Buffs de Augmentation não têm opção no SimC.
- **Luta:** `max_time` = a janela, `vary_combat_length=0`, `fixed_time=1`. **Sem `fight_style`**: o
  padrão já é Patchwerk e a opção apaga os `raid_events`.
- **Vida e execute:** *(decidido em 2026-10-21)* o SimC leva a vida em linha reta de 100% até
  `enemy_death_pct`, e a luta tem uma barra por fase. O núcleo guarda a vida do alvo da vez a cada 5s
  (`bossHpTimeline`: a vida da fase pela regra do boss, P1 = Zul'jan, P2 = Malacrass, P3 = os dois;
  sem `phases` na regra, o boss vivo mais baixo). O fim da reta é o que deixa o robô abaixo de 20% e
  de 35% o mesmo tempo que a luta deixou (somando as fases); entre os que empatam, o mais perto da
  vida real no fim. Análises antigas: reta até a vida do boss principal no corte.
- **Alvos:** quantos inimigos havia para acertar a cada 2s = quantil 75% dos DPS do pull (a mediana
  some com os packs de adds, porque metade da raid fica no boss), suavizado em 6s. Trechos de 6s ou
  mais com 2+ alvos viram `adds`; sem alvo, `invulnerable`.
- **Movimento:** o que **a luta pediu**, não o do player (o player da guilda costuma se mover mais
  do que precisa). *(decidido em 2026-10-21)* O núcleo mede o tempo andando de cada player a cada 5s
  (`moveTimeline`: distância entre as posições do log ÷ 7 jardas/s, sem contar trechos de mais de 3s
  sem posição). A cada 30s da janela, entre os DPS vivos o trecho inteiro (3 ou mais), vale o
  **quartil de baixo** (o quanto andaram os que menos andaram), arredondado a 5% e no máximo 60%;
  a sobra do fim com menos de 15s vai junto com o último trecho. Cada trecho vira um evento
  `movement` com `first`/`last`, deslocamentos de 1,5s e `cooldown` = 1,5s ÷ a parte do tempo
  andando. Análises antigas (sem `moveTimeline`) ficam com o *LightMovement* do SimC, e a ficha
  avisa.
  Medido em 2026-10-21 no Coiled Altar Mythic (pull 15, 5:14): trechos de 15% a 35%; o padrão do
  SimC dá ~5%. O robô caiu 2–18% conforme a spec, e a mediana dos DPS foi de 86% para 94% do
  potencial (de 83% a 108%). Nos bosses heroicos da mesma noite, o quartil de baixo ficou entre 15%
  e 34% da luta.
  Conferido com o `sim:check` (Coiled Altar Mythic, 20/10, corte em 4 mortes; com o Feign Death
  fora das mortes, o pull 15 vai até 6:36, entrando no intermission e na P3): a reta antiga ia até
  36% (sem execute), e a luta ficou 90s abaixo de 20% e 140s abaixo de 35% somando P1 e P2. Com a
  vida por fase, a reta vai a 0%, e a mediana dos DPS foi de 108% para 104% do robô (Balance
  136% → 116%, Affliction 125% → 119%, Destruction 120% → 111%). Ainda acima de 110%: specs de DoT e
  cleave (Affliction, Balance, Havoc, Subtlety, Arcane, Destruction), provavelmente o modelo de
  adds (os Manifestation of Dread viram "2 alvos").

**Conferido em 2026-10-20** com uma noite de Mythic (19 players, SimC 1210-01): todos os perfis rodam.
DPS real ÷ robô: mediana 98%, a maioria entre 76% e 110%. Fora disso:

- Thigaz (Balance) 167%, Divo (Ret) 135%, Zerokis (Elemental) 132% no Nymrissa Wavecaller: packs de
  até 19 adds curtos; o robô de AoE fica abaixo. Calibrar o modelo de adds por boss.
- Tanks variam muito (35%–217%): o dano do tank depende de pegar os adds. O número do tank é só
  contexto; a comparação dele é de rotação.

### Configurar a simulação de um boss (processo)

É um processo do app, como cadastrar um boss (`boss-rules`) e manter a rotação (`npm run refresh` +
`rotation-refresh`). `npm run sim:check -- <log> --boss "<nome>" --difficulty Mythic`
(`scripts/sim-check.mjs`) simula a raide toda com o próprio código do app (`simProfile.ts`,
empacotado na hora), com o mesmo corte de mortes do app (4) e 1000 iterações, e escreve
`samples/sim/<data>-<boss>.md`: OK / ATENÇÃO / REVISAR, a tabela real × robô por player e o modelo da
luta que o robô jogou (fases, vida e execute, Bloodlust, movimento por trecho, alvos). REVISAR:
mediana dos DPS fora de 85–105%, DPS acima de 110%, perfil que o SimC não roda, perfil sem o
movimento medido. A skill `sim-calibrate` resolve cada item (onde corrigir: a medida no núcleo, as
fases na regra do boss, ou uma constante do modelo, que muda todos os bosses).

Falta: talentos *omnium* (12.0.7, `omnium_talents` no SimC): ainda não vimos onde aparecem no log; hoje ficam de fora.

## 5. O que comparar (mix de números e decisões)

**Na tela (feito em 2026-10-20):** a opção *Robô (SimulationCraft)* em "Comparar com" (não aparece
para healer). Um clique simula: 1000 iterações dão as médias (DPS, dano por habilidade, dano a cada
5s) e 20 iterações avulsas (`seed=1…20`) dão sequências de casts, das quais fica a de DPS mais perto da
média. O resultado vira um `Sample` (o mesmo pull, com um player "SimulationCraft"), e as seções da
comparação com os tops (KPIs, diferenças principais, onde abriu vantagem, bursts, cooldowns, casts
por habilidade, poção) comparam com ele. Fica salvo em `<dados>/simc/saved/` por player + boss +
dificuldade + noite (`src/lib/botSim.ts`). O perfil usado aparece no fim, para conferir ou colar no
Raidbots. Em dev no navegador: `WIPE_DEV_SIMC_EXE` (config `ui-simc`) faz o vite rodar um simc local.


**A) Números agregados**, com várias iterações (≈1000): DPS, casts por minuto de cada skill, atraso
médio dos cooldowns, procs desperdiçados, tempo com cada buff, tempo parado. Mesma tela da comparação
com os tops, com o robô no lugar deles.

**B) Decisões**, com o log de ações do robô em várias seeds: para cada situação que a rotação da spec
considera (proc ativo, recurso, cooldown pronto, alvos), o que o robô escolhe e com que frequência.
Depois, cada cast do player é checado no estado real dele (buffs, recursos e recargas lidos do log).
Erro só quando o robô quase nunca faria aquilo naquele estado: "aos 1:42 você usou Y com o proc Z
ativo; o robô usa X em 95% das vezes". É a mesma ideia das *decisões da rotação* (tops X→Y × você
X→Z), com o robô como referência.

**Decisões (feito em 2026-10-20, `src/lib/botDecisions.ts`):** as 20 lutas avulsas do robô (`seed=1…20`)
trazem, em cada cast, os buffs ativos. Elas viram 20 "pulls de referência" no formato das decisões
dos tops (`decisions.ts`): quem gasta cada proc, quanto se perde, cooldown usado na hora ou
alinhado, com a faixa (mediana/p90) das 20 lutas. O pull do player é comparado com essa faixa
(`compareDecisions`, os mesmos limites dos tops). E cast a cast: com cada proc ativo, a
distribuição do que o robô casta; o cast do player que o robô faz em menos de 5% das vezes, quando
ele tem uma escolha clara (≥ 50%) e com 30+ casts de amostra, aparece com os momentos (duas vezes ou
mais). Só os buffs que o motor acompanha no player entram; ids do SimC que não batem com o log
são casados pelo nome. Precisa da leitura de rotação da spec (`rotations/*.yaml`).

Conferido na noite de Mythic: Portallus (Demonology) com Ruination ativo castou Shadow Bolt 6×, o robô
usa Ruination 81%; Antithesis (MM) perdeu 39% dos Precise Shots (robô 0%).

**Tela (2026-10-20, v0.36):** a ficha "O que o robô jogou" (`BotParts.tsx`) é lida do perfil salvo
(`simFacts` em `src/lib/botView.ts`): chips do pull e do SimC, linha do tempo (Bloodlust, PI, adds,
tempo sem alvo, movimento da luta, vida do boss) e consumíveis/buffs da raide/personagem em verde
(tinha), vermelho (não tinha) e cinza (padrão do SimC). O DPS vira "% do potencial" com a faixa das
1000 lutas. As decisões viram cartões você × robô, e as 3 de maior custo estimado ficam em "O que
mudar primeiro" (`fixes`: casts trocados × diferença de dano por cast; procs perdidos × dano de quem
gasta; usos perdidos de cooldown × dano dele). "Robô para a raide" no resumo do boss simula todos em
fila (`botRaid.ts`); a aba Jogadores e a Evolução mostram o % de quem tem simulação salva. O pull
simulado é achado pelo começo (até 10s de diferença: o log local e o Warcraft Logs diferem em ms).

**Robô × tops:** nesta seção o robô é o certo. Quando os tops (ou a nossa rotação em YAML) fazem
diferente, mostramos uma nota ao lado (ex.: "Os top logs também usam X aqui."), e o player decide.
Feito assim: cada achado olha a referência dos tops da spec (`decisionRefFor`) e ganha uma nota quando
os tops gastam o proc com o que o player usou, também deixam o proc acabar, seguram o cooldown ou
não alinham com aquilo. E a seção "Onde os top logs fazem diferente do robô" lista, independente do
player, quem gasta cada proc, tempo segurado (diferença de 3s+) e alinhamentos que só um dos dois tem.

## 6. De onde vem o SimC *(decidido por nós)*

Os downloads oficiais do SimC só funcionam por HTTP, sem HTTPS nem assinatura. Para não baixar
binário sem como conferir:

- Um workflow do GitHub Actions compila o SimC (só a linha de comando) a partir do branch padrão
  do projeto, toda semana e quando chamado à mão, e publica num release próprio com o SHA-256 e o
  commit de origem.
- O app baixa o SimC **na primeira simulação** (com aviso do tamanho: ~15 MB compactado), confere o SHA-256 e guarda na pasta de dados (`<dados>/simc/`). Antes de uma simulação, no máximo a cada 6 h, confere o manifesto e baixa o build novo; sem internet, ou se o download falha, segue com o SimC instalado.
  O instalador não cresce e o SimC acompanha o patch sem release nosso.
- O SimC é GPL-3; ele roda como programa separado. Mostramos a versão e o link do código-fonte do
  commit usado na tela da simulação.

- Roda sem janela, com prioridade abaixo do normal e deixando um núcleo livre; uma simulação por vez.
  Medido em 2026-10-20: 1000 iterações de 5 min de luta em ~1 s; o log de ações de uma iteração
  tem ~1,5 MB.
- Para testar com um simc local: `WIPE_SIMC_EXE=… WIPE_SIMC_PROFILE=… cargo test -p wipe-cause-app
  simc -- --ignored`.

## 7. Limites que o player precisa saber

- O robô não erra mecânica e anda só o que a luta pediu; a diferença de DPS nunca é só rotação.
- O SimC às vezes está atrasado em relação a um patch novo, e a spec pode estar sem rotação boa
  nele. Nesse caso mostramos o aviso do próprio SimC sobre a spec.

# Comparar com o robô (SimulationCraft) — regras

Rascunho de como o wipe-cause vai simular um personagem da noite com o SimulationCraft e comparar a
rotação real com a do robô. Decisões do usuário em 2026-10-20; o que está marcado *(decidido por nós)*
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
  *(decidido por nós)* Se a versão do SimC ou o patch do jogo mudaram desde então, a simulação salva
  continua aparecendo, com o aviso "feita com uma versão antiga do SimC" e o botão de refazer.

## 3. Que pull simular

Sempre um pull **do mesmo dia** (mesma noite, mesmo boss, mesma dificuldade). Entre eles:

1. Os pulls em que o player **ficou vivo do começo ao fim** e **não tem erro de mecânica** na nossa
   análise. Desses, o **mais longo**.
2. *(decidido por nós)* Se nenhum pull é limpo, usa o de maior tempo vivo e mostra o aviso
   "nenhum pull sem morte ou erro de mecânica; usamos o de X:XX".

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
- **Luta:** `max_time` = a janela, `vary_combat_length=0`, `fixed_time=1`. O HP do boss no fim da
  janela é estimado em linha reta entre 100% e o HP no corte (`enemy_death_pct`): num wipe a 40% o
  robô não chega na fase de execute. **Sem `fight_style`**: o padrão já é Patchwerk e a opção apaga os
  `raid_events`.
- **Alvos:** quantos inimigos havia para acertar a cada 2s = quantil 75% dos DPS do pull (a mediana
  some com os packs de adds, porque metade da raid fica no boss), suavizado em 6s. Trechos de 6s ou
  mais com 2+ alvos viram `adds`; sem alvo, `invulnerable`.
- **Movimento:** **padrão**, não o do player (o player da guilda costuma se mover mais do que
  precisa): o mesmo evento do estilo *LightMovement* do SimC, para todos os papéis; depois dá para
  trocar por um padrão por boss.

**Conferido em 2026-10-20** com uma noite de Mythic (19 players, SimC 1210-01): todos os perfis rodam.
DPS real ÷ robô: mediana 98%, a maioria entre 76% e 110%. Fora disso:

- Thigaz (Balance) 167%, Divo (Ret) 135%, Zerokis (Elemental) 132% no Nymrissa Wavecaller: packs de
  até 19 adds curtos; o robô de AoE fica abaixo. Calibrar o modelo de adds por boss.
- Tanks variam muito (35%–217%): o dano do tank depende de pegar os adds. O número do tank é só
  contexto; a comparação dele é de rotação.

Falta: talentos *omnium* (12.0.7, `omnium_talents` no SimC): ainda não vimos onde aparecem no log; hoje ficam de fora.

## 5. O que comparar (mix de números e decisões)

**Na tela (feito em 2026-10-20):** a opção *Robô (SimulationCraft)* em "Comparar com" (não aparece
para healer). Um clique simula: 1000 iterações dão as médias (DPS, dano por habilidade, dano a cada
5s) e 5 iterações avulsas (`seed=1…5`) dão sequências de casts, das quais fica a de DPS mais perto da
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

**Robô × tops:** nesta seção o robô é o certo. Quando os tops (ou a nossa rotação em YAML) fazem
diferente, mostramos um aviso ao lado: "os top logs fazem outra coisa: …", e o player decide.
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
- O app baixa o SimC **na primeira simulação** (com aviso do tamanho: ~15 MB compactado, ~120 MB
  instalado), confere o SHA-256 e guarda na pasta de dados (`<dados>/simc/`). A cada simulação, se o manifesto aponta versão nova, baixa antes de rodar.
  O instalador não cresce e o SimC acompanha o patch sem release nosso.
- O SimC é GPL-3; ele roda como programa separado. Mostramos a versão, o commit e o link do código
  na tela da simulação.

- Roda sem janela, com prioridade abaixo do normal e deixando um núcleo livre; uma simulação por vez.
  Medido em 2026-10-20: 1000 iterações de 5 min de luta em ~1 s; o log de ações de uma iteração
  tem ~1,5 MB.
- Para testar com um simc local: `WIPE_SIMC_EXE=… WIPE_SIMC_PROFILE=… cargo test -p wipe-cause-app
  simc -- --ignored`.

## 7. Limites que o player precisa saber

- O robô não erra mecânica e anda o padrão; a diferença de DPS nunca é só rotação.
- O SimC às vezes está atrasado em relação a um patch novo, e a spec pode estar sem rotação boa
  nele. Nesse caso mostramos o aviso do próprio SimC sobre a spec.

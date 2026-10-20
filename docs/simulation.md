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

Tudo sai do log daquele pull, nada é pedido ao player.

- **Personagem:** classe, spec, raça, nível; itens com ilvl, encantamentos, gemas e **bonus IDs**
  (hoje o `setup.rs` descarta os bonus IDs; eles definem crafted, sockets e faixa de upgrade).
- **Talentos:** os nós do `COMBATANT_INFO` convertidos no código de talentos que o SimC lê.
- **Consumíveis e buffs:** os mesmos que o player tinha **naquele pull** — frasco, comida, runa e
  poção pelas auras; Bloodlust, Power Infusion e outros buffs externos nos **mesmos momentos** em que
  chegaram nele; buffs de raid conforme a composição real.
- **Luta:** duração fixa igual à janela (sem variação de duração), número de alvos e janelas de AoE
  pelo contexto alvo único × AoE que já calculamos, tempo sem alvo (intermissões, boss intocável)
  como pausa. *(decidido por nós)* Fases de execute seguem a vida real do boss: se o boss não chegou
  a 20%, o robô também não usa execute.
- **Movimento:** **padrão**, não o do player (o player da guilda costuma se mover mais do que
  precisa). *(decidido por nós)* Mesmo padrão do estilo *LightMovement* do SimC, para todos os papéis;
  depois dá para trocar por um padrão por boss.

## 5. O que comparar (mix de números e decisões)

**A) Números agregados**, com várias iterações (≈1000): DPS, casts por minuto de cada skill, atraso
médio dos cooldowns, procs desperdiçados, tempo com cada buff, tempo parado. Mesma tela da comparação
com os tops, com o robô no lugar deles.

**B) Decisões**, com o log de ações do robô em várias seeds: para cada situação que a rotação da spec
considera (proc ativo, recurso, cooldown pronto, alvos), o que o robô escolhe e com que frequência.
Depois, cada cast do player é checado no estado real dele (buffs, recursos e recargas lidos do log).
Erro só quando o robô quase nunca faria aquilo naquele estado: "aos 1:42 você usou Y com o proc Z
ativo; o robô usa X em 95% das vezes". É a mesma ideia das *decisões da rotação* (tops X→Y × você
X→Z), com o robô como referência.

**Robô × tops:** nesta seção o robô é o certo. Quando os tops (ou a nossa rotação em YAML) fazem
diferente, mostramos um aviso ao lado: "os top logs fazem outra coisa: …", e o player decide.

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

# Análise de healer — regras

Rascunho das regras de como o wipe-cause vai analisar e apresentar o desempenho dos healers. Base:
o que já fazemos com os DPS (rotação base em `rotations/*.yaml` + comparação com uma referência), as
restrições próprias da cura (definidas em 2026-10-11) e o tutorial *How To Use Warcraftlogs as a Healer!*
(AutomaticJak, https://www.youtube.com/watch?v=MhOfb7iUEBg).

Os textos que aparecem no app seguem a regra de sempre: pt-BR e inglês na mesma mudança, com nomes de
spells e bosses em inglês.

## 1. Por que healer é diferente de DPS

- **O número de cura engana.** A cura que um healer faz depende do dano que a raid toma. Dá para
  inflar o HPS de duas formas: tomando mais dano do que devia, ou montando a raid com só 1 ou 2
  healers para eles ficarem com toda a cura. Quanto mais tempo passa desde o lançamento do raide,
  mais os logs do topo usam esses truques.
- **Não existe rotação fixa.** O healer reage ao dano. O que dá para cobrar é a parte que não
  depende do dano: cooldowns usados, sequências que a spec pede, procs que se gastam, buffs e HoTs
  mantidos, mana bem usada e tempo sem lançar nada.
- **A composição muda tudo.** Com 4 healers cada um cura uma fatia diferente de quando são 5. Com
  outras specs ao lado, a fatia muda de novo (um Disc ao lado tira cura de dano em área de todo
  mundo, por exemplo).

Conclusão: **não comparamos com os tops do ranking.** O HPS nunca é a nota principal; ele só aparece
como contexto.

## 2. Que log serve de referência

**Nunca usar os logs da nossa raid como base** (decisão de 2026-10-11): nossos healers são os players
que queremos ajudar, e nem sempre jogam do melhor jeito. Nem o colega da mesma spec no mesmo pull nem
um kill anterior do próprio player servem de referência. A evolução do player (aba Evolução) continua
existindo, mas como acompanhamento, não como o "certo".

Parâmetros da luta não são referência de healer: o golpe (dano que entra de uma vez) e a raide baixa
da [note de CDs de cura](heal-cd-note.md) medem o boss e podem ser calibrados nos nossos logs
(decisão de 2026-10-27).

A referência são **logs de kill de outras guildas no mítico**, com composição de healer parecida com a
nossa (filtros abaixo). Não buscamos pelo nº do kill (decisão de 2026-10-11): o que protege contra log
distorcido são a composição, os sinais da lista abaixo e não pegar só o topo do ranking. Os nossos
logs servem só para achar os ids de spells e buffs ao escrever o YAML; metas e limites saem das
referências.

### Filtros para os logs de referência

Obrigatórios:
- **só mítico**, mesmo boss (do raide atual, `raidEncounters`);
- candidatos tirados de várias páginas do ranking da spec, não só da primeira: a nota (parse) do
  log não entra na escolha, porque o topo do ranking de cura é justamente onde estão os logs
  inflados;
- região US ou EU (o próprio vídeo recomenda deixar CN de fora: os parses de lá fogem do padrão);
- **mesmo número de healers que o nosso pull.** Se não houver logs suficientes, aceitar ±1 e avisar
  na tela;
- nenhum Power Infusion de outra pessoa no healer de referência, mesma regra dos DPS. Innervate e
  Source of Magic de outra pessoa não descartam o log; ficam só nos eventos baixados de cada luta
  (`fight-<id>.json`, não no `refs.json`), porque mudam a mana dele, e ainda não aparecem na tela.

Pontuação de semelhança, para ordenar o que sobrou:
- quantas specs de healer batem com as nossas, sem contar o próprio player (peso maior);
- duração do kill parecida.

Sinais de log distorcido (log descartado ou rebaixado):
- **dano tomado pela raid por segundo** acima do normal dos outros candidatos do mesmo boss (a
  raid tomou dano demais para inflar a cura);
- um healer com fatia da cura total da raid muito acima de 1/nº de healers sem motivo da
  composição;
- preferência (não filtro) por kills mais perto do lançamento do boss: com o tempo os logs ficam
  mais distorcidos. Ainda não aplicada: o `startTime` é guardado, mas não entra na escolha.

Referência agregada: assim como nos DPS, juntar **vários** logs filtrados (alvo: 5 ou mais por
boss/spec) e mostrar a faixa (mediana e quartis), não um log só. Com menos de 3 logs de referência
os números aparecem, mas sem dica.

A tela sempre mostra **contra quem** estamos comparando: quantos logs entraram na referência e a
composição de healers deles × a nossa.

## 3. O que medir

Cada métrica diz de onde vem no log. Tudo que listamos já vem nos eventos que baixamos do WCL
(`heal` com `overheal` e `absorbed`, `includeResources` com vida do alvo e mana de quem lança,
`playerDetails` com a composição).

### 3.1 Contexto (não é nota)

- HPS efetivo (sem overheal) e fatia da cura dos healers.
- Composição dos healers no pull e na referência.
- Dano tomado pela raid por segundo, nosso contra a referência. Se for bem maior que o deles, nossa
  raid está tomando dano evitável: é assunto da raid, não do healer (hoje, um aviso à parte na ficha
  do healer; ver 4.6).

### 3.2 Cooldowns de cura

O vídeo mostra que os cooldowns e defensivos usados nos mesmos momentos em vários logs marcam os
momentos perigosos da luta.

- Usos por luta contra o máximo possível (mesmo cálculo de "segurado depois de pronto" dos DPS).
- **Momento do uso, preso à mecânica do boss** (feito em 2026-10-12, `src/lib/cdAnchors.ts`): um
  cooldown grande quase sempre cobre um golpe grande, e o tempo de luta escorrega de uma raid para
  outra. Cada uso vira "k-ésimo cast do boss + Δs" (o cast mais perto, de 15 s antes a 30 s depois);
  uma mecânica é momento da referência quando 60% ou mais dos logs que chegaram nela usam o cooldown
  ali (com pelo menos 5 logs). Na tela: "2ª Stir the Depths · referência +3 s (80% dos logs) · você +8 s ▶". É
  informação, não dica: usar em outra mecânica pode ser a estratégia da raid.
- Cooldown que o player terminou a luta sem usar nenhuma vez.

### 3.3 Habilidades de recarga fixa

O vídeo pede espaço regular entre os casts de habilidades com recarga fixa (Prayer of Mending,
Holy Shock, Divine Toll, Riptide, Renewing Mist...): buraco grande entre dois casts é cast perdido.

- Tempo total "pronto e não usado" por habilidade, igual aos DPS.
- Maiores buracos, com o momento da luta, para o player ir ver no replay (ainda não: a dica de
  recarga fixa sai sem momento; ver o item 8 do protótipo).

### 3.4 Sequências da spec

Algumas specs pedem uma ordem de skills para a cura render. Essas sequências vêm do guia do
Wowhead, escritas com nossas palavras no YAML da spec, e são conferidas contra os logs de
referência. Exemplos do guia atual (o vídeo é de um patch anterior):

- Restoration Druid: Wild Growth antes do Convoke the Spirits; Wild Growth e Regrowths 15 a 20
  segundos antes do Tranquility.
- Discipline Priest: Evangelism (Atonement na raid) e logo depois o dano que vira cura.
- Holy Paladin: Divine Toll e Aura Mastery dentro do Beacon of Virtue.
- Holy Priest (Archon): Apotheosis junto com Halo.
- Restoration Shaman: Riptide e Surging Totem logo antes do Ascendance.
- Preservation Evoker: Echo antes do dano e gastar todos de uma vez; Stasis guardando Temporal
  Anomaly e Dream Breath.

Regra de exibição (a mesma lição dos DPS sobre X→Y): uma sequência só vira dica quando **os logs de
referência cumprem** a sequência (mediana alta) e o player não. Se nem a referência cumpre, ou a
sequência depende de talento ou árvore de herói que o player não tem, ela não aparece.

### 3.5 Casts com proc e casts "duros"

O vídeo mostra no gráfico de casts a diferença entre o cast instantâneo de graça, o cast acelerado
por buff e o cast duro (mais lento e mais caro). Exemplos: Chain Heal do Restoration Shaman (de
graça, acelerado, normal) e Prayer of Healing com e sem buff.

- % dos casts da habilidade feitos com o buff que a deixa melhor, contra a referência (ainda não
  medido; ver o item 8 do protótipo).
- Procs perdidos (expirados sem uso), mesmo motor dos DPS (`proc perdido`).

### 3.6 Buffs e HoTs que a spec mantém

- Uptime contra a referência: Atonement (média de alvos), Lifebloom, Rejuvenation (Abundance),
  Renewing Mist... O uptime do cooldown principal (no vídeo, 37% de Avenging Wrath contra 40% da
  referência) ainda não é medido.
- Buffs de alvo único (Beacon, Earth Shield no 2º alvo): o vídeo sugere usar quem mais precisa de
  cura (no WCL, o EHRPS, "effective healing required per second", na aba Damage Taken). Dica
  possível: "seu Earth Shield ficou no tank que menos precisou de cura; quem mais precisou foi X".

### 3.7 Mana

O vídeo indica a aba Resources: como a mana desce ao longo da luta e de onde vem a regeneração.

- Mana no fim do kill. Se sobrou muita mana, dava para lançar mais cura (o oposto do DPS que
  estoura recurso).
- Mana zerada antes do fim: gasto alto demais no começo, ou casts duros onde havia proc/buff (liga
  com 3.5).
- Curva da mana contra a faixa da referência, em % da luta (ainda não: hoje valem a mana no fim e
  a mana zerada).

### 3.8 Tempo ocioso

- Tempo sem lançar nada vivo (o "always be casting" dos healers). Healer parado com a raid de vida
  cheia não é erro: só contam os segundos com alguém vivo abaixo de 80% de vida.
- Dano causado nos buracos de cura, para specs que curam com dano (Disc, Mistweaver, Holy Paladin):
  contra a referência.

### 3.9 Overheal

- Overheal % por habilidade contra a referência da mesma spec, nunca um número fixo. HoTs e escudos
  têm overheal naturalmente diferente.
- Dica só para a habilidade que mais pesa: muito acima da referência numa skill cara = mana jogada
  fora.

### 3.10 Mecânicas do boss

O vídeo filtra a cura para quem estava com o debuff de uma mecânica (consulta "aura presente no
alvo"). No app:

- Para cada mecânica de `encounters/` que pede cura em alvo (debuffs de dano, alvos marcados), a
  cura que cada healer deu nesses alvos durante o debuff, e quanto tempo os alvos ficaram em vida
  baixa.
- Na tela de mortes, para quem morreu: a cura que recebeu nos últimos segundos e de quem, junto
  com o dano (já mostrado).

### 3.11 Sobrevivência do próprio healer

- Dano tomado pelo healer que precisou de cura, contra a referência da mesma spec. O vídeo aponta
  que um Mistweaver que usa bem os defensivos fica no fim da lista de EHRPS. Usa o que já temos de
  defensivos e mortes.

## 4. Como apresentar

Mesma linguagem da aba Desempenho dos DPS, com estas regras a mais:

1. **Cabeçalho da referência**: com quantos logs comparamos, composição de healers deles × a nossa,
   e um aviso quando a composição não bate.
2. **Contexto antes das dicas**: HPS efetivo, fatia da cura e dano tomado pela raid ficam num
   bloco à parte, sem cor de bom ou ruim. O HPS não decide nada sozinho.
3. **Dicas em ordem de impacto**: cooldowns e recarga fixa, no mesmo nível (3.2/3.3) > sequências e
   procs (3.4/3.5) > buffs e HoTs (3.6) > mana e ociosidade (3.7/3.8) > overheal (3.9).
4. **Cada dica tem quatro partes**: o que o player fez, o que a referência faz (faixa), por que
   importa (uma frase) e, nas checagens da spec e na mana zerada, o momento da luta para ver no
   replay.
5. **Silêncio quando não há base**: menos de 3 logs de referência, ou a referência não cumpre o
   que estamos cobrando → a métrica aparece só como número, sem dica.
6. **Dica de raid separada de dica de healer**: dano tomado acima do normal, mortes por mecânica e
   falta de healer na composição são da raid, não do healer. Hoje o aviso de dano tomado aparece
   num bloco à parte na ficha do healer; levar essas dicas para o resumo da noite está pendente.
7. **De onde vem a cura**: para as habilidades que mais curam, fatia da cura, overheal e casts,
   seus e a mediana da referência (casts ajustados para a duração da sua luta).

## 5. Protótipo (feito em 2026-10-11)

Mesma estratégia que deu certo nos DPS: protótipo curto, medir, só então generalizar.

1. **Dados no motor** (`crates/wipe-core`):
   - absorção (`SPELL_ABSORBED` / `absorbed` do WCL) conta como cura de quem pôs o escudo, como no
     Warcraft Logs. Antes ficava de fora; sem isso o Power Word: Shield do Disc não existia;
   - overheal por habilidade (`overhealBySpell`) e mana % a cada 5 s (`manaTimeline`), só para healer;
   - buffs que o healer mantém na raid viram uptime `ally`, com a média de alvos (Atonement, Beacon,
     HoTs). Contam os buffs já ativos antes do pull. Nele mesmo, só os buffs declarados no YAML
     (Lifebloom do Everbloom);
   - o tempo parado do healer só conta nos segundos com alguém vivo abaixo de 80% de vida.
   Conferido contra a tabela de cura do WCL (Nek'zali mítico, 29/09): diferença de −0,2% a +3,4% por
   healer.
2. **Referência**: `node scripts/rotation.mjs refs <spec> [--per-boss N]` (`scripts/rotation/heal-refs.mjs`)
   baixa kills no mítico, US/EU, de 4 páginas do ranking de cura, sem as 10 primeiras posições e sem
   usar a nota na escolha. Cada log guarda a composição de healers, a fatia da cura e o dano tomado
   pela raid. Da vida da raid só ficam os eventos em que alguém cruza os 80%. `node
   --experimental-strip-types scripts/rotation/heal-bench.mjs` resume log a log em
   `src/data/heal-refs/<spec>.json` (com os casts do boss e os usos dos cooldowns, para o momento por
   mecânica).
3. **YAML de healer**: `role: healer`, sem prioridade nem abertura. Checagens novas: `ally_uptime`
   (tempo com o buff ou média de alvos). Feitos: `priest-discipline`, `druid-restoration` e
   `paladin-holy`, conferidos com `node scripts/rotation.mjs check <spec>` nas referências.
4. **No app** (`src/lib/healer.ts`, `HealerPanel`): a escolha da referência e as dicas desta página,
   na tela do player.
5. **Calibração** (`src/lib/healer.calibration.test.ts`): cada log de referência contra os outros do
   mesmo boss. Na primeira rodada quase todos ganhavam dica; o que mudou:
   - momento e uso de cooldown só com 5 ou mais logs (com 3–4, "a maioria usa aqui" era estilo de
     duas raids, e o uso anda em passos de 33%);
   - cooldown com 1 ou 2 usos possíveis na luta só é cobrado de quem não usou nenhum (segurar para a
     mecânica é estratégia);
   - a referência "cumpre" uma checagem com mediana ≥ 85%; dica só com o player 5 pontos abaixo do
     p25 e 12 pontos (15 em proc) abaixo da mediana; no tempo parado, 2 e 5 pontos;
   - uptime dos HoTs sem checagem no YAML saiu das dicas (varia com o estilo).
   Hoje: até 35% dos logs de referência com alguma dica (os de referência não são tops; parte das
   dicas entre eles é erro de verdade).
6. **As 7 specs** (2026-10-11): Discipline Priest, Holy Priest, Holy Paladin, Restoration Druid,
   Restoration Shaman, Mistweaver Monk e Preservation Evoker, com 64 a 72 logs de referência cada (8 por
   chefe). Calibração (referência contra referência) com dica em 13% a 26% dos logs; o resto do que
   aparece é erro de verdade desses players (proc gasto no spell errado, mana sobrando).
   Ajustes que saíram da calibração e das referências:
   - momento do cooldown virou informação ("Momentos dos cooldowns"), não dica;
   - uso de cooldown só cobra 2 usos atrás (1 em cooldown curto, com 5+ usos na luta) ou nenhum uso;
   - checagens do guia que a referência não cumpre ficaram de fora do YAML (Surging Totem antes do
     Ascendance, Apotheosis com Halo do Archon); as sequências do Preservation Evoker (Echo antes do
     dano, Stasis com Temporal Anomaly e Dream Breath) também não estão no YAML;
   - metas de buff na raid tiradas das referências (Atonement 8, Renewing Mist 9, Rejuvenation 5).
7. **Comparação detalhada (2026-10-12)**: para healer, a busca de logs no Warcraft Logs usa a
   composição como filtro (`healerCompCandidates` em `src/lib/wclApi.ts`): 4 páginas do ranking de
   cura, sem as 10 primeiras posições, US e EU, 40 candidatos espalhados, composição de cada um pelo
   `playerDetails` (10 reports por consulta) e só os com pelo menos 70% dos nossos healers em comum
   (em comum sobre o maior dos dois grupos: com 4 healers, 3 iguais; com 5, 4 iguais). Sem Power
   Infusion de outra pessoa, como nos tops. A opção "na própria raid" não existe para healer.
8. **Depois**: logs parecidos com a nota do NSRT (esperando uma nota real) e o que a seção
   3 ainda não cobre: cura por dano tomado pela raid (3.1), % de casts com o buff certo (3.5), uptime
   do cooldown principal e alvo dos buffs de alvo único pelo EHRPS (3.6), curva da mana (3.7), dano
   nos buracos de cura (3.8), cura nos alvos das mecânicas (3.10) e a sobrevivência do healer
   (3.11). Os maiores buracos da recarga fixa com o momento (3.3). Na escolha da referência: item level parecido, preferência por kills mais perto do
   lançamento e Innervate/Source of Magic na tela. Dicas de raid no resumo da noite (4.6).

## Decisões

- 2026-10-11: protótipo com Discipline Priest, Restoration Druid e Holy Paladin.
- 2026-10-11: não filtrar pelo nº do kill da guilda.
- 2026-10-11: análise de healer só no mítico.
- 2026-10-11: os logs da nossa raid nunca são referência (nem colega no mesmo pull, nem kill anterior).
- 2026-10-27: golpe e raide baixa da note de CDs de cura são parâmetros da luta, não do healer, e
  podem ser calibrados nos nossos logs ([heal-cd-note.md](heal-cd-note.md)).

## Dúvidas em aberto

- Mínimo de logs de referência por boss/spec com composição parecida: logo no começo da temporada
  pode haver poucos.

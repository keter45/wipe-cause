# Replay: como medir e desenhar as habilidades do boss

O replay é um motor para todos os bosses, os de hoje e os que vierem. O Coiled Altar (21/10/2026) foi
o primeiro boss a passar por ele inteiro; os números dele estão em
[coiled-altar-replay-audit.md](coiled-altar-replay-audit.md). O Twin Fangs e o Vashnik vieram depois,
com o mesmo método ([twin-fangs-vashnik-replay-audit.md](twin-fangs-vashnik-replay-audit.md)). Aqui
ficam as regras e o método, que valem para qualquer boss.

## Princípios do motor

1. **Boss é dado, não código.** Tudo que um boss mostra no mapa sai da regra dele
   (`encounters/<raid>/<boss>.yaml`: `cone`, `ground`, `area`, `soak`, `blast`, `line`, `pool`,
   `pickup`, `unit_aura`, `orbs`, `gaze`, `units.replay`) ou de um arquivo de dados
   (`data/arenas.json`, `data/defensives.json`, `data/utility.json`). Quando um boss pede algo que não
   existe, crie um campo genérico novo, pensando em como outro boss usaria, nunca um `if` para aquele
   boss. Suposições de mecânica (a poça some quando a fase troca) viram opção da regra.
2. **O log manda; o resto é hipótese.** Tooltip, guia, outro site: servem para saber o que procurar.
   O número vem do log (o Widow's Kiss diz 40 jd e o log mostra 45). Anote de onde veio cada número
   (data, logs, quantos casos) no comentário da regra.
3. **Medir com o que aconteceu e com o que não aconteceu.** Onde alguém tomou dano mostra onde a raide
   estava, não onde a habilidade estava. Compare quem tomou com quem estava perto e não tomou; separe
   por vez que o cast sai e por fase.
4. **O que não pode sair da arena calibra a arena.** Orbs, adds, fantasmas, machados: 100% dentro do
   chão. Só player aparece fora, e aí está caindo. A exceção é quem vive fora do chão de verdade (o
   boss que nada no ácido em volta da plataforma, o add que sai do poço): `offFloor` na arena, depois
   de olhar o desenho das posições.
5. **Sem posição no log, inferir com o que o log dá, e dizer que é inferido.** A posição de quem pegou
   é a do fragmento; a viagem pelo portal dá as duas pontas; o caminho do fantasma é simulado.
6. **É replay: o futuro está no log.** Contagem até o soak, o próximo frontal, o próximo cast. Só não
   conte até o que depende da raide (o boss zerar não tem hora marcada).
7. **Animação pela hora do replay, nunca por CSS.** O slider, a pausa e os clipes desenham igual.
8. **Tudo liga e desliga, e a escolha fica salva.** Cada camada nova entra num menu do mapa (Camadas,
   Áreas, No chão).
9. **Texto genérico, nome do boss só no dado.** O motor fala de "orbs", "o que pegar", "poça"; o nome
   da habilidade vem da regra (e sempre com ícone, nas duas línguas).
10. **Confira a premissa antes de desenhar.** A unidade tem posição no log? O dano cai mesmo com a
    distância? A aura da regra é a do player ou o cast? Um desenho em cima de premissa errada engana
    mais que nenhum (o círculo da Caustic Explosion diria "afaste-se", e o dano é igual a 5 ou a 50 jd).
11. **Cada coisa nova vem com teste** (no Rust, a captura; no front, a conta) e com a auditoria do boss
    dizendo o que foi medido e o que ficou de fora e por quê.

## Medir

### O tamanho da arena: pelo que nunca sai dela

O encaixe da imagem (`scripts/arena-fit.mjs`) usa onde os players pisaram. Quando a raide evita a
borda (poças nas laterais, como no Altar), os pisões encolhem a plataforma: o Altar saiu com 83 jd de
lado e tem 100,8.

- Confira com as unidades que não podem sair da arena: orbs, fantasmas, machados, adds. Todas as
  posições delas no log têm que cair dentro do chão. Só players aparecem fora, e aí estão caindo.
- Se algo fica fora, meça a largura pelos extremos dessas unidades e trave em `spanYd` no
  `arena-fit.mjs`: a escala fica fixa e só a posição é procurada.
- `node scripts/arena-check.mjs <log> <encounter> --draw <saída.svg>` faz a conta por tipo de unidade
  (quanto ficou fora, até onde, quanto no buraco) e desenha as posições em cima da imagem. Olhe o
  desenho antes de mexer no chão: no Twin Fangs os dois bosses ficam 100% fora, mas é o certo (eles
  nadam no ácido em volta da plataforma, e os Spawns saem do poço do meio). Esses vão em `offFloor`
  (ids de npc) na arena, e a conferência passa a dizer FORA OK.

### Poça em lugar fixo da sala: quem tomou e quem não tomou

Os ticks mostram onde a raide estava, não onde a poça estava: olhar só para eles engana (no Altar, a
primeira análise concluiu que nenhum círculo servia).

1. Em janelas de 1 s a partir do cast que abre a poça, guarde a posição de cada player vivo e se ele
   tomou tick ou não.
2. Procure centro e raio (e a simetria: dois lados, topo/baixo, anel) que melhor separam os dois
   grupos. Nota: índice de Youden (acertos dentro + seguros fora − 1). No Altar, dois círculos
   laterais deram 0,41 contra 0,13 dos outros formatos.
3. Separe por vez que o cast sai: o tamanho pode mudar (no Altar, a 1ª poça deixa um corredor de
   10 jd; da 2ª em diante elas se encontram no meio).
4. O tempo (atraso e duração) vem dos ticks contados a partir do cast.
5. Vira regra `pool` na mecânica: `cast_id`, `delay_s`, `duration_s`, `grow_s` e um `shapes` por vez,
   com os centros nas coordenadas do log. A poça some na troca de fase.
6. Procure o mesmo formato em outras fases: no Altar, o Defiled Ground da P3 é a mesma poça lateral,
   aberta por cada Defilement (18 de 21 contatos dentro do modelo). Pouco dado de uma fase? Confira o
   modelo de outra fase contra os contatos dela em vez de medir do zero.

### Área em volta de quem tem o debuff: por pulso

DoT que pega quem está perto do marcado (Coiling Ichor, Plague Froth): o raio sai de cada **pulso**,
não de janelas de 1 s. Os ticks de um portador caem no mesmo ms; em cada lote, quem tomou e quem
estava a até 25 jd do portador e não tomou, pela distância ao portador mais perto. Youden escolhe o
raio. Janelas de 1 s misturam o segundo do pulso com o segundo sem pulso e jogam o "não tomou" para
dentro do círculo (deu 26% de falso positivo no Coiling Ichor; por pulso, 14%). Separe pela idade do
debuff para ver se a área cresce.

Antes de desenhar uma área de "afaste-se do marcado", confira se o dano cai mesmo com a distância:
dano bruto (o `baseAmount`, antes da mitigação) por faixa de 5 jd. A Caustic Explosion do Vashnik dá
~222k de 0 a 55 jd: o guia fala em queda, o log não mostra, e o mapa fica sem círculo.

### Golpe na frente do boss (soak `ahead`)

Smash que cai num ponto marcado na frente do boss (Stone Breaker): compare onde o tank estava no
acerto com o ponto `posição do boss + R × (cos, sin)(direção no fim do cast)`. No Twin Fangs o tank
ficou a 0,9 jd desse ponto na mediana com R = 25, em 365 smashes. Vira `soak: { radius, players,
ahead: R }` com o `cast_id`: um círculo por cast, mesmo sem ninguém dentro, e o que ninguém pegou
aparece vazio. Nas falhas, o player mais perto do ponto dá o teto do raio.

### Raio de explosão: o par de danos dentro e fora

Quando a habilidade tem um dano perto e outro longe (Widow's Kiss até X jd, Widow's Touch além),
meça a distância de cada atingido até o centro (o meio do soak) e escolha o raio com menos erros
(Kiss fora + Touch dentro). O tooltip pode errar: o Kiss diz 40 jd e o log mostra 45.

### Frontal

- Desenhe como setor: a borda em arco, no alcance. O triângulo antigo esticava os cantos além do
  alcance.
- O tamanho vem dos atingidos e das contagens do log (stacks de quem toma por orb quebrado). Orbs
  não têm `UNIT_DIED`: "o orb sumiu do log" mistura orb pego com orb quebrado e não serve para medir.

### O que o log não põe no chão

- **Fragmentos para pegar** (regra `pickup`): o acerto ao pegar traz a posição de quem pegou; o
  fragmento fica ali desde que o dono ganhou o debuff. As stacks iniciais do debuff não aparecem no
  log (o `SPELL_AURA_APPLIED` não traz contagem, só as quedas trazem): conte quantos faltam pelos
  fragmentos que ainda vão ser pegos.
- **Escudo ou véu num inimigo** (regra `unit_aura`): stacks iniciais vêm como vários
  `SPELL_AURA_APPLIED` seguidos; o absorvido é a soma dos `SPELL_ABSORBED` com o id do escudo no
  campo do spell que absorveu. Guarde um ponto a cada 250 ms: são centenas de acertos por segundo.
  Quando o log só repete a mesma linha (o escudo do orb do Twin Fangs sai duas vezes no mesmo ms,
  com o mesmo valor), use `stacks: false`.
- **Inimigo sem posição enquanto o escudo segura**: todo acerto vira `SPELL_ABSORBED`, que não traz o
  bloco advanced, e a unidade só ganha posição quando o escudo cai (o Shrouded Venom do Vashnik, ~4 s
  depois de nascer). O motor põe a unidade parada no primeiro lugar conhecido desde o começo da aura
  (`unit_aura`), se ele vem até 10 s depois.
- **Unidade que o log nunca mata** (o orb do Twin Fangs, sem `UNIT_DIED`): sem regra ela fica no mapa
  até o fim. `units` com `cleared_by: <mecânica>` tira a unidade no primeiro acerto daquela mecânica
  a até o raio dela + 3 jd (o soak que limpou o orb: quem pegou estava a 4,5 jd na mediana, 99% até
  8 jd de um orb de 5 jd), e `lifetime_s` põe um teto.
- **Unidade sem posição nenhuma**: os tumores do Vashnik nascem por `SPELL_SUMMON`, começam o cast e
  morrem sem uma linha com o bloco advanced. Não há o que desenhar; antes de `replay: true`, confira
  com `arena-check` que a unidade tem posições.
- **Vida de add**: `units` com `replay: true` guarda a vida (barra embaixo dele no mapa).

### Utilidades dos players (CC, portal do warlock)

- **CC** fica em `data/utility.json` (como os defensivos em área em `data/defensives.json`): `at:
  caster` com `radius` (Leg Sweep, Capacitor Totem...) ou `at: target` (Storm Bolt, Hammer of Justice;
  com `radius`, uma área em volta do alvo, como o Gorefiend's Grasp). Só entra CC com lugar confiável:
  os de mira no chão (Ring of Frost, Ursol's Vortex, Ring of Peace) não dizem onde caíram.
- **Portal do warlock**: o log não tem as pontas. Uma é onde o warlock estava no cast (`111771`, com
  início e fim, a barra em cima dele); a outra vem de quem passou (aura `113942`). A viagem não é
  instantânea (~0,9 s, o log mostra o meio do caminho): a ponta de chegada é o ponto mais longe nos
  1,5 s depois de entrar. Portal aberto antes do pull sai só das passagens, sem lançador.

## Desenhar

- **Tudo liga e desliga.** Cada camada nova entra num menu do mapa (Camadas: contagens, próximo cast,
  animações, CC, portais, quem cortou; Áreas e No chão: as habilidades do boss), salvo entre sessões.
  O usuário decide o que vê.

- **É replay: o futuro está no log.** Soak, explosão, debuff de quem carrega algo e orb que o boss vai
  limpar mostram sozinhos o arco que fecha e os segundos; o próximo frontal aparece tracejado 10 s
  antes, com o nome e os segundos dentro; o próximo cast de um add, 10 s antes. Só não conte até o que
  depende do dano da raide (o boss zerando): isso não tem hora marcada.
- **Animação pela hora do replay, nunca por CSS.** Pulso, estouro, clarão e preenchimento do cast
  são função de `now`: o slider, a pausa e os clipes desenham igual.
- **Impactos:** anel que sai e some no instante do golpe (soak, explosão, orb que o frontal quebra,
  fragmento pego); o frontal enche durante o cast, do boss até a borda, e dá um clarão no golpe.
- **Mapa:** a proporção da arena (sem sobra nas laterais) e a imagem recortada a 6 jd do chão.
- **Linha do tempo por mecânica:** uma faixa por mecânica, marca cheia = deu errado, vazada =
  aconteceu e tudo bem. Faixas finas, com rolagem própria, e os controles colados no mapa: a linha
  do tempo não pode empurrar o mapa para fora da tela.

## Ferramentas

- Recorte de um pull para medir: `tail -c +<logOffset+1>` do log até o `ENCOUNTER_END`, com a
  primeira linha do log (`COMBAT_LOG_VERSION ... ADVANCED_LOG_ENABLED,1`) na frente, senão o
  `wipe-cli` lê sem posições. `wipe-cli fight <recorte> --pull 0` gera o replay completo.
- Recorte das lutas de um boss (só mítico) de vários logs, para medir rápido: um script que copia as
  linhas entre `ENCOUNTER_START,<id>,...,16` e `ENCOUNTER_END`, com a primeira linha do primeiro log.
  `wipe-cli analyze <recorte> --json` lista os pulls (o `id` de cada um vai no `fight --pull`).
- `node scripts/arena-check.mjs <log> <encounter> [--draw saída.svg]`: unidades fora do chão, por tipo.
- Posição numa linha com advanced logging: os dois decimais seguidos de um inteiro (o uiMapID) e de
  outro decimal (a direção) são x e y, em qualquer tipo de evento. O bloco é de quem lançou, menos no
  dano (`SPELL_DAMAGE`, `SPELL_PERIODIC_DAMAGE`), em que é do alvo. `SPELL_CAST_START`, `SPELL_SUMMON`,
  `SPELL_ABSORBED` e `UNIT_DIED` não trazem o bloco. A direção é em radianos no mesmo sistema das
  posições: o ponto à frente fica em `(x + R cos f, y + R sin f)`.
- Referência externa: o demo do Hexweaver (`hexweaver.win/demo/altar/`) baixa um `sample.json` com o
  modelo de cada mecânica (poças, orbs, fantasmas, fragmentos, escudos). Bom para saber o que existe
  e comparar números; os nossos vêm sempre do log.

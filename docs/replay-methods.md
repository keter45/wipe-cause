# Replay: como medir e desenhar as habilidades do boss

O que aprendemos montando o replay do Coiled Altar (21/10/2026), para usar em qualquer boss. Os
números do Altar estão em [coiled-altar-replay-audit.md](coiled-altar-replay-audit.md); aqui fica o
método. A regra geral continua: toda habilidade com forma no chão aparece no mapa, e o que o log não
mostra é inferido e marcado como inferido.

## Medir

### O tamanho da arena: pelo que nunca sai dela

O encaixe da imagem (`scripts/arena-fit.mjs`) usa onde os players pisaram. Quando a raide evita a
borda (poças nas laterais, como no Altar), os pisões encolhem a plataforma: o Altar saiu com 83 jd de
lado e tem 100,8.

- Confira com as unidades que não podem sair da arena: orbs, fantasmas, machados, adds. Todas as
  posições delas no log têm que cair dentro do chão. Só players aparecem fora, e aí estão caindo.
- Se algo fica fora, meça a largura pelos extremos dessas unidades e trave em `spanYd` no
  `arena-fit.mjs`: a escala fica fixa e só a posição é procurada.

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
- **Vida de add**: `units` com `replay: true` guarda a vida (barra embaixo dele no mapa).

## Desenhar

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
- Posição numa linha com advanced logging: os dois decimais seguidos de um inteiro (o uiMapID) e de
  outro decimal (a direção) são x e y, em qualquer tipo de evento.
- Referência externa: o demo do Hexweaver (`hexweaver.win/demo/altar/`) baixa um `sample.json` com o
  modelo de cada mecânica (poças, orbs, fantasmas, fragmentos, escudos). Bom para saber o que existe
  e comparar números; os nossos vêm sempre do log.

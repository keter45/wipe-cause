# Coiled Altar: auditoria do replay

Revisão de 15/10/2026, focada em Mythic. Esta auditoria separa parâmetros do
tooltip, eventos observados e geometria inferida. Não muda as tolerâncias de
culpa nem recalibra velocidade/ângulo dos fantasmas sem evidência nova.

## Fontes e limites

- Tooltips do Wowhead consultados por spell ID e dificuldade:
  `https://nether.wowhead.com/tooltip/spell/<id>?dd=16`. O parâmetro `dd=15`
  foi comparado para os soaks: ambos descrevem raio de 9 jardas; o mínimo é
  5 players no Mythic e 3 no Heroic. O motor usa 5 em todas as dificuldades
  (`soak.players`); o mínimo de 3 do Heroic não está modelado.
- Log Mythic: `WoWCombatLog-101426_205104.txt`, 14/10/2026.
- Log Heroic para confirmar o cast da P3 e a limpeza por Blighted Sever:
  `Archive-WoWCombatLog-092226_180441.txt`, 22/09/2026.
- Valores de dano abaixo são referências brutas do tooltip Mythic consultado,
  não dano esperado após mitigação, nem substitutos do dano real do log.
- O range de lançamento (frequentemente 300 jardas ou ilimitado) não é o raio
  da área. Só a descrição do efeito sustenta os raios listados.
- Há campos quebrados/desatualizados no tooltip: Axegrinder descreve raio de
  contato de 0 jardas; Mutagenic Venom ainda descreve 8, contra o hotfix de
  13/10 já documentado nas regras (6). Esses valores não sobrescrevem a
  calibração existente. Venom Rupture também omite parte do dano no texto.

## Mecânicas espaciais

| Mecânica / IDs | Descrição e geometria da fonte | Replay e conclusão |
| --- | --- | --- |
| Sever — 1299684 | Frontal físico, ~3,33M; cast de 3s; destrói orbs. Tooltip não especifica abertura/alcance do cone. | Cone presente. Mantidos meio-ângulo 40° e alcance 40 yd como calibração, não como números confirmados pelo Wowhead. No impacto, prioriza facing registrado; antes, acompanha o alvo. Removidas marcas pontuais redundantes de chão. |
| Soul Sever — 1286620 / 1307959 / 1312630 | Frontal Shadow, ~1,04M + DoT de ~125k/2s por 45s; cast de 4s; destrói fantasmas. | Cone presente, meio-ângulo 30° e alcance 45 yd continuam inferidos. Aura 1307959 em um fantasma confirma sua limpeza. O DoT não é uma área estacionária. |
| Blighted Sever — 1307292 / 1307403 | Frontal Shadow, ~833k, cast de 3s; destrói orbs e fantasmas. | Cone presente com calibração do Sever, ainda sem confirmação Mythic da P3. Aura 1307403 em fantasmas confirmada no log Heroic. |
| Guillotine — cast 1283489, dano 1283594, aura 1307425 | ~5,42M físico dividido no raio de 9 yd do alvo; cast de 3,5s; mínimo 5 no Mythic. | Corrigido de 5 para 9 yd. O começo do círculo usa o cast real (incluindo o voo até o hit), não os 3s artificiais anteriores ao dano. Centro usa o alvo explícito do cast quando sua posição recente é compatível com os hits; sem isso, conserva o centro inferido dos atingidos. |
| Grim Guillotine — cast 1299267, dano 1299296, aura 1307652 | ~5,42M Shadow dividido em 9 yd, absorb de cura; cast de 3,5s. | Mesma correção de raio e associação ao cast, ID confirmado no log Heroic. Grim Execution continua sem ID resolvido; não inventado nesta revisão. |
| Guillotine / Grim Guillotine (double soak) | Mesmo impacto, com vulnerabilidade prévia. | Usa o mesmo círculo do soak; a regra de erro continua separada, sem criar outro centro. |
| Widow's Kiss — 1283623 | ~1,25M Nature a até 40 yd do machado, depois do soak. | Disco de 40 yd ligado ao centro estimado do soak. Aviso até o evento real de explosão (incluindo Widow's Touch); fallback temporal de 6s explicitamente estimado. |
| Widow's Touch — 1283631 | ~208k Nature a pelo menos 40 yd do epicentro. | Dano contextual, não um segundo círculo perigoso pequeno. Não confundir range ilimitado de lançamento com área. |
| Death's Embrace — 1299396 | ~1,25M Shadow a até 40 yd do machado. | Disco de 40 yd ligado ao Grim Guillotine, com o mesmo contrato de aviso/impacto e incerteza do centro. |
| Axegrinder — 1283832 / 1285017, NPC 260474 | Impacto de ~1M físico em 4 yd; machados vagam por até 3 min, ~125k/0,25s no contato. | Área móvel presente em torno do NPC, raio calibrado de 4 yd. Posições entre eventos continuam inferidas; o tooltip quebrado de contato em 0 yd não serve de raio. Desaparecimento da P2 já tratado. |
| Volatile Venom — 1282419 / 1282288 | ~87,5k Nature/s em 5 yd por 5s; deixa orb verde ao expirar. | Área do portador presente em 5 yd; mantém vínculo à aura. |
| Mutagenic Venom — 1310498 / 1310691 | Tooltip: ~250k Nature/s por 5s, raio ainda descrito como 8 yd; deixa roxo. | Área do portador presente; mantidos 6 yd pós-hotfix. Não regredir para 8 apenas pelo tooltip. |
| Orbs / Venom Rupture — NPCs 268042 / 271982, 1299838 | Verde pulsa no raid e explode ao quebrar; roxo reage a contato. | Orbs carregados/no chão e quebras já presentes. Círculo de contato é calibração do motor; dano no raid não fornece uma posição de poça. |
| Toxic Deluge — 1299960 / 1309279 | Impactos em 4 yd deixam orbs; textos dos dois IDs divergem no dano. | Parcial: marcas de hits e orbs resultantes, não todos os retículos antes da queda. Sem evento com centro do míssil, posição da vítima não prova o centro. |
| Noxious Ground — 1283290 | ~166,7k Nature/s em quem está no chão venenoso; cresce e recua a partir do altar. | Contorno local estimado por contatos recentes, tracejado e recortado no piso; regiões sem vítimas continuam desconhecidas. |
| Gloombomb — aura 1310881, dano 1310883 | Marca por 5s; ~500k Shadow em 15 yd; aplica Gravebound e remove Spirit Shield no Mythic. | Área do portador presente com raio de 15 yd. Centro ligado à aura, não ao alvo do boss. |
| Gravebound / Soul Fragment — 1286837 / 1308330 | Recuperar fragmentos causa ~208k Shadow; expiração mata. | Debuff/dano presentes, mas não há posição individual confirmada de todos os fragmentos. Não reconstruir fragmentos reais a partir de um único hit. |
| Suffocating Darkness — 1286947 | Absorb de cura acumulativo; tooltip consultado não dá geometria das poças. | Aura contextual. Não há contorno confiável de todas as poças para desenhar. |
| Spirit Erasure — 1287722 | Ao pisar no fragmento, ~166,7k Shadow no raid e vulnerabilidade de 20% por 2s. | Dano contextual; não é uma área circular ao redor de cada vítima. Caminhos dos fragmentos da intermissão continuam sem reconstrução fiel. |
| Defilement of the Coiled Altar — 1298381 | Canaliza 8s, absorb no raid, ganha Corrupted Toxin; cria Defiled Ground que cresce/recua. | Contorno local estimado por contatos da aura Defiled Ground 1298591, sem confundir o absorb de cura com dano evitável. |

Fangs of the Coiled Altar, Twinfang/Corrupted Toxin, Venomfang, Dreadful Presence,
Dread Bolt, Retaliatory Malice, Eternal Nightfall, Wail of Terror, Spirit Shield,
Soulbinding e Soulbound continuam como casts, auras, dano ou estado dos bosses.
Não precisam de uma área artificial em torno de quem recebeu dano.

## Manifestation of Dread: o que o log realmente permite

IDs principais: summon 1285844 e Unassailable 1285847 (vistos no log; o motor não usa), Unnerving
Fixation 1285911,
Dreadmarch 1297445, Malevolent Resonance 1312132 / 1310744.

Na varredura do arquivo de 14/10 foram encontrados 127 GUIDs de fantasmas e
254 eventos com advanced positions desses GUIDs: 127 casts de Unassailable e
127 casts de Unnerving Fixation. Não foram encontradas amostras de movimento
depois desses casts. A análise dos 11 pulls válidos guarda 113 caminhos nas
janelas de replay; isso não significa que os outros 14 summons não existiram.

Também existem 64 aplicações de Soul Sever diretamente nos fantasmas. Em todos
esses casos a remoção da fixação ocorre no mesmo milissegundo ou 1ms depois.
Essas auras de NPC antes eram descartadas pelo encaminhamento restrito a
players. Agora são aceitas e encerram somente o fantasma atingido, sem esperar
outro evento ou inferir que todos os fantasmas próximos foram destruídos.

Refinamentos conservadores implementados:

1. O fim simulado inclui o timestamp exato, mesmo fora da grade de 100ms.
   A primeira posição fica intacta; o último passo usa somente o tempo restante.
2. Uma posição antiga do dono não é mais usada como âncora factual de alcance:
   exige amostra anterior com até 1,5s de idade. A simulação continua podendo
   extrapolar entre amostras, pois isso é inferência permitida, não medição.
3. A âncora de alcance usa o evento de Dreadmarch mais próximo, limitado ao fim
   da fixação, em vez de assumir que a posição no instante da remoção é igual.
4. Colisão comprova que os fantasmas encostaram, mas NÃO fornece coordenadas.
   O encontro ainda é inferido pelo ajuste conjunto de velocidade. O texto
   de ajuda agora distingue isso de uma posição registrada.

Mantidos: velocidade-base de 4 yd/s, cone de visão de 35°, espera de 2,5s,
parada de 1,5s e critério de culpa. Não há evidência nova suficiente para
alegar aumento percentual de precisão ou trocar esses valores globalmente.
O caminho inteiro é estimado; tracejado indica correção adicional, não que
todo trecho contínuo tenha sido observado.

## Validação da primeira revisão

Comparação antes/depois sobre os mesmos 11 pulls de 14/10:

- 180 mortes, 15 soaks e 113 caminhos de fantasmas mantidos; nenhum erro de YAML.
- Mesmos resultados de culpa, contagens e eventos de mecânicas (desconsiderando
  somente a ordem não determinística das listas).
- Centro de 11 dos 15 soaks atualizado; os outros conservam o fallback.
  Início antecipado em aproximadamente 2s ao usar cast real mais voo do projétil.
- 26 caminhos de fantasmas alterados, sem retunar os parâmetros globais.
  Maior diferença de distância total: aproximadamente 1,77 yd. Isso mede
  estabilidade da alteração, não precisão contra uma trajetória observada.
- A simulação termina no evento exato; o relatório ainda amostra posições a
  cada 250ms, resolução espacial/temporal existente do replay.

Cobertura automatizada: raios/IDs embutidos, centro/alvo/timing de soak,
fallback sem cast, posição obsoleta, auras em NPCs, fim exato do fantasma,
âncora de alcance e precedência de facing no frontal.

## Complemento: fantasmas, frontais e áreas

- A correção dos caminhos por colisão/alcance agora é distribuída apenas nos
  segmentos com movimento simulado. O bloqueio pelo olhar é reaplicado após
  a correção: uma âncora contraditória não arrasta o fantasma enquanto o dono
  olha para ele. Facing e posições entre amostras continuam estimados.
- Frontais mostram contorno durante todo o cast disponível e impacto somente
  no fim; casts interrompidos não mostram impacto. A origem no impacto fica
  presa à posição do boss naquele instante, sem acompanhar movimentos posteriores.
- Widow's Kiss e Death's Embrace têm círculos completos de 40 yd ligados ao
  centro do soak, nunca à posição atual do boss. O aviso começa no impacto do
  machado. Eventos de dano, miss/immune e absorb da mesma origem, próximos aos
  6s esperados, determinam o momento da explosão; Widow's Touch também serve
  como evidência temporal. Sem evento inequívoco, o tempo fica estimado.
  O centro segue inferido; a interface distingue isso do horário observado.
- Noxious Ground e Defiled Ground têm contornos locais estimados dos contatos
  registrados, não uma reconstrução integral das poças. Usa-se grade de 2 yd,
  uma célula de margem em cada direção e validade de 3s por contato. Bordas
  internas são removidas, trechos separados não são unidos, contatos futuros
  não aparecem antes da hora e o contorno é recortado pelo piso conhecido.
  O tracejado, a legenda e o título deixam a inferência explícita. A ausência
  de contorno não significa chão seguro. Defiled Ground usa a aura 1298591,
  sem adicionar julgamento de culpa para seu absorb de cura.

## Complemento: report WCL e clareza na P1

- Fonte de reprodução: report zKrnCRc26xj3VhBF, fight 19, uma das últimas
  tentativas com P2. Foram inspecionados os eventos originais já baixados no
  cache do aplicativo: 165.014 eventos e 119.426 amostras posicionais com
  direção. Não era ausência de facing nesse fight.
- A API fornece o ângulo no sistema girado e horário do WCL, em centésimos
  de radiano. O conversor usava esse valor como ângulo nativo do combat log.
  Agora converte por (-facing / 100 - pi/2) módulo 2*pi, como já fazia a
  transformação inversa das coordenadas posicionais. A convenção foi também
  confrontada com eventos de um report e log local que se sobrepõem.
- Um trecho real da instância 2 do fantasma desse fight (22 amostras de
  posição/facing do alvo durante 10s) virou teste de regressão anonimizado:
  olhando para o fantasma, ele fica parado; com a conversão anterior, andava
  mais de 10 yd no mesmo trecho. Isso não transforma o caminho simulado em
  uma trajetória medida do fantasma.
- Facing ausente permanece desconhecido: posições/HP são preservados, mas
  esse evento não fornece cobertura para julgar o olhar nem uma seta falsa
  em zero radianos. A correção posterior de mortes exige renovar o cache
  de eventos, além de reanalisar e reabrir o replay.
- Na P1, cada Axegrinder passa a esmaecer após 5s sem hit em player próximo
  da posição estimada. Novo contato reativa aquele machado; DoT longe dele
  não renova a confirmação. Sem hit, conta-se desde seu nascimento. Na P2,
  permanece a regra existente de desaparecimento. O esmaecimento sinaliza
  incerteza espacial, não que a área esteja segura.
- Noxious Ground fica oculto por padrão, inclusive ao migrar preferências
  anteriores. Reativá-lo na legenda continua possível e fica salvo para as
  próximas sessões; outras preferências não são zeradas.

## Mortes e ressurreições no WCL

- Eventos de ressurreição são preservados e convertidos para SPELL_RESURRECT,
  permitindo que o replay volte a mostrar o jogador vivo depois do battle rez.
- A try 17 corresponde ao fight 18 do report zKrnCRc26xj3VhBF. A morte de
  Antithesis aos 67.059 ms tem feign: true na resposta original da API; não
  foi uma morte real nem um battle rez. Esse campo agora é preservado pelo
  redutor e o conversor ignora essas falsas mortes na análise e no replay.
  O fight inteiro foi baixado novamente e reprocessado: a única morte real
  desse jogador ocorre aos 260.637 ms.
- O cache passa para wcl-events-v4: as versões anteriores descartavam feign
  ou ressurreições, portanto não podem ser reutilizadas com segurança.
  No site, a chave de eventos do IndexedDB também passa a usar a versão 4.
  Não se infere uma ressurreição apenas porque um jogador se move ou recebe cura.

## Pendências de evidência

Validação do complemento: 101 testes Rust e 213 testes de frontend passaram,
assim como typecheck, build e diff --check. Conferido no navegador o aviso
durante o cast, a mudança no fim e o círculo completo no enquadramento aberto.
Nos 11 pulls Mythic de 14/10, foram preservadas 180 mortes e geradas 16
explosões com horário observado (um soak adicional foi retido para contextualizar
uma explosão dentro da janela de replay). No log Heroic de 22/09, o pull do
Coiled Altar produziu Widow's Kiss e Death's Embrace com horário observado e
contatos de Defiled Ground. Não houve mudança nos julgamentos existentes ao
comparar os mesmos pulls Mythic, excluindo evidência espacial de replay,
snapshots não determinísticos e a nova regra informativa de Defiled Ground.

1. Representar a proveniência dos centros de soak no contrato do replay:
   alvo amostrado/interpolado versus centro inferido dos hits.
2. Só adicionar contornos completos de Noxious/Defiled Ground, fragmentos e
   retículos do Toxic Deluge com uma fonte espacial ou modelo explicitamente
   estimado; ausência de dano não prova ausência de área.
3. Confirmar abertura e alcance dos três frontais com dados de efeitos ou
   vídeo calibrado. O tooltip confirma o cone, não seus números atuais.

Relatórios e replays já salvos precisam ser reanalisados para incorporar as
correções do motor/YAML. A renderização de facing beneficia relatórios que já
tenham esse campo, sem alterar os eventos originais.

## Recalibração dos fantasmas (15/10)

Pedido: o fantasma andando/parado não batia com o log. Com `WIPE_GAZE_DUMP=<pasta>` o motor
grava, por pull, posições/direção dos alvos, fixações, colisões, alcances (Dreadmarch sozinho),
fantasmas limpos por frontal e os casts com posição; `scripts/ghost-calibrate.mjs` simula sem
âncoras e mede o erro contra esses fatos. Base: 19 pulls Mythic de 14 e 15/10, 385 fantasmas,
23 colisões, 24 alcances e 225 fantasmas limpos pelo Soul Sever/Blighted Sever.

| Parâmetros | Alcance (mediana) | Colisão (mediana) | Limpos dentro do cone |
| --- | --- | --- | --- |
| antes: 4 jd/s, 35°, espera 2,5s, parado 1,5s | 6,6 jd | 7,9 jd | 165/225 (73%) |
| agora: 4,5 jd/s, 30°, espera 2s, parado 0,5s | 1,0 jd | 3,9 jd | 186/225 (83%) |

O que mais pesava era a parada de 1,5s depois de visto: o fantasma volta a andar quase assim
que o alvo vira de costas. A melhora vale nos dois dias separados (14/10: custo 20,8 → 9,9;
15/10: 26,4 → 14,5). O critério de culpa da colisão (45°, 5s) não mudou. Os caminhos continuam
estimados; o cone do Soul Sever (30°/45 jd) também é calibração, não número confirmado.

Com os caminhos novos, cada pull guarda quantas jardas o fantasma de cada um andou
(`MechanicResult.ghostYards`); o resumo do boss soma na noite como métrica do grupo.

## Culpa da colisão pela simulação (28/10)

Pedido: de 7 colisões numa noite, só 2 tinham culpado. A regra antiga (de costas para onde o
fantasma começou, em cone de 45°, por pelo menos metade dos 5s antes da colisão) dava "os dois
olhavam" na maioria: o fantasma anda antes desses 5s, e 45° perdoa quem olha um pouco de lado.
Medido em 21, 22 e 26/10 (Mythic, `WIPE_GAZE_DUMP`): 22 colisões únicas; os fantasmas começaram
a 8–31 jd um do outro, então alguém andou. A simulação calibrada acima (escala 1, sem âncora)
deixa os dois fantasmas a até 6 jd um do outro na colisão em 18 de 20 pares.

Regra nova (`gaze::judge`): a antiga continua; além dela, com os dois fantasmas simulados a até
8 jd na colisão (ou um alvo só), é culpado quem teve o fantasma andando pelo menos 3 jd e pelo
menos um quarto do que os dois andaram. O texto diz que é estimado pela simulação. Nos relatórios
das três noites, colisões com culpado: 2 de 15 → 14 de 15 (a que sobra tem um alvo só e o
fantasma dele não andou: o outro alvo morreu ou estava imune).

Os dois andaram (pedido do desenvolvedor, 28/10): culpado é só o que andou por último; o outro já
estava parado quando foi alcançado. Pararem com até 1s de diferença conta como os dois andando
juntos (os dois são culpados). Nas três noites, 3 colisões que culpavam os dois passaram a culpar
um só (o outro tinha parado 7 a 24s antes); continuam 14 de 15 colisões com culpado.

Fantasmas extras depois da possessão (Dreadmarch): uns 0,3s depois que a possessão sai do player,
o Malacrass invoca fantasmas novos (1285844; 1 ou 2, às vezes 4 a 6 de uma vez), e cerca de 1s
depois cada um casta a fixação (1285911). Em 26/10: 269 invocados, todos com fixação no motor. O
replay mostra cada um a partir da fixação, no ponto do cast.

## Fase 2, contagens e faixas por mecânica (21/10)

Conferido no pull 16 de 15/10 (Mythic, P3 82%).

- **Gravebound** (`pickup`): entra com 3 stacks; cada fragmento pego é um acerto de 1308330 com
  a posição de quem pegou, e tira 1 stack. Os fragmentos (NPC 261763, visto no log; o motor não usa) quase nunca aparecem no log
  como unidade (6 em 75 pegos), então o mapa põe cada um onde foi pego, desde a explosão da bomba.
  Fragmento que ninguém pegou não tem posição: só o número no debuff da cabeça.
- **Spirit Shield** (`unit_aura`, 1309105): no Mythic entra no Spiteful Soulcoiler com 2 stacks
  (dois `SPELL_AURA_APPLIED` seguidos); cada Gloombomb tira 1. Os adds agora têm `replay: true`,
  com a vida guardada para a barra embaixo deles.
- **Spirit Shield como falha** (27/10, `detect.assign`): a mecânica passou a dizer quem da
  Gloombomb não chegou ao add dele (seção abaixo).
- **Veil of Twilight** (`unit_aura` com `absorb`, 1286912): o escudo do Eternal Nightfall. O
  absorvido é a soma dos `SPELL_ABSORBED` com esse spell no Malacrass: 34,8 mi em cada um dos dois
  Nightfalls do pull, os dois cortados.
- **Roxos até o Toxic Deluge**: a contagem vale só para os casts de `cleared_by`. Os que somem com o
  Zul'jan zerando dependem do dano da raide e ficam sem contagem.
- **Noxious Ground como círculo** (`pool`): a primeira tentativa mediu só a borda por faixas de altura
  e concluiu errado que nenhum círculo servia. Refeito com busca de centro e raio (índice de Youden
  entre quem tomou tick e quem estava perto sem tomar, 17 mil posições, 1.755 ticks): dois círculos,
  um de cada lado do altar, explicam bem melhor que qualquer outro formato (0,41 contra 0,13). Por vez
  que o Fangs of the Coiled Altar sai: no 1º, centros a 50 jd do meio e raio 40 (0,87; sobra um
  corredor de 10 jd); do 2º em diante, centros a 42,5 jd e raio 42,5 (0,73; as poças se encontram no
  meio). Os ticks começam ~4,5s depois do cast e duram ~22s; a poça do Fangs que sai logo antes da P2
  some na troca de fase. O contorno pelos contatos continua, escondido por padrão.
- **Widow's Kiss / Death's Embrace**: 45 jd, não os 40 do tooltip. Em 55 Kiss e 920 Touch, o Kiss vai
  até ~45 jd do meio do soak e o Touch começa depois disso (o menor erro fica entre 44 e 46 jd).
- **Sever**: o tamanho não dá para medir pelos orbs (eles não têm `UNIT_DIED`, e sumir do log mistura
  orb pego com orb quebrado); continua 40°/40 jd, a calibração que bate com as stacks de Venom Rupture.
  No mapa ele virou setor (a borda em arco, do tamanho do alcance); o triângulo antigo esticava os
  cantos além do alcance.
- **Twilight / Suffocating Darkness**: sem anel. O log não mostra a poça escura, só o absorb de
  cura (1286947) em quem entrou nela.

## Gloombomb e Spirit Shield: atribuição por canto (27/10)

Design: [docs/designs/gloombomb-assignment.md](designs/gloombomb-assignment.md). Medido em 7 noites
Mythic da guilda (14, 15, 19, 20, 21, 22 e 26/10/2026), 215 levas de bomba, 432 adds.

| O quê | O que o log mostra | Na regra |
| --- | --- | --- |
| Adds | `SPELL_SUMMON` do Spiritcackle (1286498) do Malacrass, 2 Spiteful Soulcoiler (261521) no mesmo ms; a posição vem do cast do Spirit Shield em si mesmo, 30 ms depois. Só 4 pontos (até 0,6 jd): (1176,3; 20,9) 78 vezes, (1176,7; −21,0) 84, (1137,9; 20,8) 124, (1137,3; −21,0) 146. Com o norte para cima, são cima esquerda, cima direita, baixo esquerda e baixo direita. | `detect.assign.spots` |
| Gloombomb (1310881) | Em 4 players no mesmo ms, 2,5 a 6,5 s depois do summon; dura 5,0 s (±30 ms) e explode quando sai. Em 198 das 215 levas o jogo escolhe 2 melees + 2 rangeds (tank, Holy Paladin e Mistweaver contam como melee); as outras ficam quase todas no fim de pulls com wipe. | `carrier_aura`; `range` das specs em `data/defensives.json` |
| Acerto no add | Sem dano no add: no mesmo ms da explosão ele perde 1 stack do Spirit Shield (`REMOVED_DOSE`) por bomba a até ~15 jd (acertos: mediana 10,4 jd, 90% até 13,7; entre 15 e 18 jd, misturado). O add anda ~12 jd até a explosão. | `target_aura`, `reach: 16.5` |
| Troca de add | Par que vai no add do outro par tira os dois escudos do mesmo jeito: longe do add designado só é erro quando o escudo fica. | falha = escudo que ficou |
| Escudo tirado antes | Em 22/10 (pull de 430 s, leva de 367 s), o Spirit Shield saiu dos dois adds com `SPELL_AURA_REMOVED`, sem dose, 1,6 s antes das bombas: algo além da Gloombomb tira o escudo. O motor não culpa ninguém (não ficou escudo); a causa não foi identificada. | — |

Conferência leva a leva do motor contra a medição (scripts de medição fora do repo), pelo
`replay:check` nas 7 noites: 194 levas, 188 julgadas (6 puladas: 5 sem add vivo da última invocação,
1 fora do 2+2), 39 escudos que ficaram antes da call de wipe: 33 com culpado, 5 com portador morto, 1
sem explicação. Os 15 escudos que a medição achou depois da call de wipe não entram (o app para de
contar ali). O resto bate pull a pull com os mesmos culpados, menos dois casos: o escudo tirado antes
das bombas (acima), que a medição contava como falha, e uma falha sem culpado (portadores mortos) que
a medição punha 3 s depois por estimar a explosão. A comparação achou um erro no motor, já corrigido:
ele guardava só a primeira morte de cada player, e quem levou battle rez e morreu de novo com a bomba
virava culpado.

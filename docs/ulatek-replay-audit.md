# Replay do Ula'tek: o que foi medido

09/11/2026, atualizada até 12/11. O Ula'tek passou pelo método do [replay-methods.md](replay-methods.md) depois do nerf de
07/11. O nerf mudou dano e contagem (ovos, alvos), não tamanho, então os logs de antes também servem
para medir forma.

Logs:
- Warcraft Logs, pós-nerf: `DVYRKLqg3zw6tC8c` (kill heroico de 07/11 e 6 wipes míticos),
  `JwC1GWMzmjZD72Yv` (kill heroico de 08/11), `pRJDTa1j7qc9tAx8` (kill mítico de 08/11) e
  `BPR9KFWZYnwy7T4f` (kill mítico e 6 wipes de 09/11, guilda Rancour: o teste dos ovos e das falhas no raid) e
  `kW7y1qfK8zR39LAn` (noite de prog da Rancour).
- Locais, antes do nerf: heroico de 06/10 (3 pulls, 1 kill) e de 01/10, mítico de 05/11 (1 pull de 72 s); depois do nerf, o log local de 09/11.

Conferência final: `npm run replay:check` sem REVISAR no heroico e no mítico. Sobram só os casts sem
forma: outros ids das mesmas habilidades, Writhing Gestation, Shadow Molt e Boiling Venom.

## Arena

| Antes | Depois | Por quê |
|---|---|---|
| imagem só da plataforma (`08.ulatek-ort-platform-v85`), com `core: 45` no encaixe para ignorar quem saía dela | a sala inteira (`08.ulatek-ort-full-v185`), com o veneno em volta como dois buracos (em cima e embaixo), separados pelas pontes dos lados | na P2 a raide se divide nas bordas dos lados (y ±110-127 no log, ~75 jd fora da plataforma) por 90-120 s, e o mapa antigo mostrava essa parte no vazio |

- **Escala e posição:** as da plataforma, que já encaixava a 0,984 com a imagem só dela. O octógono
  tem 78 jd no log e 280 px na imagem com 1224 de largura (7,15 px/jd na original). A transformação é
  fixa (`fixed` no `arena-fit.mjs`, `anchored` na arena).
- **Players no chão** (4 kills e 6 wipes do WCL): 99,6% na P1, 100% na P2 e 99,8% na P3. Na P2 os
  pisões caem nas passarelas e nas pontes da imagem.
- **`offFloor`:** Ula'tek (257758), a cauda (Gore Rattle, 259555 e 267418), os Spectral Coils
  (267679) e a Ula'tek espectral do mítico (268029). Todos ficam no veneno em volta da plataforma.
- **Nota do `arena-fit`:** 0,477 com a sala inteira. A nota é um F1, e a raide só usa uma faixa das
  bordas, então o chão sobra. O encaixe vale pela plataforma (0,984).

## Mecânicas

| Mecânica | Medida | Regra |
|---|---|---|
| Spectral Coils | Cada Spectral Coil aplica Soul Constrictor (1300685) nos soakers no mesmo ms do dano no raid inteiro (1287265), e esse dano traz a posição exata de todos. Em 55 impactos do WCL, os soakers ficaram a até 8-9 jd do meio deles; quem não soakou quase sempre ficou além de 8 jd. O meio fica a 21-22 jd do Coil (15-25 jd), na direção dele no fim do cast (±10°). No kill heroico local, os 10 círculos ficaram com 6 a 14 players dentro. | `soak: { radius: 8, ahead: 22 }` com o `cast_id` 1299010: um círculo por Coil, mesmo vazio |
| Fester Burst | Medido pela distância até o Wretch. Até 10 jd, quase ninguém tomou: 3 acertos a 4-7 jd, com o Wretch andando. A partir de 14 jd, quase todo acerto. | `area: { npc: 263942, radius: 10, keep_unit: true }` (os 10 jd do guia) |
| Noxious Splash | quem carrega o ovo (aura 1307612) e outro portador a menos de 3 jd | `area: { aura: 1307612, radius: 3 }` (já existia) |
| Noxious Shell (dano de carregar, 1307617) | DoT que segue o portador; marcava o chão a cada tick (2261 acertos em 6 wipes) | `ground: false` |
| Putrid Membrane, Acidic Expulsion | dano no raid inteiro | `ground: false` |
| Adds | cada tipo com cor e ícone de uma habilidade: verdes para o que sai dos ovos (Rawling, Viper, Venomous Heart), quentes para os Doomscales; Warden e Ravenous Doomscale entram no mapa (`replay: true`) | `units` com `color`/`icon` |
| Ovos com casca (mítico) | Blightscale Spawn 265644 e 268121, sem `UNIT_DIED`, vida de 0 a 82 s, até 22 s sem linha com o ovo ainda no chão. Saem do log de quatro jeitos: pego (Noxious Shell 1307612 num player; vem da Ula'tek, não do ovo; o player está a 2,3-4,8 jd no log local e até 15 jd no WCL, e os DoTs batem no ovo por mais 1,6-2,7 s), quebrado (vira Rawling 1-3 s depois da última linha), Writhing Gestation (vira Blightscale Clutch 263535: 6 ovos somem em 226,7 s e 6 Clutches nascem em 227,9 s, DVYR fight 40) e choca (vira Viper). No log local, os 8 ovos saem do mapa na Shell certa (design [replay-unit-exit.md](designs/replay-unit-exit.md)) | `units` com `replay`, `until_last_line: true` e `cleared_by_aura: { aura: 1307612, radius: 15, within_s: 3 }` |
| Caustic Waves da cauda | a direção muda de cast para cast e não está no log; a frente anda 13,5 jd/s a partir da cauda (seção abaixo) | `waves: { cast_id: 1298570, speed: 13.5, width: 6, duration_s: 7 }`: onda inferida dos acertos |
| Mephitic Thrash | todo mundo toma o mesmo dano (595-625k sem mitigação) de 35 a 60 jd da cauda: o dano não cai com a distância | sem forma (premissa 10) |

## Saída dos ovos do mapa (`replay:check`, 09/11)

Quantos ovos o mapa mostra, quantos saíram pela Noxious Shell (`cleared_by_aura`) e quantos ficaram no mapa mais de 1 s depois de sair do log:

| Log | Ovos no mapa | Saíram pela Shell | Atrasados |
|---|---|---|---|
| Local, mítico de 05/11 | 8 | 8 | 0 |
| WCL DVYR + pRJD | 150 | 106 | 0 |
| WCL BPR9 | 149 | 135 | 0 |

- **Log local:** pelo replay completo do `wipe-cli fight`, cada ovo sai entre 0,05 e 0,2 s antes da Shell, por causa do passo de 250 ms. A Shell foi ligada ao ovo a 2,3–4,8 jd do player.
- **BPR9:** nenhum dos 135 ovos tirados pela aura levou golpe direto depois dela. Só aparecem ticks de DoT e o dano de suporte do Augmentation (Ebon Might, Shifting Sands, Prescience). Da aura até a última linha do ovo: mediana de 1,8 s e máximo de 2,94 s.
- **Contagem à mão:** antes do `replay:check`, uma conta à mão comparou o fim da trilha com as Shells e deu 78 de 150. A janela do replay cortava parte das trilhas antes.

## O que choca o ovo em Viper (10/11)

Medido nas 853 vezes em que alguém perdeu o Noxious Shell nos reports míticos kW7y, BPR9, DVYR e pRJD. Cada saída foi ligada a uma Viper (261915) ou a um Rawling (261874) que nasceu até 1,5 s depois.

| O que acontece com o portador | Viper | Rawling |
|---|---|---|
| Toma o soak do Spectral Coils (1287265) | 0 | 647 |
| Toma Caustic Waves (1292403) | 8 | 0 |
| Encosta em outro portador (Noxious Splash 1307635) | 5 | 2 |
| Morre com o ovo | 31 | 16 |

- **Outros golpes não chocam o ovo.** Os portadores tomaram 1132 Mephitic Thrash e perderam o ovo só 2 vezes.
- **Ovos no chão.** Das 93 Vipers, 43 nascem de ovos no chão que encostam no veneno, sem portador perto.
- **Ordem no log.** A Caustic Waves tira o Noxious Shell no mesmo ms do golpe, e o log registra a perda da aura antes do dano. Por isso o `requires_aura` aceita a aura que caiu até 50 ms antes do golpe.
- **Culpado da Viper.** O `viper_hatched` passou a disparar pela aura 1301268, que cai no raid de 0 a 0,09 s depois que o portador perde o ovo, e culpa quem perdeu o Noxious Shell (`fail_aura_ids` + `culprit_auras`). O número de falhas não mudou. Ganharam culpado:
  - 32 falhas no log local de 09/11, com 35 culpados (Noxious Splash culpa os dois portadores);
  - 11 das 13 na noite de prog da Rancour (kW7y);
  - 1 das 3 no BPR9.

  Ovo no chão continua sem culpado.
- **A regra `egg_carrier_waves`** culpa o portador que tomou a onda. Contou 19 casos no log local de 09/11 e 7 no kW7y.
- **Efeito nas outras regras com `requires_aura`.** Comparei antes e depois nos logs locais de 05/11 e 09/11, no Twin Fangs de 24/09 e nos reports BPR9, vbCJ e kW7y. Mudaram só dois double soaks que o check antigo perdia, os dois da Reidane:
  - no `grim_guillotine_double_soak` do Coiled Altar, ela tomou 5,8M contra ~0,5M de quem não tinha a vulnerabilidade;
  - no `feasted_double_soak` do Twin Fangs, o Feasted caiu no mesmo ms do segundo soak.

## Caustic Waves: de onde saem e quando (12/11)

Medido em 36 pulls míticos (kW7y, BPR9, pRJD e os 6 wipes do DVYR) e 2 kills heroicos (JwC1 e
DVYRk), com o centro da plataforma em (0; 1553,5), nas coordenadas cruas do JSON do WCL. No JSON cru,
o `facing` vem espelhado em relação a esses eixos: a direção real é `-facing`. Com ele, a Ula'tek
sempre olha para o centro. O núcleo não precisa disso: a importação do WCL já converte posição e
`facing` para a convenção do log local (`wcl.rs`, na leitura do evento).

- **Quem solta:** a Ula'tek, num anel a 46 jd do centro, em múltiplos de 45°. As caudas (1298570),
  sempre em par, num anel a 56 jd, olhando para o centro com 0°, ±15° ou ±45° de desvio. A cauda do
  1311807 fica a 41 jd e sai junto com o 1319282 da Ula'tek, a 90° dela.
- **Roteiro fixo no mítico** (os mesmos segundos em todos os pulls):

  | Tempo | Quem | Posição |
  |---|---|---|
  | 38 s | par de caudas | 0° e 45°, ou o espelho, 180° e −135° (sorteio 1) |
  | 56 s | Ula'tek 1319282 + cauda 1311807 | Ula'tek sempre a 90°; a cauda a 0° ou 180°, do lado oposto ao do sorteio 1 |
  | 59 s / 69 s | caudas | sempre −135° e −45° / 0° e 180° |
  | 113 s | Ula'tek 1319282 + cauda 1311807 | Ula'tek a 0° ou 180° (sorteio 2); cauda a −90° |
  | 116–157 s, P2 293 e 306 s | caudas | uma de duas sequências fixas, conforme o sorteio 2 |
  | ~427 s | Ula'tek 1292211 | uma diagonal sorteada; as caudas do lado oposto a ela, a ±22,5° |
  | P3 482, 532 e 576 s | Ula'tek 1292211 | +90° a cada cast; as caudas sempre do lado oposto |

  No heroico a estrutura é a mesma, mas mais cedo (Ula'tek em 48 s e 100 s) e com menos caudas.
- **Onda da cauda: velocidade.** Uma frente que sai da cauda no cast e anda 13,5 jd/s (p25–p75 de
  13,1 a 14,2; 377 acertos). Leva ~7 s para atravessar a plataforma. Cada cast é uma unidade nova da
  cauda (a instância muda), e o `facing` dela no cast fica a 0°, ±20° ou ±40° da direção do centro.
  O `begincast` não traz posição nem `facing`.
- **Onda da cauda: direção (12/11, medida de novo; a "faixa de ~55 jd" anterior estava errada).**
  - Por cast, os acertos ficam juntos: espalhamento mediano de 5° (p25 2°, p75 15°; 29 casts com 3+
    acertos). São ondas estreitas.
  - A direção muda de cast para cast, quase sempre entre o `facing` da cauda e a direção do centro
    (ex.: desvio de −40° → acertos a 9°, 18–23° ou 44° do `facing`, conforme o cast).
  - Nenhuma forma fixa explica: 1 onda no `facing` explica 33% dos acertos a 4 jd; 3 ondas do
    `facing` até o centro, 63%; um ângulo ao acaso, 2%. Mas os acertos para o lado do centro são em
    boa parte onde o raid fica: pela taxa de acerto de quem a frente cruzou (12.511 passagens),
    só o próprio `facing` sobe acima do fundo (9–23% contra 1–3%), e mesmo a até 3 jd dele só 10–14%
    entre 45 e 90 jd tomam.
  - O setor do `facing` até o centro (±5°) pega 85% dos acertos, mas também 72% de todas as
    passagens, e lá dentro só 3,7% tomam (2,3% fora): é "tudo na frente da cauda", não diz nada.
  - Conclusão: o log dá a hora e a velocidade da onda, não a direção. A direção de uma onda só se
    sabe pelos acertos dela.
- **Onda da cauda pelos acertos (12/11, para o `waves` com `cast_id`; design
  [replay-cast-waves.md](designs/replay-cast-waves.md)).** Dos 471 acertos (1292403, sem tick),
  331 batem com a frente de um cast de cauda a ±8 jd, em 192 casts.
  - Frente − distância do acerto: p5 −6,5, p25 −2,8, mediana −0,5, p75 1,7, p95 4,0 jd (tolerância
    de ±7 jd).
  - Vão de ângulo entre acertos vizinhos do mesmo cast: 94 abaixo de 3°, 14 de 3–5°, 8 de 5–8°, 23
    acima de 8°. Limite de 6° entre grupos: 219 grupos (1,14 por cast).
  - Desvio lateral até o meio do grupo (limite 6°): mediana 0,1, p90 2,1, p95 3,0, máx 5,5 jd. Onda
    de 6 jd de largura.
  - Acerto mais distante do grupo: mediana 73, p90 88, máx 93 jd (7 s × 13,5 = 94,5 jd).
  - Par de caudas (mesmo instante, mesmo anel): com ±7 jd e até 7 s, 318 acertos com cast; 112 (35%)
    cabem nos dois casts do par, 75 com diferença de erro abaixo de 3 jd, 15 com a outra cauda a mais
    de 90°. O `facing` não separa: os acertos ficam a até 48° dele (p50 6°, p95 37°). Com margem de
    3 jd e coerência de 6° com os grupos já formados: 243 diretos, 19 pela coerência, 56 sem onda.
    Resultado: 165 grupos em 151 casts.
  - "Dentro e sem tomar" nas ondas assim desenhadas (faixa de 6 jd, passagens da frente radial): até
    94,5 jd, 191 de 380 passagens tomaram (50%); até o acerto mais distante + 5 jd, 185 de 307 (60%).
    No setor do `facing` até o centro eram 3,7%.
- **Ondas da Ula'tek na P1 (1319282, cast de 6 s):** quase ninguém é acertado (17 acertos em 77
  casts), então medi pela posição do raid. Em 73 de 81 casts, o raid fica empilhado a ~24 jd dela, a
  ~15 jd para um lado, de 0 a +3 s; cruza entre +4 e +5 s; e fica ~15 jd do outro lado até +10 s. Ou
  seja, a primeira onda varre o lado em que o raid não está, e a segunda o outro. O lado é sorteado a
  cada cast (E→D 32 vezes, D→E 41), e no log não há nada que diga qual asa ela levantou: só dá para
  inferir o lado depois do fato, pela posição do raid em +1–3 s.
- **Ondas da Ula'tek na P2/P3 (1292211, cast de 4,5 s):** o raid fica parado a ~22 jd dela, quase
  sempre de um lado só. Há acertos de 0 a 3 s perto dela (a onda dela) e de 5 a 7 s onde o raid está, o
  que bate com a onda das caudas do lado oposto (76 jd a 13,5 jd/s ≈ 5,6 s). Faltam acertos para ver
  os buracos da parede.
- **Com a regra (`waves: { cast_id: 1298570 }`, `replay:check` de 12/11, 4 reports míticos, 40 pulls):**
  656 casts da cauda; 131 com onda, 519 sem acerto, 6 sem posição. 352 acertos: 236 com cast (51
  ambíguos, 21,6%) e 116 sem cast que explique (ondas da Ula'tek e Volatile Purge, com o mesmo dano).
  Design: [replay-cast-waves.md](designs/replay-cast-waves.md).

## Fora, e por quê

- **Ovos sem posição.** No heroico os ovos nem são unidades do log. No mítico, quem não toma dano não
  tem posição (117 de 272 no DVYR e 29 de 72 no pRJD) e fica fora do mapa.
- **Ovo vivo no wipe.** Ele sai na última linha que o cita, ainda no chão (3 de 272 no DVYR estavam a
  menos de 20 s do fim).
- **Ondas do Volatile Purge** (mítico, P3). Quem soakou o Serpent's Bite solta Caustic Waves numa
  seta quando a aura (1312967/1316356) sai. Só o kill mítico chegou à P3: 7 saídas e 6 acertos
  atribuíveis, sem padrão nem nos eixos do mundo nem na direção do player. Falta log, e o `waves` com
  aura só aceita ângulo fixo; a direção pelos acertos é só para gatilho por cast (o mesmo dano do
  `caustic_waves`).
- **Raio do Toxic Incubation** (mítico). O cast (1299759) da Ula'tek espectral não tem alvo no log
  (vai para o Wretch), e o Wretch não ganha aura nenhuma dela, então o `line` não tem ponta.
- **Grasping Fangs** (correntes do Warden). O `line` desenha só durante o cast, e as correntes ficam
  depois dele.
- **Casts sem forma:** Caustic Waves 1311807/1319282 (outros ids da onda, cujo dano já marca o chão),
  Spectral Coils 1308927 (o cast da cauda que chama os Coils), Writhing Gestation, Shadow Molt,
  Boiling Venom 1313758 (o timer de quando o add nasce). No BPR9 apareceram mais quatro, também sem forma:
  - Hardened 1299650: o escudo do ovo, que não pode ser levado enquanto está duro;
  - Venomous Heart 1299526: o canal do coração, que já está no mapa como add;
  - Defect: Weakened 1303410: estado do Ravenous Doomscale;
  - Call of the Serpent 1304012: o cast dos ovos que caem, cujo dano (1290409) já marca o chão.
- **Falhas no raid inteiro, sem forma (`ground: false`):**
  - **Mother's Wrath 1301122:** o alvo saiu do alcance da mordida.
  - **Unchecked Rage:** ninguém no corpo a corpo da Ula'tek. O log usa o id 1301007. O id do Journal, 1286945, nunca
    apareceu, e continua na regra junto com o 1301007.
  - No BPR9, o Unchecked Rage saiu em 3 de 6 wipes, a cada ~2,4 s depois que o tank morreu (fights 1 e 3) ou desde
    5,9 s num pull sem tank no corpo a corpo (fight 6). Nenhum nos 2 kills nem nos 6 wipes do DVYR.

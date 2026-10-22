# Replay do Twin Fangs e do Vashnik: o que foi medido

21/10/2026. Os dois bosses passaram pelo método do [replay-methods.md](replay-methods.md) depois do
Coiled Altar. Logs míticos: Twin Fangs de 01/10 (30 pulls), 05/10 e 08/10 (11 pulls, 2 kills);
Vashnik de 29/09 e 06/10 (10 pulls, 2 kills). Conferência final: `npm run replay:check` OK no Vashnik
e só casts conhecidos sem forma no Twin Fangs.

## Arena

| Boss | Resultado | O que mudou |
|---|---|---|
| Twin Fangs | o chão está certo: players 0,9% fora, Barbed Bulwark dentro | Vexhul, Ithraz e os Broodlings vivem no ácido em volta da plataforma; os Spawns de Vexhul, no poço do meio. Eles vão em `offFloor` |
| Vashnik | estava errada: o encaixe pelos pisões espalhou a raide pela sala inteira (17,7 px/jd, norte para cima), e a luta fica só na metade das fontes. A sala é girada no mundo (-58,4°): encaixada pelas três fontes, cada uma com um add que nasce nela (Shrouded Venom na de sombra, onde o boss é tankado; Burning Venom na de fogo; Clotting Venom na de sangue), e refinada pelas paredes (9,38 px/jd). Players fora do chão: 1,66% → 0,24%; boss e adds: 0% | `rotation: -58.37`, transformação fixa, contorno da sala desenhado (com o corredor da entrada), e as três fontes como `marks` |

## Twin Fangs

| Mecânica | Medida | Regra |
|---|---|---|
| Stone Breaker | o smash cai a 25 jd na frente do Ithraz (direção no fim do cast): o tank estava a 0,9 jd desse ponto na mediana (p90 1,9) em 365 smashes; nas 22 falhas, o player mais perto estava a 2 a 24 jd | `soak: { radius: 3, players: 1, ahead: 25 }`, `cast_id: 1288538` |
| Coiling Ichor | a aura nos players é 1290814 (a regra tinha o cast 1290809, e o círculo nunca aparecia); o DoT pega quem está a até 12 jd (Youden por pulso: 90% dos acertos, 14% dos de fora), igual nos 12 s | `area: { aura: 1290814, radius: 12 }` |
| Barbed Bulwark | no Mítico, cada orb do Caustic Deluge é esta unidade (269194), com o escudo 1303378 (o log repete o APPLIED); o log nunca a mata: quem pegou o orb estava a 4,5 jd na mediana, 99% até 8 jd, 2,9 s depois de nascer (até 14,2 s) | `units` com `replay`, `cleared_by: caustic_globule`, `lifetime_s: 15`; `unit_aura` com `absorb` e `stacks: false` |
| Blood Torrent | canal de 1 s no tank (aura 1303235), os orbs ganham o escudo ~2 s depois | `info` com o cast |
| Clotted Bolt, Concentrated Spittle | bolt no tank fora de alcance | `ground: false` |
| Stir the Depths, Vile Flood, Sanguine Storm | só o `cast_id` (o próximo cast aparece no quadro do boss) | — |

Fora, e por quê:
- **Ondas do Stir the Depths**: o log só tem a aura de quem a onda pegou; nem a onda nem a direção dela.
- **Feixe giratório do Vile Flood**: a direção do Vexhul só aparece no fim do cast; durante o canal,
  os acertos trazem a posição do alvo, não a dele.

## Vashnik

| Mecânica | Medida | Regra |
|---|---|---|
| Plague Froth | o DoT do marcado pega quem está a até ~5 jd (Youden 4,75 jd: 89% dos acertos, 7% dos de fora) | `area: { aura: 1281913, radius: 5 }` |
| Miasmic Coating | escudo de absorção no Shrouded Venom (aura 1312366, APPLIED repetido). Enquanto ele segura, o add não tem posição no log (~4 s): o motor o põe no primeiro lugar conhecido desde o começo da aura | `unit_aura` com `absorb` e `stacks: false` |
| Malignant Catalyst | cast 1282516 de 5 s; os círculos caem ~7 s depois do fim (12 s do começo) | `cast_id` no soak; o motor aceita o cast até 15 s antes |
| Malignance | pulso no raid do tumor que sobrou | `ground: false` |
| Plague Wave | as 4 ondas saem de cada marcado da Plague Froth quando a aura sai, nos eixos do mapa (norte, sul, leste, oeste): 264 de 273 acertos a até 2,5 jd de um desses raios (ângulos ao acaso: 176). A frente começa a ~4 jd e anda ~12,3 jd/s (o acerto mais longe: 57,6 jd em 4,4 s); de lado, até 2,9 jd | `waves: { aura: 1281913, directions: 4, angle: 0, start: 4, speed: 12.3, width: 6, duration_s: 5 }` |

Fora, e por quê:
- **Caustic Explosion**: o dano não cai com a distância de quem explode (~222k sem mitigação de 0 a
  55 jd, 4664 acertos). Um círculo diria "afaste-se" sem motivo.
- **Tumores (Malignant Totem, 269430)**: nenhuma linha deles tem posição (`SPELL_SUMMON`,
  `SPELL_CAST_START` e `UNIT_DIED` não trazem o bloco advanced); só os 5 que terminaram o cast de 85 s.
  Eles nascem em lotes de 24, em pares no mesmo lugar (o índice no fim do guid: 2k e 2k+1 a 1 jd), em
  lugares ao acaso numa grade de 1 jd. A hora da morte (a onda chegando) deixa ~12 lugares possíveis por
  tumor: não dá para desenhar sem chutar. O que entra: os que sobrevivem (os perigosos) aparecem no lugar
  certo desde que nasceram, com a barra do Malignance (`from_first_line`), e o quadro dos bosses mostra
  quantos estão vivos (`count`: pico de 24 a 37 por pull).
- **Swirlies da Stygian Infection**: o Stygian Burst não aparece nesses logs.

## Motor (vale para os próximos bosses)

- `soak.ahead`: círculo na frente de quem lança, um por cast.
- `units.cleared_by` / `units.lifetime_s`: unidade sem `UNIT_DIED` sai do mapa.
- `unit_aura.stacks: false`, e a unidade com aura aparece desde a aura.
- `offFloor` na arena e `scripts/arena-check.mjs` (com `--draw`).
- `replay:check` não conta `nil` (sem origem no log local) como unidade escondida.

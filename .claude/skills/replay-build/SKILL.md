---
name: replay-build
description: Monta e confere o replay de um boss — o que o boss faz aparece no mapa (frontais, chão, áreas, linhas, soaks, explosões, orbs, adds, fantasmas) e a arena por baixo — a partir de um log, com o `npm run replay:check`. Use quando o usuário pedir para "montar o replay", disser que "o replay não mostra X", que uma área/cone/fantasma está errado ou no lugar errado, pedir a arena de um boss, depois de cadastrar um boss novo (skill boss-rules) ou uma raide nova, ou colar um trecho de samples/replay/*.md.
---

# replay-build

Regra do projeto: **as habilidades do boss aparecem sempre no replay**. Se a habilidade tem forma
no chão, ela está no mapa; na dúvida, mostre (e marque o que é estimado). O `npm run replay:check`
faz a parte de número: cruza o log (dano do boss nos players, casts, unidades) com a regra do boss e
com a arena, e escreve `samples/replay/<data>-<boss>.md`. Esta skill cuida do que o script não
decide: **que forma** cada habilidade tem, **o tamanho** dela e **onde** ela fica.

**O replay é um motor para todos os bosses.** Antes de mexer, leia os princípios no topo de
`docs/replay-methods.md`. O essencial:
- **Boss é dado:** tudo sai da regra YAML ou de `data/*.json`. Se o boss pede algo novo, crie um campo
  genérico, nunca um `if` para ele.
- **O log manda:** meça comparando quem tomou com quem estava perto e não tomou.
- **A arena:** calibre pelo que não pode sair dela.
- **Ligar e desligar:** tudo pode ser desligado pelo usuário.
- **Ao terminar:** escreva o que aprendeu como regra em `docs/replay-methods.md`.

A regra do boss (`encounters/<raide>/<boss>.yaml`) é da skill `boss-rules`: ela decide o que é erro
e quem leva a culpa. Esta skill acrescenta, nas mesmas mecânicas, o que o replay desenha. Leia o
`references/schema.md` da `boss-rules` antes de escrever.

## O que o replay já mostra sem regra

Posições de todos (o log), mortes e ressurreições, a vida e os casts dos bosses (barra de cast real),
os world markers, defensivos de raide em área (`zone` em `data/defensives.json`) e debuffs nos
players. O que vem da **regra** é a forma das habilidades, e o que vem da **arena** é o mapa.

## Fluxo

1. **Relatório**: `npm run replay:check -- <WoWCombatLog.txt> --boss "<nome>" --difficulty Mythic` (precisa do `wipe-cli` em release: `cargo build --release -p wipe-core --bin wipe-cli`). Lê `samples/replay/<data>-<boss>.md`: os itens **REVISAR**/**ATENÇÃO**, a tabela "Dano do boss nos players" (cada spell: regra e o que desenha), os casts do boss sem regra e as unidades no mapa.
2. **Fontes da forma**, nesta ordem de confiança: o que o log comprova (atingidos, auras, contagens), o tooltip do Wowhead por spell e dificuldade (`https://nether.wowhead.com/tooltip/spell/<id>?dd=16`) e o guia da luta. O alcance de lançamento (300 jd, ilimitado) não é o raio da área.
3. **Resolver cada item** (abaixo), editando a regra do boss.
4. **Medir** cada tamanho no log, não no olho (ver "Medir").
5. **Validar**: `cargo test -p wipe-core` (o YAML vai embutido) e o `replay:check` de novo, até não sobrar REVISAR sem explicação. Depois, olhe no app: o pull mais longo na aba Replay (replay completo da luta), uma morte e uma falha com replay, e o clipe do Compartilhar. Forma que aparece no lugar errado é pior que forma nenhuma.
6. **Anotar** a auditoria do boss em `docs/<boss>-replay-audit.md` (modelo: `docs/coiled-altar-replay-audit.md`): mecânica → o que a fonte diz → o que o replay faz e por quê, separando o que é do tooltip, o que o log mostra e o que é inferido.
7. **Mostrar ao usuário** o relatório antes/depois e prints do replay. Commit e release só com o "pode subir" dele.

## Cada tipo de item

- **"<spell> … não está em nenhuma regra"**: leia a descrição. Tem forma no chão → mecânica nova com a forma (abaixo; tipo e culpa com a `boss-rules`). Dano no raid inteiro ou DoT que segue o player → `unavoidable` (contexto, sem forma). Spell de quem morreu ou de expirar um debuff (ex.: um golpe raro e alto) → confira no log quem tomou e quando antes de decidir.
- **"… está na regra … mas não desenha nada"**: dano no raid → `ground: false`; senão a forma que falta.
- **"casts do boss sem regra"**: cast que vira frontal, linha ou área no guia → `cone`/`line`/`area` com esse `cast_id`. Cast que é só estado ou outro id da mesma habilidade (o cast tem id diferente do dano) → nada a fazer; anote na auditoria.
- **"<unidade> … não aparece no mapa"**: add que importa (matar, desviar das linhas) → `units` com `replay: true`; o perigo é em volta dela → `area: { npc, radius }`.
- **"Sem arena" / "encaixe abaixo de 0,9"**: seção "Arena".
- **Fantasmas** (`detect.gaze`): o caminho é simulado. Quando o usuário disser que estão errados, seção "Unidades que o log não mostra".

## Formas (releia a descrição de cada habilidade)

- **Frontal / cone / "na frente do boss"** → `cone: { cast_id, half_angle, range }` na mecânica. O cone aponta para o alvo do boss durante o cast; boss que não bate corpo a corpo precisa de `target_spells` (um spell que só vai no alvo dele, ex.: o Dread Bolt do Malacrass). Sem tamanho na fonte, comece em 40°/40 jd e meça com os atingidos (ângulo e distância até o boss no `SPELL_CAST_SUCCESS`). A direção do boss no log pode estar errada (90° num Sever): use também a do alvo.
- **Área em volta de alguém ou de uma unidade** (raio em volta de quem carrega algo; unidade que gira pela sala) → `area: { aura | npc, radius }`. Dano em quem está perto de quem tem um debuff (`avoidable_damage` com `excludes_aura`: splash do orb, bomba) quase sempre é `area: { aura: <o excludes_aura> }`. `keep_unit: true` mantém a unidade desenhada.
- **Deixa algo no chão** (poça, gota, rastro, círculo, projétil que cai) → `ground` nos `damage_ids` (padrão em `avoidable_damage`, `soak`, `positioning`, `spread`); em outro tipo, `ground: true`; poça que fica, `ground: { lingers_s: N }`; só em algumas fases, `ground: { phases: [...] }`; DoT que segue o player, `ground: { dot: true }`.
- **Unidade do boss que some** (machado que para, add que despawna sem morrer no log) → `area.vanish: { idle_s, from }`. Antes de dizer que algo some numa fase, confira no log.
- **Add que precisa ser interrompido** → basta a regra `interrupt` com o `cast_id` certo: o add entra com a barra de cast e some depois do último cast.
- **Linha do lançador até o alvo** → `line: { cast_id, width, target_aura }`.
- **Soak** (players precisam estar onde cai) → `soak: { radius, players }`; o círculo do soak substitui as marcas de chão da mesma mecânica (tire o `ground`). Explosão depois do soak (um disco grande em volta) → `blast`.
- **Orbs de carregar e largar** → `detect.orbs` (veja o schema): desenhados pela própria regra. Os que sobram até um cast de `cleared_by` (o Toxic Deluge) ganham a contagem até a explosão; os que somem com o boss zerando (`cleared_on_zero`) não, porque isso depende do dano da raide.
- **Fragmentos para pegar** (quem tem o debuff pega N coisas no chão; cada uma tira 1 stack) → `pickup: { aura, hit_ids }`: `aura` é o debuff de quem pega, `hit_ids` o acerto ao pegar. O log não põe os fragmentos no chão: no mapa cada um fica onde foi pego, desde que o dono ganhou o debuff, na cor dele.
- **Poça que o boss abre em lugares fixos da sala** (sai das laterais, das bocas, dos cantos; o log só mostra quem pisou) → `pool: { cast_id, delay_s, duration_s, grow_s, shapes: [{ centers: [[x, y], ...], radius }] }`, um `shapes` por vez que o cast sai (o último vale para as seguintes), centros nas coordenadas do log. Meça com busca de centro e raio cruzando quem tomou tick com quem estava perto e não tomou (só os ticks enganam: mostram onde a raide estava). A poça some na troca de fase.
- **Escudo ou véu num inimigo** (stacks que a raide tira, absorb que tem que quebrar) → `unit_aura: { aura, absorb }`: anel em volta da unidade, uma marquinha por stack e, com `absorb: true`, quanto já absorveu (soma do `SPELL_ABSORBED` com esse spell). Add com vida que importa: `units` com `replay: true` também guarda a vida dele (a barra embaixo no mapa).
- **Contagens e o que vem**: soak, explosão (`blast`) e área em volta de quem tem um debuff mostram sozinhos o arco que fecha e os segundos; o próximo `cone` aparece tracejado 5 s antes, e o próximo cast de um add (`replay: true`) 10 s antes. Nada a configurar.
- Só fica de fora o que não tem forma no chão (dano no raid inteiro, DoT que segue o player).

## Medir

- **Raio de área**: `wipe-cli radius <log> --damage <id> (--aura <id> | --npc <id>)` mostra a distância de cada atingido até o portador ou a unidade mais perto, num histograma por jarda: o raio é onde a contagem despenca (os golpes mais longe vêm de outros centros). Ex.: Mutagenic Venom cai de 92 para 33 na jarda 6; Axegrinder tem 90% até 5,6 jd (raio 4).
- **Soak**: `wipe-cli radius <log> --damage <id> --soak` (players por soak e distância ao meio).
- **O log dá contagens: use antes da geometria.** Stacks que o raid ganha por orb quebrado dizem quantos quebraram; isso vale mais que reconstruir pela posição.
- **Hotfix de tamanho**: o valor novo no campo e o antigo em `before: [{ until, … }]` (UTC), para os logs velhos continuarem certos.

## Arena

A imagem de fundo e o chão andável de cada boss ficam em `data/arenas.json` (fora das regras: um boss sem regra pode ter arena). Para um boss novo:
1. Ache a imagem no raidplan.io (`/plan/create?raid=wow.<expansão>.<raid>&boss=N`; a URL do mapa aparece nos recursos da página, `cdn.raidplan.io/raid/.../map/...jpg`). O app carrega da CDN na hora, como os ícones do Wowhead; a imagem não entra no repositório.
2. `wipe-cli positions <log>` em logs com o boss (onde os players pisaram) e junte por boss.
3. Marque o chão em `scripts/arena-fit.mjs` (polígono na imagem com 1224 de largura, `holes` para buracos; ou `hazard` com amostras da cor do perigo; `disk`/`holeDisk` para sala redonda com poço; `core` quando o raid sai da sala principal) e rode. Ele acha escala e posição com o norte para cima (X do log = norte, Y = oeste; o Twin Fangs, sem simetria, confirmou) e grava uma imagem de conferência por boss: os pisões têm que cair no chão, inclusive em detalhes (pontes, poço). Nota acima de ~0,9.
4. **Confira o tamanho com o que nunca sai da arena** (orbs, fantasmas, machados, adds): todas as posições deles no log têm que cair dentro do chão. Os pisões sozinhos encolhem a plataforma quando a raide evita a borda (no Coiled Altar o encaixe deu 83 jd e orbs e fantasmas iam até 100,8). Se algo fica fora, meça a largura pelos extremos dessas unidades e trave em `spanYd` no `arena-fit.mjs` (a escala fica fixa, só a posição é procurada). Só players podem aparecer fora, e aí estão caindo.
5. Copie o resultado para `data/arenas.json`. Se a versão da imagem no raidplan mudar (`-vNNN`), atualize a URL e reencaixe.

## Unidades que o log não mostra

O log não registra o caminho de algumas unidades (machados entre um golpe e outro, fantasmas que perseguem um player). O caminho é estimado e o replay marca o que é estimado (tracejado, esmaecido).
- **Machados e afins**: posição entre aparições é estimada; quem passa por dentro sem levar dano desmente (o replay apaga), e o que para de acertar some (`vanish`).
- **Fantasmas** (`detect.gaze`, `crates/wipe-core/src/gaze.rs`): calibre contra o que o log comprova (alcances, colisões, fantasmas limpos por frontal): `WIPE_GAZE_DUMP=<pasta> wipe-cli analyze <log>` grava cada pull, e `node scripts/ghost-calibrate.mjs <pasta>... --grid=1 | --fine=1` mede os parâmetros (velocidade, cone, espera, parada) contra eles. Confira cada dia separado antes de trocar (evita sobreajuste) e anote a tabela na auditoria do boss.

## Regras

- Na dúvida, mostre; o que é inferido aparece como estimado, nunca como certo.
- Nunca invente um id ou um tamanho: id pelo log ou pelas fontes da `boss-rules`; tamanho medido no log (tooltip só como ponto de partida).
- Confirme o que o usuário conta no log, e o que o log mostra com o usuário: os dois pegam erros um do outro.
- Nomes de habilidades e bosses em inglês; textos na tela em pt-BR e inglês na mesma mudança.
- Mudança numa forma que já existe: compare antes e depois em vários logs (falhas, culpados, o que o replay desenha); toda mudança tem que ter explicação no log.

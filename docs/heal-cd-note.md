# Note de CDs de cura — regras

Como o wipe-cause confere a note de cooldowns que o líder escreve para o addon do grupo (NSRT, a
note que o MRT mostra na tela). Design: [designs/heal-cd-note.md](designs/heal-cd-note.md). A
referência de healer segue a [análise de healer](healer-analysis.md) (regra 2: os healers da
guilda nunca são o "certo").

Estado: as três etapas do design (note e timing; golpes e uso; overheal e note sugerida).

## 1. Onde aparece

- **Resumo do boss** (foco Guilda): seção "CDs de cura", depois dos tempos de fase, com uma tabela
  por versão da note: por linha, quantos pulls foram "na hora" entre os que chegaram nela e o Δ
  mediano.
- **Aba "CDs de cura" do pull**: a mesma tabela para um pull, com o estado de cada linha e o Δ
  (entre parênteses, o Δ sem o desvio da fase).
- **Aba Interrupts**: a mesma caixa da note. A escala de interrupts sai só do bloco
  `intstart`…`intend`.

## 2. A note

Formato NSRT, uma linha por CD, campos `chave:valor` separados por `;`:

```text
EncounterID:3429;Name:Coiled Altar 2;Difficulty:Mythic
time:47;ph:1;tag:Fulano;spellid:97462;
time:15;ph:2.5;tag:everyone;text:Personals;
intstart
Fulano Ciclano
intend
```

- `time`: segundos desde o início da fase `ph` (`1`, `2`, `2.5`). `tag`: nome do player ou
  `everyone`. `spellid`, `text` e `glowunit` ficam como vieram.
- Exportar a note devolve o texto da caixa igual; mudar uma linha reescreve só o `time` dela.
- **Escala de interrupts:** com o bloco `intstart`…`intend`, sai só dele; note NSRT sem o bloco
  não gera escala; texto que não é NSRT é lido inteiro, como antes.

## 3. Versões

A note muda entre as tries enquanto os CDs são montados, e cada pull é julgado pela versão que
valia nele.

- A **chave atual** (`wipe-cause:assignments:<encounter>:<dificuldade>`) guarda o texto puro da
  versão mais nova (a escala de interrupts, o placar, o Discord e a IA leem dela). As versões ficam
  em `wipe-cause:heal-note:<encounter>:<dificuldade>` (até 20).
- A caixa grava a cada mudança na versão mais nova. Se a mais nova é de outra noite (a note colada
  depois da noite), a primeira edição cria uma versão da noite aberta. O botão **Nova versão**
  copia a mais nova: clique antes de editar quando a note mudar entre as tries.
- **A partir do pull N** (padrão): com outra versão na mesma noite, ou com o relatório ao vivo, o
  pull seguinte ao último; senão, o primeiro pull com todos os players da note na raide. O líder
  troca N na tela; enquanto não troca (e fora do ao vivo), N é recalculado a cada edição.
- Pull sem versão da noite usa a versão da noite anterior mais recente; sem nenhuma, fica fora.
- A noite de uma versão é a data local do primeiro pull do boss no relatório (`startMs` +
  `tzOffsetHours`).

## 4. Fases e desvio

- `ph:n` é a fase `p<n>` da regra do boss (`phases` em `encounters/`); `ph:n.5` é a fase sem
  `p<n>` logo depois dela (a intermissão). Boss sem `phases`: `ph:1` é o pull inteiro. A convenção
  vem da note da guilda (não há documento do NSRT); o topo da seção mostra o casamento.
- **Desvio:** o addon troca de fase por um evento que o combat log não mostra com garantia. O app
  casa cada linha com o cast mais perto do player (a até 30 s) e mede, por fase, a mediana de
  (uso − hora da note). O desvio é aplicado quando há 5 pares em pelo menos 2 pulls e ele fica
  até 12 s; a primeira fase nunca recebe desvio (addon e app começam juntos). Um desvio estável é
  o relógio do addon ou um atraso de todos ao mesmo tempo: o app não separa os dois.
- Medido em 2026-10-27/28 no The Coiled Altar Mythic (noites de 21, 22 e 26/10): P1 −0,1 s; P2
  +6,7 / +9,0 / +8,6 s. Com o desvio, "na hora" no P2 foi de 64% para 84% das linhas casadas.

## 5. Estados de cada linha

Na ordem; vale o primeiro:

| Estado | Quando |
| --- | --- |
| não avaliada | sem `spellid`, `tag:everyone`, nome que não é player da noite ou `ph` sem fase |
| fora do pull | o player é de outro pull da noite |
| fase não alcançada | o pull não chegou na fase |
| a fase acabou antes | a hora passa do início da fase seguinte (o addon não toca o lembrete) |
| depois do corte | a hora passa do corte de mortes ou do fim do pull |
| sem a spell | a spec do player não tem o CD; ou CD de talento (ou fora da tabela) que ele não usou na noite (aviso "nunca usada na noite") |
| na hora | uso a até 10 s da hora ajustada |
| adiantado / atrasado | uso de 10 a 30 s antes ou depois |
| morto antes | sem uso, e morreu antes da hora sem castar nada depois (castar de novo = foi ressuscitado) |
| não usou | sem uso a até 30 s |

O casamento usa o id da spell e os alternativos da tabela (Stampeding Roar pelos ids das formas,
Convoke 323764) e casa primeiro o par de menor diferença.

## 6. Golpes, momentos e uso

O núcleo guarda, por segundo e até o corte, a raide sem tanks (`raidSeries`: vivos, abaixo de 50%,
vida máxima e dano inevitável), o dano inevitável por spell inimiga (`enemyHits`) e a cura dos CDs
da tabela (`PlayerStats.cdHeals`). Inevitável = o que a regra do boss não trata como falha (o mesmo
critério da aba Mortes), com absorb e com o golpe absorvido inteiro. Sem vida no log (sem advanced
logging), não há golpes nem raide baixa.

- **Golpe** (`src/lib/raidHits.ts`): 5 s com dano inevitável ≥ `STRONG_HIT_SHARE` (0,80) da vida
  máxima somada; começa no primeiro segundo com 20% do dano da janela. É preso ao cast do boss:
  o da própria spell que fez o golpe (até 15 s antes) ou o mais perto entre os marcos da noite
  (`<spell>:<k>`, k contado no pull).
- **Momento da noite:** chave que foi golpe em pelo menos 2 pulls. Todo pull que chegou no cast tem
  o momento, mesmo quando um CD segurou o dano abaixo do limite.
- **Raide baixa:** um quarto ou mais dos vivos sem tanks abaixo de 50% por 2 s ou mais; "sem golpe"
  quando fica longe de qualquer momento (sinal para olhar a cura de base).
- **Veredictos** (`judgeUse` em `src/lib/healNoteCheck.ts`):
  - a linha cobre o momento pela hora ajustada e pelo efeito do CD (redução ativa quando o dano
    começa; rajada de 2 s antes a 8 s depois; cura que dura antes, se ainda ativa, ou até 8 s
    depois);
  - **no golpe:** o uso também cobriu; **fora do golpe:** a linha está no lugar, o player não;
  - **sem dano:** cura (só `heal`) sem golpe nem raide baixa na janela; redução de dano não recebe;
  - **uso de ciclo:** linha sem momento cuja próxima linha do mesmo CD tem momento e não estaria
    pronta se esta saísse no momento seguinte; não recebe veredicto de uso;
  - **golpe sem CD:** momento alcançado sem nenhuma linha da note ligada a ele.
- **Calibração:** `node scripts/heal-note-calibrate.mjs <relatório.json> [--boss] [--note]` mostra
  a distribuição e quantos golpes, momentos e momentos com CD cada limite dá. 26/10 (The Coiled
  Altar Mythic, note da guilda): 5 s / vida máxima p50 0,46, p90 0,73, p95 0,85; limite 0,80 → 3,7
  golpes por pull, 16 momentos, 14 com CD da note; 0,60 → 6,7 golpes por pull, 18 momentos. O
  desenvolvedor manteve 0,80 (2026-10-28).

## 7. Overheal e note sugerida

- **Overheal do uso** (`overhealOfUse`): overheal ÷ (cura + overheal) dos `heal_ids` do CD em
  `cdHeals`, na janela do "sem dano". CD sem `heal_ids` (Convoke, Apotheosis) não tem overheal.
- **Régua** (`refOverheal`): as referências de fora que a análise de healer escolhe para o player
  (`selectHealRefs`: mesma quantidade de healers, sem os logs distorcidos), com o overheal de cada
  `heal_id` em `cdSpells` (média pela fatia de cura). Com 3 ou mais, a faixa p25–p75; **alto** =
  acima do p75 + 0,15 (`OVERHEAL_MARGIN`, o mesmo da dica de overheal do healer). Com menos, só o
  número.
- **Noite e pull:** na noite, a soma dos overheals ÷ a soma das curas de todos os usos do player com
  o CD, contra as referências do pull mais recente; na aba do pull, o uso daquele pull, com a noite
  ao lado sem cor.
- **Empilhado:** duas ou mais curas com `heal_ids` ligadas ao mesmo momento no pull; o rótulo vai
  em quem tem overheal alto. Redução de dano não é julgada (o log não mostra quanto ela evitou).
- **Note sugerida** (`suggest`, por versão, no resumo do boss): mudanças de um passo, só em fase
  com desvio aplicado (ou na primeira), com 3 pulls ou mais que chegaram no momento (ou na linha) e
  o problema em metade deles ou mais. A conta de cooldown usa o início mais cedo de cada fase entre
  os pulls (o pior caso, num push rápido).
  - **Adicionar** num golpe sem CD: a lista dos CDs livres (da tabela, de players com linha na
    note, da spec deles e, se for talento, castado na noite), cuja linha anterior do mesmo player e
    CD está a mais de um cooldown antes e a próxima a pelo menos um cooldown depois. `time` = hora
    do momento − 2 s (`PREP_MS`) para `active` e `sustained`, a própria hora para `burst`. Ao lado,
    quantas referências de fora usam o CD naquele marco (só informação). O líder marca um por golpe.
  - **Mover** uma linha (fora de uso de ciclo) usada na hora mas sem momento em metade ou mais dos
    pulls: para o momento da mesma fase mais perto, a até 30 s, se a cadeia do player continua
    cabendo no cooldown. Não troca a `ph`.
  - Descartadas: mudança que não troca o `time` e `time` negativo (o golpe cai antes do início da
    fase no relógio do addon; com o desvio de +8,6 s do P2, o golpe da virada não cabe em `ph:2`).
  - **Copiar** devolve a note colada só com as mudanças marcadas (as outras linhas iguais); sem
    acesso à área de transferência, a note aparece numa caixa para copiar à mão.
- Conferido em 26/10 (The Coiled Altar Mythic, note da guilda, 18 pulls): uma mudança, mover o
  Rallying Cry de P1 +47 s para +44 s (golpe da Venom Rupture depois do 1º Guillotine, fora em 11
  de 18 pulls); nenhum golpe sem CD com 3 pulls e metade com o problema; overheal da noite: Divine
  Hymn 81% e 78% (referências 34–66%), Tranquility 62% (55–73%), Rewind 24% (17–21%).

## 8. A tabela de CDs

`data/heal-cooldowns.json`: por CD, specs, talento, ids alternativos, tipo (`heal` ou
`mitigation`), efeito (`burst`, `sustained`, `active`), duração, cooldown base e ids da cura.

- O timing vale para toda linha com `spellid` e player, esteja ou não na tabela.
- **Conferência no fluxo das referências de healer** (`scripts/rotation/heal-bench.mjs`, relatório
  "Tabela de CDs de cura"): cura de CD que nenhuma referência da spec tem → ATENÇÃO; CD de 60 s ou
  mais da rotação, castado nas referências e fora da tabela → REVISAR. Entrada sem `kind` = spell
  conhecida e fora dos CDs de raide (Stampeding Roar só pelos `alt_ids`; Nature's Swiftness, Divine
  Toll, Power Infusion, Halo, Holy Word: Serenity, Stasis, Tip the Scales).
- Antes de gravar `cdSpells` (2026-10-28), as `spells` das referências (só as 12 maiores curas)
  tinham a cura do CD em: Tranquility 8/8 em todos os bosses; Rewind de 0/8 a 8/8; Revival 0–1/8;
  Divine Hymn 0–1/8; Healing Tide Totem e Ascendance 0/8. Com `cdSpells`: Tranquility, Divine Hymn,
  Rewind e Ascendance em todas; Revival em 42 + 24 de 66 (os dois ids).
- A cura da Ascendance nas referências é Restorative Mists (294020), não 114083 (2026-10-28,
  conferida pelo relatório; a aura não foi conferida). Healing Tide Totem não aparece em nenhuma
  referência porque nenhuma castou (ATENÇÃO esperado).
- Ficam REVISAR para o desenvolvedor: Ultimate Penitence (Discipline) e Celestial Conduit
  (Mistweaver) são CDs de raide, mas faltam efeito, duração e cura medidos.
- `cooldown_ms`, `duration_ms` e `alt_ids` repetem números das rotações e do
  `data/defensives.json`; `crates/wipe-core/tests/heal_cooldowns.rs` confere a cópia.
- Durações conferidas na aura do CD nos logs de 26/10 (2026-10-28): Apotheosis 32 s, Avenging
  Wrath 24 s, Zephyr 8 s, Rewind 3,6 s; Tranquility e Convoke ficam com o canal da rotação; a aura
  do Ascendance mistura os procs do talento, então fica a duração base. Curas exclusivas
  confirmadas: Divine Hymn 64844, Rewind 363534.

## Decisões

- 2026-10-27: dois veredictos, "na hora da note" (relógio, ±10 s) e "no golpe" (etapa 2).
- 2026-10-27: raide baixa = um quarto dos vivos sem tanks abaixo de 50%; golpe e raide baixa são
  parâmetros da luta e podem ser calibrados nos logs da guilda (não são referência do healer).
- 2026-10-27: a note colada é a base da note sugerida; só mudanças de um passo.
- 2026-10-27: uma caixa só para a note (CDs e interrupts), com versões.
- 2026-10-28: limite do golpe em 0,80 da vida máxima (calibração de 26/10).

## Para depois

Externos em tank, formato MRT clássico, conferir `glowunit`, trocar à mão o par `ph` → fase,
escolha automática do CD no "adicionar". Detalhes no design.

# Note de CDs de cura — regras

Como o wipe-cause confere a note de cooldowns que o líder escreve para o addon do grupo (NSRT, a
note que o MRT mostra na tela). Design: [designs/heal-cd-note.md](designs/heal-cd-note.md). A
referência de healer segue a [análise de healer](healer-analysis.md) (regra 2: os healers da
guilda nunca são o "certo").

Estado: etapas 1 (note e timing) e 2 (golpes e uso). Overheal e note sugerida entram na etapa 3 do
design.

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

## 7. A tabela de CDs

`data/heal-cooldowns.json`: por CD, specs, talento, ids alternativos, tipo (`heal` ou
`mitigation`), efeito (`burst`, `sustained`, `active`), duração, cooldown base e ids da cura.

- O timing vale para toda linha com `spellid` e player, esteja ou não na tabela.
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

## Para depois

Externos em tank, formato MRT clássico, conferir `glowunit`, trocar à mão o par `ph` → fase,
escolha automática do CD no "adicionar". Detalhes no design.

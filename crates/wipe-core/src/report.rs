//! Estruturas de saída da análise, serializadas para a UI (camelCase).

use crate::i18n::Text;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogReport {
    pub file: String,
    pub log_version: Option<u32>,
    pub advanced_logging: bool,
    pub lines: u64,
    pub parse_ms: u64,
    pub pulls: Vec<Pull>,
    /// "Ignorar eventos após N mortes" usado na análise (0 = sem corte)
    pub death_cutoff: u32,
    /// Wipes com menos de 30s descartados (pull falso / reset)
    pub ignored_short_pulls: u32,
    /// Erros ao carregar regras de boss (YAML inválido etc.)
    pub rule_errors: Vec<String>,
    /// Análise do Warcraft Logs: logs do PC usados no lugar do download (mais barato)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub local_logs: Vec<String>,
    /// Análise do Warcraft Logs: pulls que vieram de lá (os outros saíram do log do PC)
    #[serde(skip_serializing_if = "is_zero")]
    pub wcl_pulls: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    /// Índice do pull no log (0..)
    pub id: usize,
    pub encounter_id: u32,
    pub encounter_name: String,
    pub difficulty_id: u32,
    pub difficulty_name: String,
    pub group_size: u32,
    /// encontro de masmorra (M+, delve…): o app é para raid, fica à parte na interface
    pub dungeon: bool,
    /// Número do pull para este boss + dificuldade no log (1..), sem os pulls curtos descartados
    pub pull_number: u32,
    /// Mesmo número contando os pulls curtos — é a numeração do Warcraft Logs ("Wipe N")
    pub pull_number_all: u32,
    /// Epoch ms (UTC quando o log tem offset de fuso)
    pub start_ms: i64,
    /// Timestamp original da linha ENCOUNTER_START (hora local do jogo)
    pub start_local: String,
    pub tz_offset_hours: f64,
    pub duration_ms: i64,
    /// Momento (ms do pull) da N-ésima morte: estatísticas param de contar aqui
    pub cutoff_t: Option<i64>,
    /// Tempo usado nas médias (DPS/HPS): até o corte, ou o pull inteiro
    pub analyzed_ms: i64,
    pub success: bool,
    /// ENCOUNTER_END não encontrado (log cortado / desconectou)
    pub incomplete: bool,
    pub bosses: Vec<BossState>,
    /// boss de várias fases (`hp` nas fases da regra): a vida somada dos bosses da fase em que o
    /// pull acabou, como o Warcraft Logs mostra (P2 = Malacrass; P3 = Zul'jan + Malacrass)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_hp_pct: Option<f32>,
    /// o mesmo no corte ("ignorar após N mortes"), na fase em que o corte caiu
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_hp_pct_at_cutoff: Option<f32>,
    /// quantas fases o boss tem (regra com `phases`), para o progresso de cada pull na luta toda
    #[serde(skip_serializing_if = "is_zero")]
    pub phase_count: u32,
    pub players: Vec<PlayerStats>,
    pub deaths: Vec<Death>,
    pub enemy_spells: Vec<EnemySpell>,
    /// Arquivo de regras usado (encounters/*.yaml), se houver para este boss
    pub rules_file: Option<String>,
    /// Resultado das regras do boss, falhas primeiro
    pub mechanics: Vec<MechanicResult>,
    /// Falha de mecânica que puxou as mortes do wipe, quando dá para apontar
    pub trigger: Option<PullTrigger>,
    /// player que gravou o log (flag "meu" do combat log); no Warcraft Logs não tem
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_guid: Option<String>,
    /// posições de players e bosses nas janelas dos replays (mortes e falhas de mecânica)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracks: Option<PullTracks>,
    /// onde cada acerto de mecânica "de chão" caiu, nas janelas dos replays
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground: Option<PullGround>,
    /// chão da arena: onde algum player pisou durante o pull (o log não tem o mapa)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arena: Option<Arena>,
    /// casts dos bosses nas janelas dos replays
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub casts: Vec<BossCast>,
    /// de onde o pull veio (para reler sozinho no replay completo); vazio no Warcraft Logs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_offset: Option<u64>,
    /// quando cada fase começou (regra do boss com `phases`)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub phase_marks: Vec<PhaseMark>,
    /// replay completo (só quando o pull é relido sozinho)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fight: Option<FightData>,
    /// replay completo: orbs no chão e carregados (regra com `orbs`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orbs: Option<OrbTracks>,
    /// replay completo: áreas das habilidades do boss (regra com `area`)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub areas: Vec<AreaView>,
    /// soaks (regra com `soak`): onde cada um caiu e quantos entraram
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub soaks: Vec<SoakView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub blasts: Vec<BlastView>,
    /// marcas de chão do grupo (world markers) durante o pull
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markers: Vec<WorldMarker>,
    /// tempo de cast típico (ms) de cada spell dos inimigos, medido nos casts que terminam no log
    /// inteiro: a barra de um cast cortado para no ponto em que foi cortado
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub cast_ms: std::collections::BTreeMap<u32, i64>,
}

/// Marca de chão (world marker): qual (0-7, a ordem do /wm: quadrado azul, triângulo verde, losango roxo,
/// X vermelho, estrela amarela, círculo laranja, lua, caveira), onde e de quando até quando no pull (0 =
/// já estava no chão no começo).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorldMarker {
    pub marker: u8,
    pub x: f32,
    pub y: f32,
    pub from: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<i64>,
}

/// Um soak no replay: aparece em `from` (começo do cast que o anuncia) e cai em `at`, no meio de quem
/// foi atingido.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoakView {
    pub key: String,
    pub name: String,
    pub spell_id: u32,
    pub from: i64,
    pub at: i64,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    /// quantos precisavam entrar (regra) e quantos entraram
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<u32>,
    pub hit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caster: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlastView {
    pub key: String,
    pub name: String,
    pub spell_id: u32,
    pub from: i64,
    pub at: i64,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub timing_estimated: bool,
}

/// Orbs no replay completo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbTracks {
    pub kinds: Vec<OrbKindView>,
    /// distância em que dois orbs se tocam (o raio do roxo mais a folga)
    pub contact_yd: f32,
    /// (de, até, x, y em décimos de jarda, tipo)
    pub ground: Vec<(i64, i64, i32, i32, u8)>,
    /// (player, de, até, tipo)
    pub carries: Vec<(String, i64, i64, u8)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbKindView {
    pub name: crate::i18n::Text,
    /// explode quando outro orb chega perto (o roxo)
    pub volatile: bool,
}

/// Área de uma habilidade do boss: em volta de quem tem um debuff, ou de uma unidade do boss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaView {
    /// chave e nome da mecânica
    pub key: String,
    pub name: String,
    pub spell_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npc: Option<u32>,
    pub radius: f32,
    /// a unidade some depois de tanto tempo sem acertar ninguém perto dela, a partir de `vanish_from` (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vanish_idle_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vanish_from: Option<i64>,
    /// a unidade continua desenhada como sempre (ex.: o boss), com o círculo em volta
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub keep_unit: bool,
}

/// Começo de uma fase do boss.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseMark {
    pub t: i64,
    pub key: String,
    pub name: String,
}

/// Replay completo: o que o mapa, o quadro do raid e o painel do player focado precisam (ver `fight.rs`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FightData {
    /// guids dos players, na ordem dos índices usados em `hp`, `auras` e `events`
    pub players: Vec<String>,
    /// nomes de fontes e alvos dos eventos
    pub sources: Vec<String>,
    /// nome de cada spell que aparece
    pub spells: std::collections::BTreeMap<u32, String>,
    /// spells das regras do boss -> chave da mecânica (debuff crucial, dano de mecânica)
    pub rule_spells: std::collections::BTreeMap<u32, String>,
    /// vida de cada player: (t, %)
    pub hp: Vec<Vec<(i64, u8)>>,
    pub auras: Vec<FightAura>,
    /// mudanças de stack das auras: (player, spell, t, stacks); sem entrada, a aura tem 1 stack
    pub stacks: Vec<(u16, u32, i64, u32)>,
    pub events: Vec<FightEvent>,
    /// vida dos bosses ao longo do pull
    pub bosses: Vec<FightBoss>,
    /// dano feito: (segundo, player, alvo em `sources`, valor), somado por segundo
    pub done: Vec<(u32, u16, u16, i64)>,
    /// cura feita e recebida: (segundo, player, valor)
    pub healed: Vec<(u32, u16, i64)>,
    pub heal_in: Vec<(u32, u16, i64)>,
    /// defensivos de raid em área (AMZ, Darkness, Spirit Link...)
    pub zones: Vec<FightZone>,
}

/// Defensivo em área no replay completo: onde ficou (coordenadas do log), raio e quando.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FightZone {
    pub t: i64,
    pub end: i64,
    pub spell_id: u32,
    /// índice em `players`
    pub caster: u16,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

/// Vida de um boss no replay completo: (t, por mil da vida máxima).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FightBoss {
    pub guid: String,
    pub name: String,
    pub max_hp: i64,
    pub hp: Vec<(i64, u16)>,
}

/// (player, spell, início, fim, maior número de stacks, 1 = debuff de inimigo / 0 = defensivo)
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FightAura(pub u16, pub u32, pub i64, pub i64, pub u32, pub u8);

/// (t, tipo, player, spell, valor, fonte ou alvo) — tipos em `fight.rs` (EV_*); valor: dano/cura,
/// ou o spell cortado (interrupt) / a aura tirada (dispel)
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FightEvent(pub i64, pub u8, pub u16, pub u32, pub i64, pub u16);

/// Cast de um boss (para o replay): começo, fim e para onde ele olhava quando terminou.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossCast {
    pub t: i64,
    /// fim do cast com tempo (null = instantâneo, ou não terminou)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<i64>,
    pub guid: String,
    pub spell_id: u32,
    pub name: String,
    /// direção do boss no fim do cast (radianos, no mesmo sistema das posições)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facing: Option<f32>,
    /// cortado (interrupt)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub interrupted: bool,
    /// quem cortou (guid do player)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupted_by: Option<String>,
    /// o lançador estava com um efeito que aumenta o tempo de cast (Curse of Tongues...): quanto, em %
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slow_pct: Option<u8>,
    /// frontal em cone (regra do boss): o replay desenha a área no fim do cast
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cone: Option<ConeShape>,
    /// frontal: o alvo do boss (o cone aponta para ele durante o cast); sem alvo, vale `facing`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// linha do lançador até o alvo (regra do boss): o replay desenha durante o cast
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<LineShape>,
}

/// Linha: largura (jardas).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineShape {
    pub width: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConeShape {
    /// meio ângulo (graus) e alcance (jardas)
    pub half_angle: f32,
    pub range: f32,
}

/// Células (`cell_yd` de lado) em que algum player esteve no pull: desenham o chão da arena.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Arena {
    pub cell_yd: f32,
    /// (coluna, linha): a célula cobre [c, c+1) × [l, l+1) vezes `cell_yd`
    pub cells: Vec<(i32, i32)>,
}

/// Marcas no chão para os replays: o log não mostra poças nem gotas, mas mostra onde estava
/// cada player atingido por elas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullGround {
    pub kinds: Vec<GroundKind>,
    /// (t, x, y em décimos de jarda, índice em `kinds`)
    pub marks: Vec<(i64, i32, i32, usize)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundKind {
    /// chave da mecânica
    pub key: String,
    pub name: String,
    /// spell do acerto (ícone)
    pub spell_id: u32,
    /// quanto a marca fica no chão
    pub linger_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_cell_yd: Option<f32>,
}

/// Posições (advanced logging) só nos trechos que algum replay usa, em passos fixos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullTracks {
    /// ms entre duas posições de um trecho
    pub step_ms: i64,
    pub units: Vec<UnitTrack>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitTrack {
    pub guid: String,
    pub name: String,
    /// "player" | "enemy" | "ghost" (caminho simulado, ver `gaze.rs`)
    pub kind: String,
    pub segs: Vec<TrackSeg>,
    /// fantasma: o player que ele persegue
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// fantasma: daqui em diante o caminho foi puxado até onde o log diz que ele estava
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_from: Option<i64>,
    /// unidade de área (machado): passos (t / step_ms) em que o log mostrou onde ela estava; entre um e
    /// outro a posição é estimada
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seen: Option<Vec<u32>>,
}

/// Trecho contínuo: posições a cada `step_ms` a partir de `t0`, em décimos de jarda (x, y, x, y...).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSeg {
    pub t0: i64,
    pub xy: Vec<i32>,
}

/// Replay de um momento do pull: as posições vêm de `Pull.tracks`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRef {
    /// o momento (morte, encontro, acerto, falha)
    pub t: i64,
    pub from: i64,
    pub to: i64,
    /// quem o replay acompanha (vazio = falha coletiva: todo mundo igual)
    pub focus: Vec<String>,
    /// stacks do debuff da mecânica ao longo do replay
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stacks: Vec<StackLine>,
    /// acertos da mecânica em quem o replay acompanha
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<ReplayMark>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackLine {
    pub guid: String,
    /// (t, stacks) a cada mudança: 0 = sem o debuff, -1 = desconhecido
    pub pts: Vec<(i64, i32)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMark {
    pub t: i64,
    pub guid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullTrigger {
    pub key: String,
    pub name: String,
    /// momento da falha (ou da 1ª morte ligada a ela)
    pub t: i64,
    /// mortes atribuídas a esta mecânica
    pub deaths: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicResult {
    pub key: String,
    pub name: String,
    /// spell que representa a mecânica (para o ícone)
    pub spell_id: Option<u32>,
    /// tipo da regra (avoidable_damage, soak, interrupt, ...)
    pub kind: String,
    /// wipe | major | minor | none
    pub severity: String,
    /// importância dentro do boss (YAML): maior vem antes
    #[serde(skip_serializing_if = "is_zero")]
    pub priority: u32,
    pub tip: Text,
    /// marcada pelo usuário como foco da progressão
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub focus: bool,
    /// campos que o usuário ajustou (vazio = regra padrão)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tuned: Vec<String>,
    /// regra criada pelo usuário (não existe nas regras do app)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub custom: bool,
    /// dano evitável que pesa inteiro para tank
    #[serde(skip_serializing_if = "std::ops::Not::not", rename = "tankFull")]
    pub tank_full_weight: bool,
    /// false = tipo de regra que o motor ainda não avalia (só dica)
    pub evaluated: bool,
    pub failures: u32,
    /// mensagem da falha coletiva (soak, interrupt, enrage), já renderizada
    pub summary: Text,
    /// culpados primeiro; depois quem ajudou (`credit`: interrupts, soaks)
    pub players: Vec<MechanicPlayer>,
    pub events: Vec<MechanicEvent>,
    /// posições no momento das primeiras falhas coletivas (explosão, Execution...)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub snapshots: Vec<Positions>,
    /// interrupt: cada cast do inimigo, em ordem (para conferir a escala de interrupts)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub casts: Vec<CastOutcome>,
    /// dispel: cada debuff aplicado e o que aconteceu com ele
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dispels: Vec<DispelOutcome>,
    /// phase_duration: cada janela (intermissão) e quanto durou
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub phases: Vec<PhaseWindow>,
    /// phase_duration: tempo bom e tempo máximo aceitável (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<i64>,
    /// stack_limit com `sources`: de onde veio cada stack, por player (todos, não só os culpados)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub stack_origins: Vec<PlayerStackOrigins>,
    /// debuff de parear (Helical Toxins): cada encontro com soma errada, com replay das posições
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pairings: Vec<PairFault>,
    /// replays das falhas (quem errou, ou a falha coletiva), com as posições em `Pull.tracks`
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub replays: Vec<ReplayRef>,
    /// fantasmas (`gaze` com simulação): quantas jardas o fantasma de cada um andou no pull
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ghost_yards: Option<GhostYards>,
}

/// Quanto o fantasma de cada player andou no pull (caminho simulado, ver `gaze.rs`): parado é
/// olhar para ele; cada jarda é tempo de costas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostYards {
    /// a fixação do fantasma (ícone)
    pub spell_id: u32,
    /// nome do fantasma
    pub name: String,
    /// quem teve fantasma, quem deixou andar mais primeiro
    pub players: Vec<PlayerYards>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerYards {
    pub guid: String,
    pub name: String,
    /// jardas andadas, somando os fantasmas dele no pull
    pub yards: f32,
    pub ghosts: u32,
}

/// Encontro de players com soma errada num debuff de parear (ex.: Helical Toxins, que precisa
/// somar exatamente 4 stacks encostando em alguém).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairFault {
    /// instante do encontro (ms do pull)
    pub t: i64,
    /// começo da rodada (aplicação do debuff)
    pub round_start: i64,
    pub members: Vec<PairMember>,
    /// stacks de cada um depois do encontro
    pub sum: u32,
    /// soma que limpa
    pub target: u32,
    /// passou da soma: ninguém consegue mais limpar o debuff deles
    pub over: bool,
    /// true: a rodada tinha solução e deixou de ter aqui; false: não mudou (ou já não tinha);
    /// null: algum stack ficou desconhecido
    pub broke: Option<bool>,
    /// conta como falha (passou da soma ou deixou a rodada sem solução)
    pub counted: bool,
    /// guid de quem andou até o outro (null = os dois andaram, ou já estavam juntos)
    pub culprit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay: Option<ReplayRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairMember {
    pub guid: String,
    pub name: String,
    /// stacks antes do encontro (null = não deu para saber)
    pub before: Option<u32>,
    /// jardas andadas na direção do outro nos segundos antes do encontro
    pub approach_yd: f32,
    /// parte da aproximação feita por ele (0 a 1)
    pub share: f32,
    /// o parceiro certo mais perto naquele instante (com os stacks que completavam a soma)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub better: Option<PairHint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairHint {
    pub guid: String,
    pub name: String,
    pub stacks: u32,
    pub dist_yd: f32,
}

/// Uma origem de stacks: a mecânica e quantos stacks deu (ou tirou).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackOrigin {
    pub key: String,
    pub name: String,
    pub count: u32,
}

/// De onde vieram os stacks de um player no pull, em ordem de quantidade.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStackOrigins {
    pub guid: String,
    pub name: String,
    pub max_stacks: u32,
    /// fontes do tipo dano evitável (onda, linha, orb na cabeça...)
    pub avoidable: Vec<StackOrigin>,
    pub unavoidable: Vec<StackOrigin>,
    /// `removed_by`: quantos stacks cada mecânica tirou
    pub removed: Vec<StackOrigin>,
    /// stacks sem nenhuma fonte perto no tempo
    pub unknown: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastOutcome {
    pub t: i64,
    /// quem castou (cada add tem o seu guid)
    pub source_guid: String,
    pub source: String,
    /// quem cortou; None = o cast passou
    pub interrupted_by: Option<String>,
    pub interrupted_by_guid: Option<String>,
}

/// Uma janela de fase (ex.: intermissão em que o boss fica imune até o raid resolver a mecânica).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseWindow {
    pub start: i64,
    /// None = não terminou no tempo analisado (wipe na fase ou corte de mortes)
    pub end: Option<i64>,
    /// o raid wipou durante a fase
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub wiped: bool,
    /// players que morreram dentro da fase (mecânica errada costuma matar vários de uma vez)
    #[serde(skip_serializing_if = "is_zero")]
    pub deaths: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispelOutcome {
    /// quando o debuff entrou
    pub t: i64,
    pub target_guid: String,
    pub target: String,
    /// ms até o dispel; None = saiu sem dispel (expirou ou o player morreu)
    pub delay_ms: Option<i64>,
    pub dispelled_by: Option<String>,
    pub dispelled_by_guid: Option<String>,
}

/// Foto das posições (advanced logging) num momento do pull. Coordenadas do mundo, em jardas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Positions {
    /// ms desde o início do pull
    pub t: i64,
    pub units: Vec<UnitPos>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPos {
    pub guid: String,
    pub name: String,
    /// "player" | "enemy"
    pub kind: String,
    pub x: f32,
    pub y: f32,
    /// há quanto tempo a posição foi vista (a posição só vem com eventos da unidade)
    pub age_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicPlayer {
    pub guid: String,
    pub name: String,
    /// hits, stacks máximos ou vezes que ajudou
    pub count: u32,
    pub amount: i64,
    pub first_t: Option<i64>,
    pub credit: bool,
    pub message: Text,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicEvent {
    pub t: i64,
    pub player: Option<String>,
    pub detail: Text,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BossState {
    pub guid: String,
    pub name: String,
    pub npc_id: Option<u32>,
    pub max_hp: i64,
    /// HP restante no fim do pull (0-100). None sem advanced logging.
    pub hp_pct: Option<f32>,
    /// HP no momento do corte ("ignorar após N mortes")
    pub hp_pct_at_cutoff: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub guid: String,
    pub name: String,
    pub class: Option<String>,
    pub spec_id: Option<u32>,
    pub role: Option<String>,
    pub damage_done: i64,
    pub dps: f64,
    pub healing_done: i64,
    pub hps: f64,
    pub damage_taken: i64,
    pub deaths: u32,
    pub health_potions: u32,
    pub healthstones: u32,
    pub defensives_used: Vec<SpellUse>,
    pub taken_by_ability: Vec<AbilityDamage>,
    pub interrupts: u32,
    pub interrupt_attempts: u32,
    /// spec tem interrupt ou o player usou um no log
    pub can_interrupt: bool,
    pub interrupt_log: Vec<InterruptUse>,
    /// Casts do player (sem pets) até o corte, por habilidade: base da comparação de desempenho
    pub casts: Vec<SpellCasts>,
    /// Dano e cura por habilidade (pets somados ao dono), maiores primeiro
    pub damage_by_spell: Vec<SpellAmount>,
    pub healing_by_spell: Vec<SpellAmount>,
    /// Tempo vivo dentro do tempo analisado (até a morte ou o corte)
    pub alive_ms: i64,
    /// Talentos, itens e status (COMBATANT_INFO do início do pull)
    pub setup: Option<Setup>,
    /// rotação da spec (se ela tiver rotação base escrita): achados e aproveitamento
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<crate::rotation::RotationResult>,
    /// dano / cura por janela de 5s (pets somados), até o corte
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub damage_timeline: Vec<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub healing_timeline: Vec<i64>,
    /// healer: overheal por habilidade, maiores primeiro
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub overheal_by_spell: Vec<SpellAmount>,
    /// healer: mana % por janela de 5s, até o corte
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mana_timeline: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellCasts {
    pub spell_id: u32,
    pub name: String,
    /// ms desde o início do pull
    pub times: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellAmount {
    pub spell_id: u32,
    pub name: String,
    pub amount: i64,
    /// veio de pet/guardião
    pub pet: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub stats: SetupStats,
    /// média dos itens equipados (arma de duas mãos conta duas vezes, como no jogo)
    pub item_level: f32,
    pub items: Vec<GearItem>,
    /// entradas de talento escolhidas: (nó, entrada, rank)
    pub talents: Vec<[u32; 3]>,
}

/// Rating secundário (não %) e atributos primários, como vêm no log.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStats {
    pub strength: u32,
    pub agility: u32,
    pub stamina: u32,
    pub intellect: u32,
    pub crit: u32,
    pub haste: u32,
    pub mastery: u32,
    pub versatility: u32,
    pub leech: u32,
    pub avoidance: u32,
    pub speed: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GearItem {
    /// posição na lista do COMBATANT_INFO (0 = cabeça … 15 = arma, 16 = mão secundária)
    pub slot: u8,
    pub item_id: u32,
    pub ilvl: u32,
    pub enchant: Option<u32>,
    pub gems: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellUse {
    pub spell_id: u32,
    pub name: String,
    /// ms desde o início do pull
    pub t: i64,
    /// guid de quem aplicou (externals); igual ao player para pessoais
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityDamage {
    pub spell_id: u32,
    pub name: String,
    pub source: String,
    pub amount: i64,
    pub hits: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Death {
    /// 1 = primeira morte do pull
    pub order: u32,
    pub guid: String,
    pub name: String,
    pub class: Option<String>,
    pub role: Option<String>,
    pub t: i64,
    /// Depois do corte ("ignorar após N mortes"): só para consulta, não conta em nada
    pub ignored: bool,
    pub killing_blow: Option<RecapEntry>,
    /// Mecânica do boss (regras) que deu o golpe final, se reconhecida
    pub killing_blow_mechanic: Option<String>,
    /// spike | slow | normal | unknown
    pub death_kind: String,
    pub stats: DeathStats,
    /// Debuffs ativos no player no momento da morte
    pub debuffs: Vec<DeathAura>,
    /// Dano recebido no recap vindo de mecânicas com falha (regras), maior primeiro
    pub mechanic_damage: Vec<MechanicShare>,
    /// Mecânica que causou a morte: golpe final ou >= 35% do dano recebido
    pub caused_by: Option<MechanicShare>,
    /// Eventos dos últimos segundos antes da morte, em ordem cronológica
    pub recap: Vec<RecapEntry>,
    /// Defensivos (pessoais ou externos) ativados nos últimos 10s
    pub defensives_recent: Vec<SpellUse>,
    /// Defensivos que o player usou em algum pull do log e estavam fora de cooldown
    pub defensives_available: Vec<AvailableSpell>,
    pub used_health_potion: bool,
    pub used_healthstone: bool,
    /// Player usou healthstone em algum pull do log (logo provavelmente tinha)
    pub healthstone_known: bool,
    /// onde cada um estava na hora da morte (só mortes antes do corte)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub positions: Option<Positions>,
    /// replay dos segundos antes da morte (posições em `Pull.tracks`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay: Option<ReplayRef>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathStats {
    pub max_hp: Option<i64>,
    /// tempo contínuo abaixo de 50% de HP antes de morrer
    pub below_half_ms: Option<i64>,
    /// maior HP% nos 3s antes da morte
    pub max_hp_pct_last_3s: Option<f32>,
    pub damage_taken_10s: i64,
    pub healing_received_10s: i64,
    /// cura recebida nos últimos 10s em % do HP máximo
    pub healing_pct_of_max_10s: Option<f32>,
    /// cura baixa: < 25% do HP máximo nos últimos 10s
    pub underhealed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathAura {
    pub spell_id: u32,
    pub name: String,
    pub stacks: u32,
    pub source: String,
    /// ms desde o início do pull
    pub applied_t: i64,
    /// mecânica do boss (regras) a que esse debuff pertence
    pub mechanic: Option<String>,
    pub tip: Option<Text>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MechanicShare {
    pub key: String,
    pub name: String,
    pub amount: i64,
    /// % do dano recebido no recap
    pub pct: f32,
    /// última falha coletiva dessa mecânica antes da morte (soak, interrupt...)
    pub fail_t: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptUse {
    pub t: i64,
    /// interrupt usado (Kick, Pummel, ...)
    pub spell_id: u32,
    pub spell: String,
    /// cast cortado; None = tentativa que não cortou nada
    pub target_spell_id: Option<u32>,
    pub target_spell: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableSpell {
    pub spell_id: u32,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecapKind {
    Damage,
    Heal,
    Buff,
    Debuff,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapEntry {
    pub t: i64,
    pub kind: RecapKind,
    pub spell_id: u32,
    pub spell_name: String,
    pub source: String,
    pub amount: i64,
    pub overkill: i64,
    pub absorbed: i64,
    /// HP do player depois do evento (0-100), quando o log informa
    pub hp_pct: Option<f32>,
    /// mecânica do boss a que o golpe pertence (chave da regra)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mechanic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemySpell {
    pub spell_id: u32,
    pub name: String,
    pub sources: Vec<String>,
    pub casts: u32,
    /// ms desde o início do pull de cada cast (para alinhar pulls pelas mecânicas do boss)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cast_times: Vec<i64>,
    pub hits_on_players: u32,
    pub damage_to_players: i64,
    /// vezes que foi interrompido neste pull
    pub interrupted: u32,
    /// foi interrompido ao menos uma vez em algum pull do log
    pub interruptible: bool,
}

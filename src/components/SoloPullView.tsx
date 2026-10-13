import { useMemo, useState } from 'react';
import { ChevronDown, Footprints, ShieldAlert, Skull, Target } from 'lucide-react';
import type { PlayerStats, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import { candidates, defaultReference, detectCooldowns, isHealer, outputPerSec, type Sample } from '../lib/performance';
import { fairReference, losses, myDeaths, myMechanicFailures, type Loss } from '../lib/solo';
import { meIn, setSoloCharacter, useSoloCharacter } from '../lib/mode';
import { useSeek } from '../lib/wcr';
import { specLabel } from '../lib/specs';
import { scoreTone } from '../lib/score';
import { PlayAt } from './VideoPanel';
import { SpellIcon } from './SpellIcon';
import { Colored, PlayerName, useMentionsSpell } from './Names';
import { RotationPanel, uniqueSeconds } from './RotationPanel';
import { HealerPanel } from './HealerPanel';
import { compareHealer } from '../lib/healer';
import { compareWithTops, type BenchView } from '../lib/bench';
import { killParseOf, ownPreviousParses } from '../lib/wclParses';
import { ErrorBoundary } from './ErrorBoundary';
import { ShareMenu } from './share/ShareMenu';
import { SoloShareCard } from './share/SoloCard';
import { messagesOf, tr as trLoc, useMessages } from '../i18n';
import { soloPullMsg } from './SoloPullView.i18n';
import { Stat, StatGrid } from './ui/Stat';
import { ReplayView } from './ReplayView';
import { replayMsg } from './ReplayView.i18n';
import { deathReplayExtras, decodeReplay, playerReplay } from '../lib/replay';
import type { Death } from '../types';
import { Clamp } from './ui/Clamp';

/** Modo solo: o pull do ponto de vista de um player só, com o que ele pode corrigir. */
export function SoloPullView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const chosen = useSoloCharacter();
  const me = meIn(pull, chosen);
  if (!me) return <WhoAreYou pull={pull} />;
  return (
    <ErrorBoundary label={messagesOf(soloPullMsg).errorScope} resetKey={`${pull.id}:${me.guid}`}>
      {/* a escolha da referência vale para os pulls do mesmo boss; trocou de boss, volta ao padrão */}
      <SoloPull key={`${me.guid}:${pull.encounterId}:${pull.difficultyId}`} me={{ pull, player: me }} nightPulls={nightPulls} />
    </ErrorBoundary>
  );
}

function CharacterPicker({ pull, current }: { pull: Pull; current: PlayerStats | null }) {
  const t = useMessages(soloPullMsg);
  const players = [...pull.players].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      className="select"
      aria-label={t.yourCharacter}
      value={current?.guid ?? ''}
      onChange={(e) => {
        const p = players.find((x) => x.guid === e.target.value);
        setSoloCharacter(p ? p.name : null);
      }}
    >
      {!current && <option value="">{t.choose}</option>}
      {players.map((p) => (
        <option key={p.guid} value={p.guid}>
          {shortName(p.name)} — {specLabel(p.specId)}
          {p.guid === pull.ownerGuid ? t.recordedLog : ''}
        </option>
      ))}
    </select>
  );
}

function WhoAreYou({ pull }: { pull: Pull }) {
  const t = useMessages(soloPullMsg);
  return (
    <div className="panel solo-who">
      <Target size={20} strokeWidth={1.5} className="muted" aria-hidden />
      <div>
        <h3>{t.whoTitle}</h3>
        <p className="muted small">{t.whoText}</p>
      </div>
      <CharacterPicker pull={pull} current={null} />
    </div>
  );
}

// ---- referência do resumo

const pullLabel = (p: Pull) => messagesOf(soloPullMsg).pullLabel(p.pullNumber, p.success);

/** "Fulano", "Fulano · pull 6 (kill)", "Você no pull 6 (kill)" */
function sampleLabel(me: Sample, s: Sample): string {
  if (s.player.guid === me.player.guid) return messagesOf(soloPullMsg).youIn(pullLabel(s.pull));
  return s.pull.id === me.pull.id ? shortName(s.player.name) : `${shortName(s.player.name)} · ${pullLabel(s.pull)}`;
}

function SoloPull({ me, nightPulls }: { me: Sample; nightPulls: Pull[] }) {
  const t = useMessages(soloPullMsg);
  const seek = useSeek();
  const healer = isHealer(me.player);
  const unit = healer ? 'HPS' : 'DPS';
  const ls = useMemo(() => losses(me), [me]);
  const out = outputPerSec(me);

  // referência do resumo e do cartão: o melhor da mesma spec na noite (ou você num pull melhor);
  // escolher outra, inclusive os tops do Warcraft Logs, fica na aba Comparação detalhada
  const list = useMemo(() => candidates(me, nightPulls), [me, nightPulls]);
  const fair = useMemo(() => list.filter((s) => fairReference(me, s)), [me, list]);
  const ref: Sample | null =
    defaultReference(
      me,
      fair.filter((s) => s.player.guid !== me.player.guid),
    ) ??
    fair.find((s) => s.player.guid === me.player.guid && outputPerSec(s) > out) ??
    null;
  const refLabel = ref ? sampleLabel(me, ref) : t.reference;
  const refOut = ref ? outputPerSec(ref) : 0;
  const diff = refOut > 0 ? ((out - refOut) / refOut) * 100 : null;
  const cds = useMemo(() => detectCooldowns([me, ...list]), [me, list]);
  const bench = useMemo(() => compareWithTops(me.pull, me.player), [me]);
  // kill: o parse do Warcraft Logs (salvo) e o dele nos kills anteriores deste boss
  const parse = killParseOf(me.pull, me.player);
  const own = ownPreviousParses(me.pull, me.player.name);

  const deaths = myDeaths(me);
  const mechs = myMechanicFailures(me);
  const mechCount = mechs.reduce((n, m) => n + m.player.count, 0);
  const r = me.player.rotation;
  const healerCmp = useMemo(() => (healer ? compareHealer(me.pull, me.player) : null), [healer, me]);
  const healerRef = healerCmp?.context.hps ?? null;
  const problems = r ? r.findings.filter((f) => f.count > 0 && f.id !== 'cooldowns').length : 0;
  const tabs: { key: SoloTab; label: string; count?: number; tone?: string }[] = [
    { key: 'mechanics', label: t.tabs.mechanics, count: mechCount + deaths.length, tone: deaths.length || mechCount > 2 ? 'bad' : 'warn' },
    { key: 'main', label: healer ? t.tabs.healing : t.tabs.rotation, count: (healerCmp?.tips.length ?? 0) + problems, tone: 'warn' },
    { key: 'cooldowns', label: t.tabs.cooldowns },
    ...(r ? [{ key: 'guide' as const, label: t.tabs.guide }] : []),
  ];
  // abre onde há o que ver: mecânica errada primeiro, senão a cura/rotação
  const [tab, setTab] = useState<SoloTab>(mechCount + deaths.length > 0 ? 'mechanics' : 'main');

  return (
    <div className="solo">
      <div className="solo-head">
        <span className="solo-you">
          <span className="muted small">{t.you}</span>
          <PlayerName name={me.player.name} cls={me.player.class} />
          <span className="muted small">{specLabel(me.player.specId)}</span>
        </span>
        <CharacterPicker pull={me.pull} current={me.player} />
        <ShareMenu
          card={(detail) => <SoloShareCard me={me} ref_={ref} refLabel={refLabel} cds={cds} detail={detail} />}
          name={`${shortName(me.player.name)} - ${me.pull.encounterName} ${me.pull.difficultyName} - pull ${me.pull.pullNumber}`}
        />
      </div>

      <StatGrid>
        <Stat
          tone={healer ? 'neutral' : diff == null ? 'neutral' : diff <= -15 ? 'bad' : diff < -3 ? 'warn' : 'good'}
          // healer: o mesmo HPS da luta que a referência usa (cura efetiva no tempo analisado)
          label={healer && healerCmp ? t.hpsEffective : t.perSecondAlive(healer)}
          value={num(healer && healerCmp ? healerCmp.context.you.hps : out)}
          delta={!healer && diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined}
          sub={
            // healer: a referência é a dos logs de fora (nunca um colega da raid); o HPS não é nota
            healer
              ? healerRef
                ? t.refMedian(num(healerRef.median))
                : t.noReference
              : ref
                ? `${refLabel}: ${num(refOut)}`
                : t.noReference
          }
          extra={parse != null ? t.parseLine(parse) + (own.previous ? t.parseVsOwn(own.previous.percent, own.avg ?? own.previous.percent, own.kills) : '') : undefined}
        />
        <Stat
          tone={r ? ({ good: 'good', mid: 'warn', bad: 'bad' } as const)[scoreTone(r.score)] : 'neutral'}
          label={t.rotation}
          value={r ? String(r.score) : t.underConstruction}
          sub={r ? t.idle(mmss(r.downtimeMs)) : specLabel(me.player.specId)}
        />
        <Stat
          tone={deaths.length ? 'bad' : 'good'}
          label={t.survival}
          value={deaths.length ? t.diedAt(mmss(deaths[0].death.t)) : t.aliveToEnd}
          sub={t.resultIn(me.pull.success, mmss(me.pull.durationMs))}
        />
        <Stat
          tone={!me.pull.rulesFile ? 'neutral' : mechCount === 0 ? 'good' : mechCount <= 2 ? 'warn' : 'bad'}
          label={t.mechErrors}
          value={String(mechCount)}
          sub={me.pull.rulesFile ? t.onlyYours : t.noRules}
        />
      </StatGrid>

      <NextPull losses={ls} unit={unit} seek={seek} />

      <div className="solo-tabs" role="tablist" aria-label={t.tabsAria}>
        {tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'active' : ''} onClick={() => setTab(x.key)}>
            {x.label}
            {x.count != null && x.count > 0 && <span className={`tab-count ${x.tone ?? ''}`}>{x.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'mechanics' && <Mechanics me={me} bench={bench} seek={seek} />}
      {tab === 'main' && (
        <>
          {healer && <HealerPanel pull={me.pull} me={me.player} part="healing" />}
          {r ? (
            <RotationPanel rotation={r} bench={bench} boss={me.pull.encounterName} part="findings" />
          ) : (
            <p className="rot-wip small">
              <span className="chip">{t.wipChip}</span> {t.wipText(specLabel(me.player.specId))}
            </p>
          )}
        </>
      )}
      {tab === 'cooldowns' && (
        <>
          {healer && <HealerPanel pull={me.pull} me={me.player} part="cooldowns" />}
          {r && <RotationPanel rotation={r} bench={bench} boss={me.pull.encounterName} part="cooldowns" />}
        </>
      )}
      {tab === 'guide' && r && <RotationPanel rotation={r} bench={bench} boss={me.pull.encounterName} part="guide" />}
    </div>
  );
}

type SoloTab = 'mechanics' | 'main' | 'cooldowns' | 'guide';

/**
 * Um número do resumo com a cor do que ele significa: verde bom, amarelo atenção, vermelho ruim,
 * cinza só contexto (o HPS do healer não é nota).
 */
/** Momento do pull: o horário sempre, e o ▶ quando o pull tem vídeo. */
function At({ t, seek }: { t: number; seek: ((t: number) => void) | null }) {
  return (
    <span className="solo-at small tabular">
      {mmss(t)}
      <PlayAt t={t} seek={seek} />
    </span>
  );
}

// ---- o que corrigir primeiro: o resumo (o que fazer e quando); o detalhe fica na seção de cada assunto

const LOSS_ICON: Partial<Record<Loss['kind'], typeof Skull>> = { death: Skull, mechanic: ShieldAlert, avoidable: ShieldAlert };

function NextPull({ losses: ls, unit, seek }: { losses: Loss[]; unit: string; seek: ((t: number) => void) | null }) {
  const t = useMessages(soloPullMsg);
  const mentions = useMentionsSpell();
  const [all, setAll] = useState(false);
  if (ls.length === 0)
    return (
      <section className="perf-section">
        <h4>{t.nextPull}</h4>
        <p className="muted">{t.nothingSerious}</p>
      </section>
    );
  const shown = all ? ls : ls.slice(0, 3);
  return (
    <section className="perf-section">
      <h4>
        {t.nextPull} <span className="muted small">{t.byCost}</span>
      </h4>
      <ol className="solo-losses">
        {shown.map((l, i) => {
          const Icon = LOSS_ICON[l.kind];
          return (
            <li key={l.key} className={`solo-loss ${i < 3 ? 'top' : ''} cost-${l.weightSec >= 25 ? 'high' : l.weightSec >= 8 ? 'mid' : 'low'}`}>
              <span className="solo-rank tabular">{i + 1}</span>
              <div>
                <div className="solo-loss-title">
                  {l.spellId != null ? !mentions(l.title) && <SpellIcon spellId={l.spellId} size={18} /> : Icon && <Icon size={16} strokeWidth={1.5} aria-hidden />}
                  <strong>
                    <Colored text={l.title} />
                  </strong>
                  <span className="muted small">{l.lost != null ? t.lost(num(l.lost), unit === 'HPS', Math.round(l.weightSec), unit) : costLabel(l)}</span>
                </div>
                {l.tip && (
                  <p className="muted small">
                    <Clamp lines={2}>
                      <Colored text={l.tip} />
                    </Clamp>
                  </p>
                )}
                {l.times.length > 0 && (
                  <span className="chips solo-times">
                    {uniqueSeconds(l.times)
                      .slice(0, 6)
                      .map((t) => (
                        <At key={t} t={t} seek={seek} />
                      ))}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {ls.length > 3 && (
        <button className="link small more-toggle" onClick={() => setAll(!all)} aria-expanded={all}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${all ? 'open' : ''}`} aria-hidden />
          {all ? t.showTop3 : t.showOthers(ls.length - 3)}
        </button>
      )}
    </section>
  );
}

/** Sem estimativa de dano: o peso vira "alto / médio / baixo". */
const costLabel = (l: Loss) => {
  const t = messagesOf(soloPullMsg);
  return l.weightSec >= 25 ? t.costHigh : l.weightSec >= 8 ? t.costMid : t.costLow;
};

// ---- sobrevivência e mecânicas

/** Mortes, erros nas mecânicas cadastradas e os defensivos que os tops da spec usam nas mecânicas do boss. */
function Mechanics({ me, bench, seek }: { me: Sample; bench: BenchView | null; seek: ((t: number) => void) | null }) {
  const t = useMessages(soloPullMsg);
  const rt = useMessages(replayMsg);
  const fails = myMechanicFailures(me);
  const deaths = myDeaths(me);
  const defs = bench?.defensives ?? [];
  // replay aberto: "death:<t>" ou "mech:<chave>"
  const [open, setOpen] = useState<string | null>(null);
  const data = useMemo(() => decodeReplay(me.pull), [me.pull]);
  const classes = useMemo(() => new Map(me.pull.players.map((x) => [x.guid, x.class] as const)), [me.pull]);
  const hasData = data.units.size > 0;
  const toggle = (k: string) => (
    <button className={`link small replay-link ${open === k ? 'active' : ''}`} onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
      <Footprints size={13} strokeWidth={1.75} aria-hidden /> {rt.open(open === k)}
    </button>
  );
  return (
    <section className="perf-section">
      <h4>
        <ShieldAlert size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.mechanics}
      </h4>
      {fails.length === 0 && deaths.length === 0 && <p className="muted small">{me.pull.rulesFile ? t.noMistakes : t.bossNoRules}</p>}
      {deaths.map(({ death: d }) => (
        <div key={d.t} className="solo-mech">
          <Skull size={16} strokeWidth={1.5} className="bad" aria-hidden />
          <div>
            <strong>{t.deathAt(mmss(d.t))}</strong>
            <span className="muted small">
              {' '}
              {d.killingBlow ? `${d.killingBlow.spellName} (${d.killingBlow.source})` : t.unknownKillingBlow}
              {d.causedBy ? t.after(d.causedBy.name) : ''}
            </span>
            <p className="muted small">
              {d.defensivesAvailable.length ? t.availableThen(d.defensivesAvailable.map((x) => x.name).join(', ')) : t.noDefensive}
              {!d.usedHealthPotion && t.noPotion}
              {d.healthstoneKnown && !d.usedHealthstone && t.noHealthstone}
            </p>
            {hasData && d.replay && toggle(`death:${d.t}`)}
            {open === `death:${d.t}` && d.replay && <DeathReplay death={d} data={data} classes={classes} />}
          </div>
          <At t={d.t} seek={seek} />
        </div>
      ))}
      {fails.map(({ mechanic: m, player: p, times }) => {
        const rp = playerReplay(m, me.player.guid);
        const k = `mech:${m.key}`;
        return (
        <div key={m.key} className="solo-mech">
          {m.spellId != null ? <SpellIcon spellId={m.spellId} size={18} /> : <ShieldAlert size={16} strokeWidth={1.5} aria-hidden />}
          <div>
            <strong>{m.name}</strong> <span className="muted small">{trLoc(p.message) || t.errors(p.count)}</span>
            {trLoc(m.tip) && (
              <p className="muted small">
                <Clamp>
                  <Colored text={trLoc(m.tip)} />
                </Clamp>
              </p>
            )}
            {rp && (hasData || rp.data) && toggle(k)}
            {open === k && rp && <ReplayView key={k} data={rp.data ?? data} replay={rp.replay} classes={classes} moment={rp.moment} />}
          </div>
          {(times[0] ?? p.firstT) != null && <At t={(times[0] ?? p.firstT)!} seek={seek} />}
        </div>
        );
      })}
      {defs.length > 0 && (
        <>
          <h5 className="muted small">{t.defensives}</h5>
          <ul className="plain bench-list small">
            {defs.map((d) => (
              <li key={d.spellId}>
                <Colored text={`${t.defensive(d.name, Math.round(d.share * 100))} (${d.spells.map((x) => x.name).join(', ')}).`} />{' '}
                <span className={d.used < d.of / 2 ? 'warn' : 'muted'}>{t.defYou(d.used, d.of)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Replay da morte do player (golpes tomados e vida ao longo dele). */
function DeathReplay({ death, data, classes }: { death: Death; data: ReturnType<typeof decodeReplay>; classes: Map<string, string | null> }) {
  const { hits, hp } = useMemo(() => deathReplayExtras(death), [death]);
  return <ReplayView data={data} replay={death.replay!} classes={classes} moment="death" hp={hp} dies={death.guid} hits={hits} />;
}

import { useEffect, useState } from 'react';
import { ExternalLink, Play, X } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { analyzePull, lowestBossHpAtEnd } from '../lib/verdict';
import { DeathList } from './DeathList';
import { PlayersTable } from './PlayersTable';
import { EnemySpellsTable } from './EnemySpellsTable';
import { MechanicsView } from './MechanicsView';
import { InterruptsView } from './InterruptsView';
import { openExternal, type WcrVideo } from '../lib/api';
import { SeekContext } from '../lib/wcr';
import { bossUrl, wclPullLabel } from '../lib/wcl';
import { PlayAt, VideoPanel } from './VideoPanel';

type Tab = 'mechanics' | 'deaths' | 'interrupts' | 'players' | 'spells';

const SEVERITY_LABEL = { wipe: 'Causa', major: 'Grave', minor: 'Atenção', info: 'Info' } as const;

interface Props {
  pull: Pull;
  /** código do report da noite no Warcraft Logs */
  wclCode?: string;
  /** vídeo do Warcraft Recorder casado com o pull */
  video?: WcrVideo;
}

/** HP de um boss: no corte ("ignorar após N mortes"), se houver. */
const bossHpOf = (pull: Pull) => (b: Pull['bosses'][number]) => (pull.cutoffT != null ? b.hpPctAtCutoff ?? b.hpPct : b.hpPct);

export function PullView({ pull, wclCode, video }: Props) {
  const [tab, setTab] = useState<Tab>('deaths');
  const [videoOpen, setVideoOpen] = useState(false);
  const [seekReq, setSeekReq] = useState<{ t: number; n: number } | null>(null);
  const seek = video
    ? (t: number) => {
        setSeekReq((prev) => ({ t, n: (prev?.n ?? 0) + 1 }));
        setVideoOpen(true);
      }
    : null;
  // outro pull: fecha o vídeo
  useEffect(() => {
    setVideoOpen(false);
    setSeekReq(null);
  }, [pull.id]);
  const mechFailures = pull.mechanics.filter((m) => m.failures > 0).length;
  const verdict = analyzePull(pull);
  const bossHp = bossHpOf(pull);
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));

  return (
    <SeekContext.Provider value={seek}>
    <div className="pull-view">
      <div className="pull-header">
        <div>
          <h2>
            {pull.encounterName} <span className="muted">· {pull.difficultyName} · pull {pull.pullNumber}</span>
          </h2>
          <div className="muted">
            {pull.startLocal.split(' ')[1]?.slice(0, 8)} · {mmss(pull.durationMs)}
            {pull.incomplete && <span className="warn"> · log terminou antes do fim do encontro</span>}
            {pull.cutoffT != null && (
              <span title="Ignorar eventos após N mortes: dano, cura, erros e falhas contam só até aqui">
                {' '}
                · analisado até {mmss(pull.cutoffT)}
                {!pull.success && ` (no fim do pull o boss estava em ${pct(lowestBossHpAtEnd(pull))})`}
              </span>
            )}
          </div>
          {wclCode && (
            <button
              className="btn sm"
              onClick={() => openExternal(bossUrl(wclCode, pull))}
              title={`Abre o report filtrado neste boss; a try é a "${wclPullLabel(pull)}" da lista`}
            >
              Warcraft Logs <span className="muted">{wclPullLabel(pull)}</span>
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
          {video && (
            <button className="btn sm" onClick={() => (videoOpen ? setVideoOpen(false) : seek?.(0))}>
              {videoOpen ? <X size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
              {videoOpen ? 'Fechar vídeo' : `Vídeo (${video.player ?? 'POV'})`}
            </button>
          )}
        </div>
        <div className="boss-bars">
          {pull.bosses.map((b) => (
            <div key={b.guid} className="boss-bar" title={`${b.name}: ${pct(bossHp(b))}`}>
              <div className="boss-bar-fill" style={{ width: `${bossHp(b) ?? 0}%` }} />
              <span>
                {b.name} {pct(bossHp(b))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {video && videoOpen && <VideoPanel video={video} seek={seekReq} onClose={() => setVideoOpen(false)} />}

      <section className={`verdict ${pull.success ? 'kill' : 'wipe'}`}>
        <h3>
          {verdict.headline}
          {pull.trigger && <PlayAt t={pull.trigger.t} seek={seek} label="ver gatilho" />}
        </h3>
        {verdict.findings.length > 0 && (
          <ul className="findings">
            {verdict.findings.map((f, i) => (
              <li key={i} className={`finding ${f.severity}`}>
                <span className="badge">{SEVERITY_LABEL[f.severity]}</span>
                <span>
                  <strong>{f.title}</strong>
                  {f.detail && <span className="muted"> — {f.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mechanics'} className={tab === 'mechanics' ? 'active' : ''} onClick={() => setTab('mechanics')}>
          Mecânicas{pull.rulesFile ? ` (${mechFailures})` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'deaths'} className={tab === 'deaths' ? 'active' : ''} onClick={() => setTab('deaths')}>
          Mortes ({pull.deaths.filter((d) => !d.ignored).length})
        </button>
        <button role="tab" aria-selected={tab === 'interrupts'} className={tab === 'interrupts' ? 'active' : ''} onClick={() => setTab('interrupts')}>
          Interrupts
        </button>
        <button role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
          Jogadores ({pull.players.length})
        </button>
        <button role="tab" aria-selected={tab === 'spells'} className={tab === 'spells' ? 'active' : ''} onClick={() => setTab('spells')}>
          Habilidades do boss
        </button>
      </div>

      {tab === 'mechanics' && <MechanicsView pull={pull} />}
      {tab === 'deaths' && <DeathList deaths={pull.deaths} decisive={decisive} cutoffT={pull.cutoffT ?? null} />}
      {tab === 'interrupts' && <InterruptsView pull={pull} />}
      {tab === 'players' && <PlayersTable players={pull.players} />}
      {tab === 'spells' && <EnemySpellsTable spells={pull.enemySpells} />}
    </div>
    </SeekContext.Provider>
  );
}

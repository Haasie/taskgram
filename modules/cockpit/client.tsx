import '../_design';
import './cockpit.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, request } from '../../src/lib/api';
import type { ModuleViewProps } from '../types';
import { useT } from './i18n';
import { RISKS, riskCounts, type Cockpit, type CockpitFeature, type CockpitWorkspace, type Level } from './logic';

// Status altijd met vorm én woord, nooit alleen kleur.
const MARK: Record<Level, string> = { ok: '●', warn: '▲', alert: '■' };

type I18n = ReturnType<typeof useT>;

const useWhere = () =>
  useQuery({
    queryKey: ['module', 'cockpit', 'where'],
    queryFn: () => request<Cockpit>('GET', '/modules/cockpit/where'),
    refetchInterval: 60_000
  });

const fmt = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function CockpitView(_props: ModuleViewProps) {
  const i18n = useT();
  const { t } = i18n;
  const q = useWhere();
  const data = q.data;
  const counts = data ? riskCounts(data) : null;
  const features = data ? data.groups.reduce((n, g) => n + g.features.length, 0) : 0;
  // Een Postgram zonder workspace-tracking kent /api/where niet en antwoordt 404.
  const notSupported = q.error instanceof ApiError && q.error.status === 404 && q.error.code !== 'MODULE_DISABLED';

  return (
    <div className="ld">
      <div className="ld-wrap">
        <header className="ld-head">
          <div className="ld-top">
            <div>
              <div className="ld-label">{t('kicker')}</div>
              <h1 className="ld-h1">
                {t('title')}
                <span className="ld-cur" aria-hidden="true" />
              </h1>
              <p className="ld-sub">{t('lede')}</p>
            </div>
            <div className="ld-bar">
              <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => q.refetch()} disabled={q.isFetching}>
                {q.isFetching ? t('refreshing') : t('refresh')}
              </button>
            </div>
          </div>
          {data?.generatedAt && (
            <p className="ld-meta" role="status">
              {t('generated', { time: fmt(data.generatedAt, i18n.locale) })}
            </p>
          )}
        </header>

        {q.isLoading ? (
          <div className="ld-empty">{t('loading')}</div>
        ) : q.isError ? (
          <div className="ld-empty ld-error" role="alert">
            {notSupported ? t('notSupported') : t('loadFailed', { error: q.error.message })}
          </div>
        ) : data && counts ? (
          <main className="ld-main">
            <div className="ld-tiles" role="list" aria-label={t('tilesAria')}>
              <div className="ld-tile" role="listitem">
                <span className="ld-label">{t('tileFeatures')}</span>
                <b>{features}</b>
              </div>
              {RISKS.map((r) => {
                const level: Level = counts[r] === 0 ? 'ok' : r === 'missing' || r === 'interrupted' ? 'alert' : 'warn';
                return (
                  <div key={r} className={`ld-tile cp-tile cp-${level}`} role="listitem">
                    <span className="ld-label">{i18n.risk(r)}</span>
                    <b>{counts[r]}</b>
                    <Badge level={level} i18n={i18n} />
                  </div>
                );
              })}
            </div>

            {data.groups.map((g) => (
              <section key={g.key} className="ld-section" aria-label={i18n.group(g.key, g.label)}>
                <div className="ld-sh">
                  <h2>{i18n.group(g.key, g.label)}</h2>
                  <span className="ld-data">{g.features.length}</span>
                </div>
                {g.features.length ? (
                  <ul className="ld-list">
                    {g.features.map((f) => (
                      <FeatureRow key={f.id} feature={f} i18n={i18n} />
                    ))}
                  </ul>
                ) : (
                  <div className="ld-empty">{t('empty')}</div>
                )}
              </section>
            ))}

            {data.unassigned.length > 0 && (
              <section className="ld-section" aria-label={t('unassigned')}>
                <div className="ld-sh">
                  <h2>{t('unassigned')}</h2>
                  <span className="ld-data">{data.unassigned.length}</span>
                </div>
                <ul className="ld-list">
                  {data.unassigned.map((w) => (
                    <li key={w.id} className="ld-item cp-item">
                      <Mark level={w.level} i18n={i18n} />
                      <WorkspaceLine w={w} i18n={i18n} />
                      <Badge level={w.level} i18n={i18n} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>
        ) : null}
      </div>
    </div>
  );
}

function FeatureRow({ feature: f, i18n }: { feature: CockpitFeature; i18n: I18n }) {
  return (
    <li className="ld-item cp-item">
      <Mark level={f.level} i18n={i18n} />
      <div className="ld-t">
        <span className="ld-title-static">{f.title}</span>
        {f.pullRequests.length > 0 && (
          <div className="ld-meta">
            {f.pullRequests.map((p) => (
              <a key={p.url} className="cp-pr" href={p.url} target="_blank" rel="noreferrer">
                {i18n.t('pr', { state: p.state })}
              </a>
            ))}
          </div>
        )}
        {f.workspaces.length ? (
          f.workspaces.map((w) => <WorkspaceLine key={w.id} w={w} i18n={i18n} />)
        ) : (
          <div className="ld-meta">{i18n.t('noWorkspace')}</div>
        )}
      </div>
      <Badge level={f.level} i18n={i18n} />
    </li>
  );
}

function WorkspaceLine({ w, i18n }: { w: CockpitWorkspace; i18n: I18n }) {
  const { t } = i18n;
  const repo = w.path.split('/').filter(Boolean).pop() ?? w.path;
  const when = w.missingSince
    ? t('missingSince', { time: fmt(w.missingSince, i18n.locale) })
    : t('lastActive', { time: fmt(w.lastActivityAt, i18n.locale) });
  return (
    <div className="cp-ws">
      <div className="ld-meta">
        <span className="ld-data">{w.machine}</span> · <b>{repo}</b>
        {w.branch && (
          <>
            {' · '}
            <code>{w.branch}</code>
          </>
        )}
        {' · '}
        {when}
        {w.sessions.length > 0 && <> · {t('sessions', { n: w.sessions.length })}</>}
      </div>
      {w.risks.length > 0 && (
        <div className="cp-risks">
          {w.risks.map((r) => (
            <span key={r} className={`cp-risk cp-${r === 'missing' || r === 'interrupted' ? 'alert' : 'warn'}`}>
              {i18n.risk(r)}
              {r === 'dirty' && w.dirty ? ` (${w.dirty})` : r === 'unpushed' && w.unpushed ? ` (${w.unpushed})` : ''}
            </span>
          ))}
        </div>
      )}
      {w.resume && <Resume cmd={w.resume} i18n={i18n} />}
    </div>
  );
}

function Resume({ cmd, i18n }: { cmd: string; i18n: I18n }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="cp-resume">
      <span className="ld-label">{i18n.t('resume')}</span>
      <code>{cmd}</code>
      <button className="ld-btn ld-sec ld-sm" type="button" onClick={copy}>
        {copied ? i18n.t('copied') : i18n.t('copy')}
      </button>
    </div>
  );
}

function Mark({ level, i18n }: { level: Level; i18n: I18n }) {
  return (
    <span className={`cp-mark cp-${level}`} aria-label={i18n.level(level)}>
      {MARK[level]}
    </span>
  );
}

function Badge({ level, i18n }: { level: Level; i18n: I18n }) {
  return (
    <span className={`cp-badge cp-${level}`}>
      {MARK[level]} {i18n.level(level)}
    </span>
  );
}

import '../_design';
import './beheer.css';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { request } from '../../src/lib/api';
import type { ModuleViewProps } from '../types';
import { LEVEL_MARK, LEVEL_WORD, levels, type BeheerStatus, type Level } from './status';

type Response = { configured: boolean; status: BeheerStatus | null };

const useStatus = () =>
  useQuery({
    queryKey: ['module', 'beheer', 'status'],
    queryFn: () => request<Response>('GET', '/modules/beheer/status'),
    refetchInterval: 60_000
  });

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const unixTime = (s: number) => time(new Date(s * 1000).toISOString());
const ago = (days: number | null) => (days === null ? 'onbekend' : days < 1 ? `${Math.round(days * 24)} uur geleden` : `${days.toFixed(1)} dagen geleden`);

export default function BeheerView(_props: ModuleViewProps) {
  const q = useStatus();
  const st = q.data?.status;
  const lv = st ? levels(st, new Date()) : null;

  return (
    <div className="ld">
      <div className="ld-wrap">
        <header className="ld-head">
          <div className="ld-top">
            <div>
              <div className="ld-label">HaasieOS · Homelab Supervisor</div>
              <h1 className="ld-h1">
                Beheer<span className="ld-cur" aria-hidden="true" />
              </h1>
              <p className="ld-sub">Stand van de omgeving volgens de Supervisor: containers, opslag, back-ups en wat agents deden.</p>
            </div>
            <div className="ld-bar">
              <button className="ld-btn ld-sec ld-sm" type="button" onClick={() => q.refetch()} disabled={q.isFetching}>
                {q.isFetching ? 'Laden…' : '⟳ Ververs'}
              </button>
            </div>
          </div>
          {st && (
            <p className="ld-meta ld-kosync" role="status">
              Supervisor-poll {time(st.checkedAt)} · <Badge level={lv!.supervisor} />
            </p>
          )}
        </header>

        {q.isLoading ? (
          <div className="ld-empty">Status ophalen bij de Supervisor…</div>
        ) : q.isError ? (
          <div className="ld-empty ld-error" role="alert">
            Supervisor niet bereikbaar: {q.error.message}
          </div>
        ) : !q.data?.configured ? (
          <div className="ld-empty">
            Nog niet gekoppeld. Zet <code>SUPERVISOR_URL</code> en <code>SUPERVISOR_TOKEN</code> in de omgeving van Taskgram.
          </div>
        ) : st && lv ? (
          <main className="ld-main">
            <div className="ld-tiles" role="list" aria-label="Stand">
              <Tile label="Containers" level={lv.containers} value={st.containers.total === null ? '?' : `${st.containers.total - st.containers.notRunning.length}/${st.containers.total}`} />
              <Tile label="Opslag" level={lv.storage} value={`${Math.max(0, ...st.storage.map((m) => m.percent ?? 0)).toFixed(0)}%`} />
              <Tile label="ZFS" level={lv.zfs} value={Object.values(st.zfs).every((v) => v === 'ONLINE') ? 'ONLINE' : 'FOUT'} />
              <Tile label="SMART" level={lv.smart} value={st.smart.allPassed ? 'OK' : st.smart.allPassed === false ? 'FOUT' : '?'} />
              <Tile label="Back-up" level={lv.backup} value={st.backup?.lastSuccessAgeDays == null ? '?' : `${Math.round(st.backup.lastSuccessAgeDays * 24)}u`} />
              <Tile label="Restore-test" level={lv.restore} value={st.restoreDrill ? (st.restoreDrill.ok ? 'OK' : 'FOUT') : '—'} />
            </div>

            <Section title="Aandacht" count={st.containers.notRunning.length + st.failedChecks.length}>
              <ul className="ld-list">
                {st.containers.notRunning.map((c) => (
                  <Row key={c} level="warn" title={c} meta="container draait niet" />
                ))}
                {st.failedChecks.map((c) => (
                  <Row key={c} level="warn" title={c} meta="check faalt" />
                ))}
              </ul>
            </Section>

            <Section title="Back-up & herstel" count={2}>
              <ul className="ld-list">
                <Row level={lv.backup} title="Offsite-back-up (restic → Google Drive)" meta={`laatste geslaagde run: ${ago(st.backup?.lastSuccessAgeDays ?? null)}`} />
                <Row
                  level={lv.restore}
                  title={`Restore-oefening${st.restoreDrill?.target ? ` (${st.restoreDrill.target})` : ''}`}
                  meta={st.restoreDrill ? `${time(st.restoreDrill.at)} · snapshot ${st.restoreDrill.snapshot ?? '?'} · ${st.restoreDrill.detail ?? ''}` : 'nog geen resultaat'}
                />
              </ul>
            </Section>

            <Section title="Opslag & schijven" count={st.storage.length + Object.keys(st.zfs).length + st.smart.disks.length}>
              <ul className="ld-list">
                {st.storage.map((m) => (
                  <Row key={m.label} level={(m.percent ?? 0) >= 95 ? 'alert' : (m.percent ?? 0) >= 85 ? 'warn' : 'ok'} title={m.label} meta={`${m.percent ?? '?'}% gebruikt`} />
                ))}
                {Object.entries(st.zfs).map(([pool, state]) => (
                  <Row key={pool} level={state === 'ONLINE' ? 'ok' : 'alert'} title={`ZFS-pool ${pool}`} meta={state} />
                ))}
                {st.smart.disks.map((d) => (
                  <Row key={d.name} level={d.passed === false ? 'alert' : d.passed ? 'ok' : 'unknown'} title={d.name} meta={`SMART ${d.passed ? 'geslaagd' : d.passed === false ? 'FOUT' : '?'}${d.temperatureC !== null ? ` · ${d.temperatureC}°C` : ''}`} />
                ))}
              </ul>
            </Section>

            <Section title="Netwerk & beveiliging" count={4}>
              <ul className="ld-list">
                <Row level={st.homeAssistant ? 'ok' : st.homeAssistant === false ? 'alert' : 'unknown'} title="Home Assistant" meta={st.homeAssistant ? 'bereikbaar' : 'niet bereikbaar'} />
                <Row level={st.dns.external === 'ok' ? 'ok' : 'warn'} title="Externe DNS ↔ IP" meta={st.dns.external ?? '?'} />
                <Row level={st.dns.host === 'ok' ? 'ok' : 'warn'} title="Host-DNS" meta={st.dns.host ?? '?'} />
                <Row level="ok" title="WAF-events (24 uur)" meta={`${st.security.events24h ?? '?'} events · ${st.security.noise24h ?? '?'} ruis`} />
              </ul>
            </Section>

            <Section title="Wat Claude deed" count={st.claude.recent.length}>
              <p className="ld-meta">
                {st.claude.calls24h ?? 0} diagnose(s) in 24 uur · {st.claude.pendingActions ?? 0} actie(s) wachten op goedkeuring
              </p>
              <ul className="ld-list">
                {st.claude.recent.slice(0, 10).map((c) => (
                  <Row key={`${c.ts}-${c.alertKey}`} level={c.risk === 'high' ? 'alert' : c.risk === 'medium' ? 'warn' : 'ok'} title={`${c.action} · ${c.alertKey}`} meta={`${unixTime(c.ts)} · ${c.host ?? 'haasieos'} · risico ${c.risk}${c.durationS !== null ? ` · ${c.durationS.toFixed(1)}s` : ''}`} />
                ))}
              </ul>
            </Section>

            <Section title="Audit-log" count={st.audit.length}>
              <ul className="ld-list">
                {st.audit.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="ld-item ld-audit">
                    <span className="ld-data">{unixTime(e.ts)}</span>
                    <div className="ld-t">
                      <span className="ld-title-static">{e.event}</span>
                      {e.summary && <div className="ld-meta">{e.summary}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function Badge({ level }: { level: Level }) {
  return (
    <span className={`bh-badge bh-${level}`}>
      {LEVEL_MARK[level]} {LEVEL_WORD[level]}
    </span>
  );
}

function Tile({ label, level, value }: { label: string; level: Level; value: string }) {
  return (
    <div className={`ld-tile bh-tile bh-${level}`} role="listitem">
      <span className="ld-label">{label}</span>
      <b>{value}</b>
      <Badge level={level} />
    </div>
  );
}

function Row({ level, title, meta }: { level: Level; title: string; meta: string }) {
  return (
    <li className="ld-item">
      <span className={`bh-mark bh-${level}`} aria-label={LEVEL_WORD[level]}>
        {LEVEL_MARK[level]}
      </span>
      <div className="ld-t">
        <span className="ld-title-static">{title}</span>
        <div className="ld-meta">{meta}</div>
      </div>
      <Badge level={level} />
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="ld-section" aria-label={title}>
      <div className="ld-sh">
        <h2>{title}</h2>
        <span className="ld-data">{count}</span>
      </div>
      {count ? children : <div className="ld-empty">Niets te melden.</div>}
    </section>
  );
}

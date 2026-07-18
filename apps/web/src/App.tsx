import { useMemo, useState, type DragEvent, type FormEvent } from 'react';

type AppStatus =
  | 'pending'
  | 'tailoring'
  | 'ready_for_review'
  | 'applied'
  | 'interview'
  | 'rejected'
  | 'offer';

type ApplicationRow = {
  application: {
    id: string;
    status: AppStatus;
    tailoredResumeUrl: string | null;
    coverLetterText: string | null;
    humanOverridden: boolean;
    notes: string | null;
  };
  jobPosting: {
    id: string;
    title: string;
    company: string;
    description: string;
    location: string | null;
    salaryRange: string | null;
  } | null;
  jobMatch: {
    matchScore: number;
    matchReasoning: string;
    fitHighlights: string[];
    redFlags: string[];
    decision: 'apply' | 'skip' | 'needs_review';
    confidence: number;
    status: string;
  } | null;
};

type DashboardResponse = { rows: ApplicationRow[] };

type TailorResponse = unknown;

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const STATUSES: AppStatus[] = [
  'pending',
  'tailoring',
  'ready_for_review',
  'applied',
  'interview',
  'rejected',
  'offer',
];

const NEXT_STATUS: Record<AppStatus, AppStatus | null> = {
  pending: 'tailoring',
  tailoring: 'ready_for_review',
  ready_for_review: 'applied',
  applied: 'interview',
  interview: 'offer',
  rejected: null,
  offer: null,
};

const PREV_STATUS: Record<AppStatus, AppStatus | null> = {
  pending: null,
  tailoring: 'pending',
  ready_for_review: 'tailoring',
  applied: 'ready_for_review',
  interview: 'applied',
  rejected: 'applied',
  offer: 'interview',
};

const STATUS_META: Record<AppStatus, { label: string; accent: string; badge: string }> = {
  pending: { label: 'Pending', accent: 'from-slate-500 to-slate-700', badge: 'bg-slate-500/15 text-slate-200' },
  tailoring: { label: 'Tailoring', accent: 'from-cyan-500 to-sky-600', badge: 'bg-sky-500/15 text-sky-200' },
  ready_for_review: { label: 'Ready', accent: 'from-emerald-500 to-teal-600', badge: 'bg-emerald-500/15 text-emerald-200' },
  applied: { label: 'Applied', accent: 'from-indigo-500 to-violet-600', badge: 'bg-indigo-500/15 text-indigo-200' },
  interview: { label: 'Interview', accent: 'from-fuchsia-500 to-pink-600', badge: 'bg-fuchsia-500/15 text-fuchsia-200' },
  rejected: { label: 'Rejected', accent: 'from-rose-500 to-red-600', badge: 'bg-rose-500/15 text-rose-200' },
  offer: { label: 'Offer', accent: 'from-amber-400 to-orange-500', badge: 'bg-amber-500/15 text-amber-200' },
};

const shellClass = 'mx-auto flex min-h-screen max-w-[1500px] flex-col gap-6 p-6';
const panelClass = 'rounded-3xl border border-slate-800 bg-slate-900/70 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur';
const innerPanelClass = 'rounded-2xl border border-slate-800 bg-slate-950/60 p-4 shadow-inner shadow-black/20';
const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30';
const textareaClass = `${inputClass} min-h-28 resize-y`;
const buttonClass =
  'inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 font-medium text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60';
const subtleButtonClass =
  'inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 transition hover:border-sky-400 hover:text-sky-200';

export default function App() {
  const [email, setEmail] = useState('demo@applypilot.dev');
  const [rawText, setRawText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [jobResult, setJobResult] = useState<unknown>(null);
  const [tailorResult, setTailorResult] = useState<unknown>(null);
  const [preferencesResult, setPreferencesResult] = useState<unknown>(null);
  const [dashboard, setDashboard] = useState<ApplicationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobPostingId, setJobPostingId] = useState('');
  const [jobTitle, setJobTitle] = useState('Senior Software Engineer');
  const [company, setCompany] = useState('Acme');
  const [jobDescription, setJobDescription] = useState(
    'Build reliable product features with TypeScript, React, and backend APIs.',
  );
  const [jobUrl, setJobUrl] = useState('');
  const [autonomyThreshold, setAutonomyThreshold] = useState('0.7');

  const selected = dashboard.find((row) => row.application.id === selectedId) ?? dashboard[0] ?? null;

  const grouped = useMemo(() => {
    return STATUSES.reduce<Record<AppStatus, ApplicationRow[]>>((acc, status) => {
      acc[status] = dashboard.filter((row) => row.application.status === status);
      return acc;
    }, {} as Record<AppStatus, ApplicationRow[]>);
  }, [dashboard]);

  const summary = useMemo(() => {
    const total = dashboard.length;
    const overridden = dashboard.filter((row) => row.application.humanOverridden).length;
    const ready = dashboard.filter((row) => row.application.status === 'ready_for_review').length;
    const avgConfidence =
      dashboard.length > 0
        ? Math.round((dashboard.reduce((acc, row) => acc + (row.jobMatch?.confidence ?? 0), 0) / dashboard.length) * 100)
        : 0;

    return { total, overridden, ready, avgConfidence };
  }, [dashboard]);

  const canSubmit = useMemo(
    () => Boolean(email.trim()) && Boolean(rawText.trim() || file),
    [email, rawText, file],
  );

  const refreshDashboard = async () => {
    if (!email.trim()) return;

    const response = await fetch(`${apiUrl}/users/${encodeURIComponent(email)}/applications`);
    const payload = (await response.json()) as DashboardResponse & { error?: string };
    if (!response.ok) throw new Error(payload?.error ?? 'Failed to load dashboard');

    setDashboard(payload.rows ?? []);
    setSelectedId((current) => current ?? payload.rows?.[0]?.application.id ?? null);
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const updateApplicationStatus = async (applicationId: string, status: AppStatus) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/applications/${applicationId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to update application');
      await refreshDashboard();
      setSelectedId(applicationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>, status: AppStatus) => {
    event.preventDefault();
    if (!draggingId) return;
    await updateApplicationStatus(draggingId, status);
    setDraggingId(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('email', email.trim());
      if (rawText.trim()) formData.append('rawText', rawText.trim());
      if (file) formData.append('resume', file);

      const response = await fetch(`${apiUrl}/resumes/upload`, {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload?.error ?? 'Upload failed');

      setResult(payload);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setPreferencesResult(null);

    const parsedThreshold = Number.parseFloat(autonomyThreshold);
    if (Number.isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1) {
      setError('Autonomy threshold must be a number between 0 and 1');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/users/${encodeURIComponent(email)}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomyThreshold: parsedThreshold }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to save preferences');
      setPreferencesResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const createManualJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setJobResult(null);

    try {
      const response = await fetch(`${apiUrl}/jobs/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobTitle,
          company,
          description: jobDescription,
          url: jobUrl || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; jobPosting?: { id?: string } };
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to create job');
      setJobResult(payload);
      setJobPostingId(payload?.jobPosting?.id ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const tailorJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTailorResult(null);

    try {
      const response = await fetch(`${apiUrl}/jobs/${jobPostingId}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: email }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to tailor');
      setTailorResult(payload as TailorResponse);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={shellClass}>
      <section className={`${panelClass} w-full p-6`}>
        <div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">ApplyPilot</p>
            <h1 className="text-4xl font-semibold text-white">Autonomous application dashboard</h1>
            <p className="mt-2 max-w-3xl text-slate-300">
              Upload a resume, set autonomy, create jobs, and move cards through the Kanban board.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void loadDashboard()} disabled={loading} className={buttonClass}>
              Load dashboard
            </button>
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
              {summary.total} total · {summary.ready} ready · {summary.overridden} overridden
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
              Avg confidence {summary.avgConfidence}%
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Applications', value: summary.total },
            { label: 'Ready for review', value: summary.ready },
            { label: 'Human overrides', value: summary.overridden },
            { label: 'Average confidence', value: `${summary.avgConfidence}%` },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-4">
            <form className={innerPanelClass} onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-white">Resume</h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-2 text-sm text-slate-200">
                  Email
                  <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                </label>
                <label className="grid gap-2 text-sm text-slate-200">
                  Resume file
                  <input
                    className="block w-full rounded-xl border border-dashed border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100 hover:file:bg-slate-700"
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-200">
                  Or raw text
                  <textarea className={textareaClass} value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} />
                </label>
                <button type="submit" disabled={!canSubmit || loading} className={buttonClass}>
                  {loading ? 'Working…' : 'Upload & parse'}
                </button>
              </div>
            </form>

            <form className={innerPanelClass} onSubmit={savePreferences}>
              <h2 className="text-lg font-semibold text-white">Planner settings</h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-2 text-sm text-slate-200">
                  Autonomy threshold (0-1)
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={autonomyThreshold}
                    onChange={(e) => setAutonomyThreshold(e.target.value)}
                  />
                </label>
                <button type="submit" disabled={loading} className={buttonClass}>
                  Save preferences
                </button>
              </div>
            </form>

            <form className={innerPanelClass} onSubmit={createManualJob}>
              <h2 className="text-lg font-semibold text-white">Manual job entry</h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-2 text-sm text-slate-200">
                  Title
                  <input className={inputClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-200">
                  Company
                  <input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-200">
                  Job URL (optional)
                  <input className={inputClass} value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-200">
                  Description
                  <textarea
                    className={textareaClass}
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    rows={6}
                  />
                </label>
                <button type="submit" disabled={loading} className={buttonClass}>
                  Create job
                </button>
              </div>
            </form>

            <form className={innerPanelClass} onSubmit={tailorJob}>
              <h2 className="text-lg font-semibold text-white">Plan and tailor</h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-2 text-sm text-slate-200">
                  Job posting ID
                  <input className={inputClass} value={jobPostingId} onChange={(e) => setJobPostingId(e.target.value)} />
                </label>
                <button type="submit" disabled={loading || !jobPostingId.trim()} className={buttonClass}>
                  {loading ? 'Planning…' : 'Run planner + tailor if approved'}
                </button>
              </div>
            </form>
          </div>

          <div className="grid gap-4">
            <div className={innerPanelClass}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Kanban board</h2>
                  <p className="text-sm text-slate-400">{dashboard.length} applications</p>
                </div>
                <p className="text-xs text-slate-500">Drag cards between columns</p>
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="grid min-w-[1400px] grid-cols-7 gap-3">
                  {STATUSES.map((status) => (
                    <div
                      key={status}
                      className="min-h-[260px] rounded-2xl border border-slate-800 bg-slate-950/50 p-3"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => void handleDrop(event, status)}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
                          {STATUS_META[status].label}
                        </h3>
                        <span className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs ${STATUS_META[status].badge}`}>
                          {grouped[status].length}
                        </span>
                      </div>
                      <div className={`mb-3 h-1.5 rounded-full bg-gradient-to-r ${STATUS_META[status].accent}`} />

                      <div className="grid gap-3">
                        {grouped[status].map((row) => (
                          <article
                            key={row.application.id}
                            className={`rounded-2xl border p-3 transition ${
                              selected?.application.id === row.application.id
                                ? 'border-sky-400/80 bg-slate-900 shadow-[0_0_0_1px_rgba(125,211,252,0.2)]'
                                : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                            }`}
                            draggable
                            onDragStart={() => setDraggingId(row.application.id)}
                            onClick={() => setSelectedId(row.application.id)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <strong className="block text-sm text-white">{row.jobPosting?.title ?? 'Untitled role'}</strong>
                                <p className="text-sm text-slate-400">{row.jobPosting?.company ?? 'Unknown company'}</p>
                              </div>
                              <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-widest ${STATUS_META[row.application.status].badge}`}>
                                {row.application.status}
                              </span>
                              {row.application.humanOverridden ? (
                                <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-amber-200">
                                  overridden
                                </span>
                              ) : null}
                            </div>

                            <p className="mt-2 text-xs text-slate-500">{row.jobPosting?.location ?? 'Location unknown'}</p>
                            {row.jobPosting?.salaryRange ? (
                              <p className="mt-1 text-xs text-slate-500">{row.jobPosting.salaryRange}</p>
                            ) : null}

                            {row.jobMatch ? (
                              <p className="mt-2 text-sm text-slate-200">
                                <span className="font-semibold">{Math.round(row.jobMatch.confidence * 100)}%</span> · {row.jobMatch.decision}
                              </p>
                            ) : null}

                            <div className="mt-3 flex items-center gap-2">
                              {PREV_STATUS[row.application.status] ? (
                                <button
                                  type="button"
                                  className={subtleButtonClass}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void updateApplicationStatus(row.application.id, PREV_STATUS[row.application.status]!);
                                  }}
                                >
                                  ←
                                </button>
                              ) : null}
                              {NEXT_STATUS[row.application.status] ? (
                                <button
                                  type="button"
                                  className={subtleButtonClass}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void updateApplicationStatus(row.application.id, NEXT_STATUS[row.application.status]!);
                                  }}
                                >
                                  →
                                </button>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {selected ? (
              <section className={innerPanelClass}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">Reasoning transparency</p>
                    <h2 className="text-2xl font-semibold text-white">{selected.jobPosting?.title ?? 'Application detail'}</h2>
                    <p className="text-slate-400">{selected.jobPosting?.company ?? 'Unknown company'}</p>
                  </div>
                  <button type="button" onClick={() => void refreshDashboard()} disabled={loading} className={buttonClass}>
                    Refresh
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-sm font-semibold text-white">Planner reasoning</h3>
                    <p className="mt-2 text-sm text-slate-300">{selected.jobMatch?.matchReasoning ?? 'No planner reasoning yet.'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-sm font-semibold text-white">Fit highlights</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                      {(selected.jobMatch?.fitHighlights ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-sm font-semibold text-white">Red flags</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                      {(selected.jobMatch?.redFlags ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-sm font-semibold text-white">Materials</h3>
                    {selected.application.tailoredResumeUrl ? (
                      <p className="mt-2 text-sm text-slate-300">
                        <a
                          className="text-sky-300 underline decoration-sky-500/50 underline-offset-4 hover:text-sky-200"
                          href={`${apiUrl}${selected.application.tailoredResumeUrl}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download tailored resume
                        </a>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-300">Resume: Not generated yet</p>
                    )}
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-950 p-3 text-xs leading-6 text-emerald-200">
                      {selected.application.coverLetterText ?? 'No cover letter draft yet.'}
                    </pre>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {error ? <p className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">{error}</p> : null}

        {result ? <pre className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-200">{JSON.stringify(result, null, 2)}</pre> : null}
        {preferencesResult ? <pre className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-200">{JSON.stringify(preferencesResult, null, 2)}</pre> : null}
        {jobResult ? <pre className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-200">{JSON.stringify(jobResult, null, 2)}</pre> : null}
        {tailorResult ? <pre className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-200">{JSON.stringify(tailorResult, null, 2)}</pre> : null}
      </section>
    </main>
  );
}

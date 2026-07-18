import { useMemo, useState, type FormEvent } from 'react';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export default function App() {
  const [email, setEmail] = useState('demo@applypilot.dev');
  const [rawText, setRawText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [jobResult, setJobResult] = useState<unknown>(null);
  const [tailorResult, setTailorResult] = useState<unknown>(null);
  const [preferencesResult, setPreferencesResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobPostingId, setJobPostingId] = useState('');
  const [jobTitle, setJobTitle] = useState('Senior Software Engineer');
  const [company, setCompany] = useState('Acme');
  const [jobDescription, setJobDescription] = useState('Build reliable product features with TypeScript, React, and backend APIs.');
  const [jobUrl, setJobUrl] = useState('');
  const [autonomyThreshold, setAutonomyThreshold] = useState('0.7');

  const canSubmit = useMemo(
    () => Boolean(email.trim()) && Boolean(rawText.trim() || file),
    [email, rawText, file],
  );

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

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Upload failed');
      }

      setResult(payload);
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

      const payload = await response.json();
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

      const payload = await response.json();
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

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to tailor');
      setTailorResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">ApplyPilot</p>
        <h1>Resume upload, planner, and manual tailoring</h1>
        <p>Upload a resume, set your autonomy threshold, create a job manually, then plan and tailor it.</p>

        <form className="upload-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </label>

          <label>
            Resume file
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label>
            Or raw text
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} />
          </label>

          <button type="submit" disabled={!canSubmit || loading}>
            {loading ? 'Parsing…' : 'Upload & parse'}
          </button>
        </form>

        <form className="upload-form" onSubmit={savePreferences}>
          <h2>Planner settings</h2>
          <label>
            Autonomy threshold (0-1)
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={autonomyThreshold}
              onChange={(e) => setAutonomyThreshold(e.target.value)}
            />
          </label>
          <button type="submit" disabled={loading}>Save preferences</button>
        </form>

        <form className="upload-form" onSubmit={createManualJob}>
          <h2>Manual job entry</h2>
          <label>
            Title
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
          <label>
            Company
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label>
            Job URL (optional)
            <input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
          </label>
          <label>
            Description
            <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} rows={6} />
          </label>
          <button type="submit" disabled={loading}>Create job</button>
        </form>

        <form className="upload-form" onSubmit={tailorJob}>
          <h2>Plan and tailor</h2>
          <label>
            Job posting ID
            <input value={jobPostingId} onChange={(e) => setJobPostingId(e.target.value)} />
          </label>
          <button type="submit" disabled={loading || !jobPostingId.trim()}>
            {loading ? 'Planning…' : 'Run planner + tailor if approved'}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}
        {result ? <pre className="result">{JSON.stringify(result, null, 2)}</pre> : null}
        {preferencesResult ? <pre className="result">{JSON.stringify(preferencesResult, null, 2)}</pre> : null}
        {jobResult ? <pre className="result">{JSON.stringify(jobResult, null, 2)}</pre> : null}
        {tailorResult ? <pre className="result">{JSON.stringify(tailorResult, null, 2)}</pre> : null}
      </section>
    </main>
  );
}

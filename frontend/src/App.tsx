import React, { FormEvent, useEffect, useState } from 'react';
import { RefreshCcw, Save, Server, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './main.css';

type Rule = {
  id: string;
  name: string;
  endpoint: string;
  headers: Record<string, string>;
  publicPort: number;
  mcpEnabled: boolean;
  enabled: boolean;
};

type Notice = { type: 'success' | 'error'; text: string } | null;

function parseHeaders(value: string) {
  if (!value.trim()) return {};
  return JSON.parse(value);
}

function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [certSaving, setCertSaving] = useState(false);
  const [form, setForm] = useState({
    name: 'Example API',
    endpoint: 'https://api.example.com/v1',
    publicPort: '8081',
    headers: '{\n  "Authorization": "Bearer token",\n  "Content-Type": "application/json"\n}',
    mcpEnabled: false,
  });
  const [files, setFiles] = useState<{
    certificate?: File;
    privateKey?: File;
    caBundle?: File;
  }>({});

  async function loadRules() {
    const response = await fetch('/api/rules');
    const data = await response.json();
    setRules(data.rules || []);
  }

  useEffect(() => {
    loadRules().catch((error) => setNotice({ type: 'error', text: error.message }));
  }, []);

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          endpoint: form.endpoint,
          publicPort: Number(form.publicPort),
          headers: parseHeaders(form.headers),
          mcpEnabled: form.mcpEnabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed.');
      setNotice({ type: 'success', text: data.message });
      await loadRules();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  async function uploadCertificate(event: FormEvent) {
    event.preventDefault();
    setCertSaving(true);
    setNotice(null);
    try {
      if (!files.certificate || !files.privateKey) {
        throw new Error('Certificate and private key are required.');
      }

      const body = new FormData();
      body.append('certificate', files.certificate);
      body.append('privateKey', files.privateKey);
      if (files.caBundle) body.append('caBundle', files.caBundle);

      const response = await fetch('/api/certificates', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed.');
      setNotice({ type: 'success', text: data.message });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Upload failed.' });
    } finally {
      setCertSaving(false);
    }
  }

  async function applyConfig() {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/apply', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Apply failed.');
      setNotice({ type: 'success', text: data.message });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Apply failed.' });
    } finally {
      setSaving(false);
    }
  }

  async function disableRule(id: string) {
    const response = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setNotice({ type: 'error', text: data.error || 'Disable failed.' });
      return;
    }
    setNotice({ type: 'success', text: data.message });
    await loadRules();
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Server size={20} /></div>
          <div>
            <h1>Nginx Proxy Manager</h1>
            <p>Reverse proxy, TLS, and MCP gateway controls</p>
          </div>
        </div>
        <button className="button secondary" onClick={applyConfig} disabled={saving}>
          <RefreshCcw size={17} /> Apply current config
        </button>
      </header>

      <section className="layout">
        <div className="stack">
          <form className="panel stack" onSubmit={uploadCertificate}>
            <h2>Certificate</h2>
            <label className="file-label">
              <span>Certificate PEM</span>
              <input type="file" accept=".pem,.crt,.cer" onChange={(event) => setFiles({ ...files, certificate: event.target.files?.[0] })} />
            </label>
            <label className="file-label">
              <span>Private key PEM</span>
              <input type="file" accept=".pem,.key" onChange={(event) => setFiles({ ...files, privateKey: event.target.files?.[0] })} />
            </label>
            <label className="file-label">
              <span>CA bundle PEM</span>
              <input type="file" accept=".pem,.crt,.ca-bundle" onChange={(event) => setFiles({ ...files, caBundle: event.target.files?.[0] })} />
            </label>
            <button className="button" disabled={certSaving}>
              <Upload size={17} /> Upload certificate
            </button>
          </form>

          <form className="panel stack" onSubmit={saveRule}>
            <h2>Proxy rule</h2>
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="field">
              <span>Target API endpoint</span>
              <input value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} />
            </label>
            <label className="field">
              <span>Public port</span>
              <input type="number" min="8080" max="8459" value={form.publicPort} onChange={(event) => setForm({ ...form, publicPort: event.target.value })} />
            </label>
            <label className="field">
              <span>Headers JSON</span>
              <textarea value={form.headers} onChange={(event) => setForm({ ...form, headers: event.target.value })} />
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.mcpEnabled} onChange={(event) => setForm({ ...form, mcpEnabled: event.target.checked })} />
              <span className="track" />
              <span>Enable MCP conversion</span>
            </label>
            <button className="button" disabled={saving}>
              <Save size={17} /> Save and apply
            </button>
          </form>
        </div>

        <section className="panel">
          <h2>Active forwarding rules</h2>
          {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}
          <div className="rules" style={{ marginTop: notice ? 14 : 0 }}>
            {rules.length === 0 && <p className="empty">No proxy rules are active.</p>}
            {rules.map((rule) => (
              <article className="rule" key={rule.id}>
                <div>
                  <h3>{rule.name}</h3>
                  <p>{rule.endpoint}</p>
                  <div className="badges">
                    <span className="badge">:{rule.publicPort}</span>
                    <span className="badge">{rule.mcpEnabled ? 'MCP JSON-RPC' : 'HTTP reverse proxy'}</span>
                    <span className="badge">{Object.keys(rule.headers).length} headers</span>
                    {rule.publicPort >= 8443 && <span className="badge"><ShieldCheck size={12} /> TLS port</span>}
                  </div>
                </div>
                <button className="button danger" aria-label={`Disable ${rule.name}`} onClick={() => disableRule(rule.id)}>
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

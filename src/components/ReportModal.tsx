// ─── FlowGuard Report Generation Modal ───────────────────────────────────────
import { useState, useEffect } from 'react';
import { FileText, Download, X, Printer } from 'lucide-react';
import { fetchExperimentRuns, fetchRunReport, fetchCustomReport } from '../api/client';
import type { EvaluationReportDTO } from '../api/types';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReportModal({ isOpen, onClose }: ReportModalProps) {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('all');
  const [scenarioFilter, setScenarioFilter] = useState<string>('');
  const [includeRawIps, setIncludeRawIps] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<EvaluationReportDTO | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchExperimentRuns()
        .then(res => setRuns(res.runs || []))
        .catch(err => console.warn('Could not fetch runs:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGeneratePreview = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      let data: EvaluationReportDTO;
      if (selectedRunId !== 'all') {
        data = await fetchRunReport(selectedRunId, 'json', includeRawIps);
      } else {
        data = await fetchCustomReport(scenarioFilter || undefined, undefined, undefined, 'json', includeRawIps);
      }
      setReportData(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate report');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (format: 'csv' | 'json' | 'html') => {
    try {
      let content: string;
      if (selectedRunId !== 'all') {
        content = await fetchRunReport(selectedRunId, format, includeRawIps);
      } else {
        content = await fetchCustomReport(scenarioFilter || undefined, undefined, undefined, format, includeRawIps);
      }

      if (format === 'html') {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(content);
          win.document.close();
        }
        return;
      }

      const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowguard_report_${selectedRunId}_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 700, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8, padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="var(--blue)" />
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Generate Evaluation &amp; Performance Report
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', marginBottom: 4 }}>
              EXPERIMENT RUN
            </label>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 4,
                backgroundColor: 'var(--bg-card-subtle)',
                color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <option value="all">All Stored Lab Flows (Aggregate)</option>
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id} ({r.scenario_id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', marginBottom: 4 }}>
              SCENARIO FILTER
            </label>
            <select
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 4,
                backgroundColor: 'var(--bg-card-subtle)',
                color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <option value="">All Scenarios</option>
              <option value="benign_http">Benign HTTP</option>
              <option value="benign_repeated">Benign Repeated</option>
              <option value="port_scan">SYN Port Scan</option>
              <option value="server_failure">Server Failure</option>
            </select>
          </div>
        </div>

        {/* Privacy toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem' }}>
          <input
            type="checkbox"
            id="chk-raw-ip"
            checked={includeRawIps}
            onChange={(e) => setIncludeRawIps(e.target.checked)}
          />
          <label htmlFor="chk-raw-ip" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Include unmasked raw IP addresses (Lab debugging only; defaults to masked)
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleGeneratePreview}
            disabled={isLoading}
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)' }}
          >
            {isLoading ? 'Generating...' : 'Preview Report'}
          </button>
          <button
            onClick={() => handleDownload('json')}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', gap: 4 }}
          >
            <Download size={12} /> JSON
          </button>
          <button
            onClick={() => handleDownload('csv')}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', gap: 4 }}
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={() => handleDownload('html')}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)', gap: 4 }}
          >
            <Printer size={12} /> Printable HTML
          </button>
        </div>

        {errorMsg && (
          <div style={{ padding: 10, background: 'var(--red-dim)', color: 'var(--red)', borderRadius: 4, fontSize: 'var(--text-xs)', marginBottom: '1rem' }}>
            {errorMsg}
          </div>
        )}

        {/* Report Preview */}
        {reportData && (
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'var(--bg-card-subtle)',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="mono" style={{ color: 'var(--text-dim)' }}>{reportData.report_id}</span>
              <span
                style={{
                  padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                  backgroundColor: reportData.executive_summary.status === 'PASSED' ? 'var(--green-dim)' : 'var(--amber-dim)',
                  color: reportData.executive_summary.status === 'PASSED' ? 'var(--green)' : 'var(--amber)',
                }}
              >
                {reportData.executive_summary.status}
              </span>
            </div>

            <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)' }}>
              {reportData.executive_summary.message}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '10px 0' }}>
              <div style={{ padding: 8, background: 'var(--bg-card)', borderRadius: 4 }}>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>TOTAL FLOWS</span>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{reportData.executive_summary.total_flows}</div>
              </div>
              <div style={{ padding: 8, background: 'var(--bg-card)', borderRadius: 4 }}>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>LABELED FLOWS</span>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{reportData.executive_summary.labeled_flows}</div>
              </div>
              <div style={{ padding: 8, background: 'var(--bg-card)', borderRadius: 4 }}>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>UNLABELED FLOWS</span>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{reportData.executive_summary.unlabeled_flows}</div>
              </div>
            </div>

            {reportData.evaluation?.metrics ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Key Metrics:</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  <div>Balanced Accuracy: <strong>{((reportData.evaluation.metrics.balanced_accuracy ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>Attack Recall: <strong>{((reportData.evaluation.metrics.attack_recall ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>Benign False Positive Rate: <strong>{((reportData.evaluation.metrics.benign_false_positive_rate ?? 0) * 100).toFixed(1)}%</strong></div>
                  <div>F1 Score: <strong>{((reportData.evaluation.metrics.f1_score ?? 0) * 100).toFixed(1)}%</strong></div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, color: 'var(--amber)', fontStyle: 'italic' }}>
                Note: Supervised metrics unavailable because flows are unlabeled.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

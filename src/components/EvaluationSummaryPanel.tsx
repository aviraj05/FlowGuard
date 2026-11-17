// ─── FlowGuard Evaluation & Performance Gates Summary Panel ─────────────────
import { useState, useEffect } from 'react';
import { ShieldCheck, AlertCircle, FileText, CheckCircle2, XCircle, Info } from 'lucide-react';
import { fetchCustomReport } from '../api/client';
import type { EvaluationReportDTO } from '../api/types';

interface EvaluationSummaryPanelProps {
  onOpenReportModal: () => void;
  totalLiveEvents: number;
}

export default function EvaluationSummaryPanel({ onOpenReportModal, totalLiveEvents }: EvaluationSummaryPanelProps) {
  const [report, setReport] = useState<EvaluationReportDTO | null>(null);

  useEffect(() => {
    // Fetch aggregate evaluation status
    fetchCustomReport()
      .then((data) => setReport(data))
      .catch((err) => console.warn('Could not fetch evaluation summary:', err));
  }, [totalLiveEvents]);

  const summary = report?.executive_summary;
  const metrics = report?.evaluation?.metrics;
  const status = summary?.status || 'UNLABELED';

  const statusBadge = {
    PASSED: { bg: 'var(--green-dim)', color: 'var(--green)', border: 'var(--green-border)', label: 'GATES PASSED', icon: CheckCircle2 },
    FAILED: { bg: 'var(--red-dim)', color: 'var(--red)', border: 'var(--red-border)', label: 'TARGETS MISSED', icon: XCircle },
    INSUFFICIENT_SAMPLES: { bg: 'var(--amber-dim)', color: 'var(--amber)', border: 'var(--amber-border)', label: 'INSUFFICIENT SAMPLES', icon: AlertCircle },
    UNLABELED: { bg: 'var(--border-subtle)', color: 'var(--text-muted)', border: 'var(--border-subtle)', label: 'NOT EVALUATED (UNLABELED)', icon: Info },
  }[status] || { bg: 'var(--border-subtle)', color: 'var(--text-muted)', border: 'var(--border-subtle)', label: status, icon: Info };

  const { icon: StatusIcon } = statusBadge;

  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: '1rem',
        backgroundColor: 'var(--bg-card)',
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={16} color="var(--blue)" />
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Model Evaluation &amp; Performance Gates
          </h3>
        </div>

        {/* Status Badge */}
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 4,
            backgroundColor: statusBadge.bg, color: statusBadge.color,
            border: `1px solid ${statusBadge.border}`,
            fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.04em',
          }}
        >
          <StatusIcon size={12} />
          <span>{statusBadge.label}</span>
        </div>
      </div>

      {/* Target Gates vs Actual */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {/* False Positive Rate */}
        <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Benign FPR (Target &le; 5%)
          </div>
          <div className="mono" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: metrics?.benign_false_positive_rate !== undefined ? (metrics.benign_false_positive_rate <= 0.05 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
            {metrics?.benign_false_positive_rate !== undefined ? `${(metrics.benign_false_positive_rate * 100).toFixed(1)}%` : 'N/A'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
            {metrics?.benign_fpr_ci_95 ? `95% CI: [${metrics.benign_fpr_ci_95[0]}, ${metrics.benign_fpr_ci_95[1]}]` : 'Requires labeled Normal'}
          </div>
        </div>

        {/* Attack Recall */}
        <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Attack Recall (Target &ge; 80%)
          </div>
          <div className="mono" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: metrics?.attack_recall !== undefined ? (metrics.attack_recall >= 0.80 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
            {metrics?.attack_recall !== undefined ? `${(metrics.attack_recall * 100).toFixed(1)}%` : 'N/A'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
            {metrics?.attack_recall_ci_95 ? `95% CI: [${metrics.attack_recall_ci_95[0]}, ${metrics.attack_recall_ci_95[1]}]` : 'Requires labeled Attack'}
          </div>
        </div>

        {/* Balanced Accuracy */}
        <div style={{ padding: '8px 10px', background: 'var(--bg-card-subtle)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Balanced Acc (Target &ge; 80%)
          </div>
          <div className="mono" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: metrics?.balanced_accuracy !== undefined ? (metrics.balanced_accuracy >= 0.80 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
            {metrics?.balanced_accuracy !== undefined ? `${(metrics.balanced_accuracy * 100).toFixed(1)}%` : 'N/A'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
            Arithmetic mean of Recall &amp; Specificity
          </div>
        </div>
      </div>

      {/* Operational Note & Action Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          <span>Contract: <strong>DT-90</strong> (Decision Tree, 90 features)</span>
          <span style={{ margin: '0 6px' }}>&bull;</span>
          <span>Imputation Rate: <strong>{report?.evaluation?.operational_telemetry?.avg_imputation_rate !== undefined ? `${(report.evaluation.operational_telemetry.avg_imputation_rate * 100).toFixed(1)}%` : 'N/A'}</strong></span>
        </div>

        <button
          onClick={onOpenReportModal}
          className="btn btn-secondary"
          style={{ padding: '4px 10px', fontSize: 'var(--text-2xs)', gap: 5 }}
        >
          <FileText size={12} color="var(--blue)" />
          Generate Report
        </button>
      </div>
    </div>
  );
}

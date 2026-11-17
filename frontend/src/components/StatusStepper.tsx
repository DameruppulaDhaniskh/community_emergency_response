import type { IncidentStatus } from '../api/types';

export const INCIDENT_STEPS: Array<{ status: IncidentStatus; label: string }> = [
  { status: 'REPORTED', label: 'Reported' },
  { status: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { status: 'ASSIGNED', label: 'Assigned' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'RESOLVED', label: 'Resolved' },
  { status: 'CLOSED', label: 'Closed' },
];

interface StatusStepperProps {
  status: IncidentStatus;
  isEscalated?: boolean;
}

export default function StatusStepper({ status, isEscalated = false }: StatusStepperProps) {
  const currentIdx = Math.max(
    0,
    INCIDENT_STEPS.findIndex((s) => s.status === status)
  );

  return (
    <div className="card" aria-label="Incident status progress">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <span style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
          INCIDENT LIFECYCLE STAGE ({currentIdx + 1} OF {INCIDENT_STEPS.length})
        </span>
        {isEscalated && (
          <span className="chip bad">Escalated to Administration</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {INCIDENT_STEPS.map((item, idx) => {
          const passed = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <div
              key={item.status}
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '99px',
                  background: passed ? '#D9381E' : '#E3E3EA',
                  transition: 'background 0.25s ease',
                }}
              />
              <div
                style={{
                  font: isCurrent ? '800 13px Inter' : '700 12px Inter',
                  color: passed ? '#B93412' : '#5B5B6B',
                }}
              >
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


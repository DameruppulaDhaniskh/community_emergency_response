import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIncidents, getIncidentsPaginated } from '../../api/incidents';
import type { EmergencyType, IncidentStatus } from '../../api/types';
import {
  EMERGENCY_TYPE_LABELS,
  STATUS_LABELS,
  formatDistanceToNow,
  mapApiError,
} from '../../lib/formatters';
import StatusBadge, { incidentStatusVariant } from '../../components/StatusBadge';
import { SkeletonTable } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { Search, ChevronLeft, ChevronRight, ShieldCheck, AlertTriangle } from 'lucide-react';

const STATUS_OPTIONS: Array<{ value: '' | IncidentStatus; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const CATEGORY_OPTIONS: Array<{ value: '' | EmergencyType; label: string }> = [
  { value: '', label: 'All Categories' },
  { value: 'medical', label: 'Medical' },
  { value: 'fall', label: 'Fall / Injury' },
  { value: 'fire', label: 'Fire' },
  { value: 'security', label: 'Security' },
  { value: 'accident', label: 'Accident' },
  { value: 'other', label: 'Other' },
];

export default function AdminIncidentDashboard() {
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<'' | IncidentStatus>('');
  const [categoryFilter, setCategoryFilter] = useState<'' | EmergencyType>('');
  const [assignedFilter, setAssignedFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [ordering, setOrdering] = useState('-created_at');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Summary counts across all society incidents
  const { data: summaryList } = useQuery({
    queryKey: ['incidents', 'admin-summary'],
    queryFn: () => getIncidents(),
    refetchInterval: 12_000,
  });

  // Filterable, searchable, paginated table query
  const {
    data: paginated,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['incidents', 'admin-table', statusFilter, categoryFilter, assignedFilter, search, ordering, page],
    queryFn: () =>
      getIncidentsPaginated({
        status: statusFilter,
        category: categoryFilter,
        assigned_to: assignedFilter,
        search: search.trim(),
        ordering,
        page,
        page_size: pageSize,
      }),
    refetchInterval: 10_000,
  });

  const allSummary = summaryList || [];
  const countBy = (s: IncidentStatus) => allSummary.filter((i) => i.status === s).length;
  const escalatedCount = allSummary.filter((i) => i.is_escalated && i.status !== 'CLOSED').length;

  const rows = paginated?.results || [];
  const totalCount = paginated?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const applyQuickStatus = (next: '' | IncidentStatus) => {
    setStatusFilter(next);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Incident Operations Center
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Triage reports, assign available volunteers, and track resolution across your societies.
          </p>
        </div>
        {escalatedCount > 0 && (
          <span className="chip bad flex items-center gap-1.5" style={{ fontSize: '13px', padding: '6px 12px' }}>
            <AlertTriangle className="w-3.5 h-3.5 inline" />
            {escalatedCount} Escalated
          </span>
        )}
      </div>

      {/* Stat Cards by Status */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(
          [
            { key: 'REPORTED', label: 'REPORTED', color: '#92400E' },
            { key: 'ACKNOWLEDGED', label: 'ACKNOWLEDGED', color: '#1E40AF' },
            { key: 'ASSIGNED', label: 'ASSIGNED', color: '#1E40AF' },
            { key: 'IN_PROGRESS', label: 'IN PROGRESS', color: '#991B1B' },
            { key: 'RESOLVED', label: 'RESOLVED', color: '#166534' },
            { key: 'CLOSED', label: 'CLOSED', color: '#5B5B6B' },
          ] as Array<{ key: IncidentStatus; label: string; color: string }>
        ).map((card) => {
          const isSelected = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => applyQuickStatus(isSelected ? '' : card.key)}
              className="card text-left cursor-pointer transition-all"
              style={{
                padding: '16px',
                border: isSelected ? '2px solid #D9381E' : '2px solid transparent',
              }}
            >
              <div style={{ font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
                {card.label}
              </div>
              <div style={{ font: '800 26px Inter', marginTop: '4px', color: card.color }}>
                {countBy(card.key)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter & Search Bar */}
      <div className="card flex flex-wrap gap-3 items-center" style={{ padding: '16px 18px' }}>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#5B5B6B' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search title, description, or resident..."
            className="fld"
            style={{ paddingLeft: '38px' }}
          />
        </div>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => applyQuickStatus(e.target.value as '' | IncidentStatus)}
          className="fld"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value as '' | EmergencyType);
            setPage(1);
          }}
          className="fld"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by assignment"
          value={assignedFilter}
          onChange={(e) => {
            setAssignedFilter(e.target.value);
            setPage(1);
          }}
          className="fld"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          <option value="">All Assignments</option>
          <option value="unassigned">Unassigned Only</option>
        </select>

        <select
          aria-label="Sort incidents"
          value={ordering}
          onChange={(e) => {
            setOrdering(e.target.value);
            setPage(1);
          }}
          className="fld"
          style={{ width: 'auto', minWidth: '140px' }}
        >
          <option value="-created_at">Newest First</option>
          <option value="created_at">Oldest First</option>
          <option value="status">By Status</option>
        </select>
      </div>

      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Failed to load incidents table.')}
          onRetry={() => refetch()}
        />
      )}

      {/* Incidents Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '16px' }}>
            <SkeletonTable count={5} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '24px' }}>
            <EmptyState
              icon={<ShieldCheck className="w-5 h-5 text-[#166534]" />}
              title="No matching incidents"
              description="No society incidents matched your active filters or search query."
              action={
                (statusFilter || categoryFilter || assignedFilter || search) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('');
                      setCategoryFilter('');
                      setAssignedFilter('');
                      setSearch('');
                      setPage(1);
                    }}
                    className="ghost"
                  >
                    Reset all filters
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid #F0F0F4', background: '#F7F7FA' }}>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>INCIDENT</th>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>CATEGORY</th>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>RESIDENT</th>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>ASSIGNED VOLUNTEER</th>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>STATUS</th>
                  <th style={{ padding: '12px 16px', font: '700 11px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>REPORTED</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inc) => {
                  const catLabel = EMERGENCY_TYPE_LABELS[inc.category || inc.emergency_type] || 'Other';
                  return (
                    <tr
                      key={inc.id}
                      onClick={() => navigate(`/admin/incidents/${inc.id}`)}
                      className="cursor-pointer hover:bg-[#FFF8F5] transition-colors"
                      style={{ borderBottom: '1px solid #F0F0F4' }}
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <div className="flex items-center gap-2">
                          <span style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                            #{inc.id} · {inc.title || `SOS: ${catLabel}`}
                          </span>
                          {inc.is_escalated && <span className="chip bad">Escalated</span>}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', font: '600 13px Inter', color: '#4A4A5A' }}>
                        {catLabel}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ font: '600 13px Inter', color: '#1A1A2E' }}>{inc.resident_name}</div>
                        <div style={{ font: '500 11px Inter', color: '#5B5B6B' }}>{inc.flat_number || 'Resident'}</div>
                      </td>
                      <td style={{ padding: '14px 16px', font: '600 13px Inter', color: inc.assigned_to ? '#1A1A2E' : '#92400E' }}>
                        {inc.assigned_to ? inc.assigned_to.name : 'Unassigned'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge
                          variant={incidentStatusVariant(inc.status)}
                          label={STATUS_LABELS[inc.status] || inc.status}
                        />
                      </td>
                      <td style={{ padding: '14px 16px', font: '500 12px Inter', color: '#5B5B6B' }}>
                        {formatDistanceToNow(inc.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalCount > 0 && (
          <div
            className="flex items-center justify-between px-4 py-3 flex-wrap gap-2"
            style={{ borderTop: '1px solid #F0F0F4', font: '600 13px Inter', color: '#5B5B6B' }}
          >
            <span>
              Page {page} of {totalPages} · {totalCount} incident{totalCount === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!paginated?.previous || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ghost"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                type="button"
                disabled={!paginated?.next}
                onClick={() => setPage((p) => p + 1)}
                className="ghost"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


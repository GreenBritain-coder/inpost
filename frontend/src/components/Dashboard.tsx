import { useEffect, useState } from 'react';
import { api, TrackingNumber, Box, TrackingEvent } from '../api/api';
import './Dashboard.css';

const STATUS_COLORS = {
  not_scanned: '#e74c3c',
  scanned: '#f39c12',
  delivered: '#27ae60',
};

const STATUS_EMOJIS = {
  not_scanned: '🔴',
  scanned: '🟡',
  delivered: '🟢',
};

const STATUS_LABELS = {
  not_scanned: 'Not Collected',
  scanned: 'In Transit',
  delivered: 'Ready for Pickup',
};

export default function Dashboard() {
  const [trackingNumbers, setTrackingNumbers] = useState<TrackingNumber[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [kingBoxes, setKingBoxes] = useState<Box[]>([]);
  const [selectedKingBox, setSelectedKingBox] = useState<number | null>(null);
  const [selectedBox, setSelectedBox] = useState<number | null | -1>(null);
  const [selectedStatus, setSelectedStatus] = useState<'not_scanned' | 'scanned' | 'delivered' | null>(null);
  const [selectedCustomTimestamp, setSelectedCustomTimestamp] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [editingTrackingId, setEditingTrackingId] = useState<number | null>(null);
  const [customTimestamp, setCustomTimestamp] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [totalItems, setTotalItems] = useState(0);
  const [stats, setStats] = useState({
    not_scanned: 0,
    scanned: 0,
    delivered: 0,
    total: 0
  });
  const [selectedTrackingId, setSelectedTrackingId] = useState<number | null>(null);
  const [trackingEvents, setTrackingEvents] = useState<TrackingEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadData();
    loadKingBoxes();
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [selectedBox, selectedStatus, selectedCustomTimestamp, searchTerm, currentPage, itemsPerPage, selectedKingBox]);

  useEffect(() => {
    // Reset selected box when king box changes (but keep unassigned filter if set)
    if (selectedBox !== -1) {
      setSelectedBox(null);
    }
    loadBoxes();
  }, [selectedKingBox]);

  const loadKingBoxes = async () => {
    try {
      const response = await api.getKingBoxes();
      setKingBoxes(response.data);
    } catch (err: any) {
      console.error('Failed to load king boxes:', err);
    }
  };

  const loadBoxes = async () => {
    try {
      const response = await api.getBoxes(selectedKingBox || null);
      setBoxes(response.data);
    } catch (err: any) {
      console.error('Failed to load boxes:', err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const trackingRes = await api.getTrackingNumbers(
        selectedBox === -1 ? undefined : (selectedBox || undefined),
        currentPage,
        itemsPerPage,
        selectedStatus || undefined,
        selectedCustomTimestamp || undefined,
        searchTerm || undefined,
        selectedBox === -1, // unassignedOnly flag
        selectedKingBox || undefined // kingBoxId filter
      );
      setTrackingNumbers(trackingRes.data.data);
      setTotalItems(trackingRes.data.total);
      setStats(trackingRes.data.stats);
      setError('');
      // Clear selected items when data changes (filters, pagination, etc.)
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this tracking number?')) {
      return;
    }

    try {
      await api.deleteTrackingNumber(id);
      loadData();
      // Remove from selected if it was selected
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      alert('Please select at least one tracking number to delete');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedIds.size} tracking number(s)?`)) {
      return;
    }

    try {
      await api.bulkDeleteTrackingNumbers(Array.from(selectedIds));
      setSelectedIds(new Set());
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete tracking numbers');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(trackingNumbers.map(tn => tn.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  };

  const isAllSelected = trackingNumbers.length > 0 && selectedIds.size === trackingNumbers.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < trackingNumbers.length;

  const handleRefreshSingle = async (id: number) => {
    try {
      await api.refreshTrackingNumber(id);
      loadData(); // Reload data to show updated status
      // Reload events if modal is open
      if (selectedTrackingId === id) {
        loadTrackingEvents(id);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to refresh tracking number');
    }
  };

  const loadTrackingEvents = async (id: number) => {
    try {
      setLoadingEvents(true);
      const response = await api.getTrackingEvents(id);
      setTrackingEvents(response.data);
    } catch (err: any) {
      console.error('Failed to load tracking events:', err);
      setTrackingEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleTrackingNumberClick = (id: number) => {
    setSelectedTrackingId(id);
    loadTrackingEvents(id);
  };

  const closeEventModal = () => {
    setSelectedTrackingId(null);
    setTrackingEvents([]);
  };


  const handleRefresh = async () => {
    if (!confirm('This will refresh all tracking statuses. This may take a few minutes. Continue?')) {
      return;
    }

    try {
      setRefreshing(true);
      await api.refreshTrackingStatuses();
      alert('Refresh started! Statuses will update shortly. The page will refresh in 10 seconds.');
      // Reload data after a delay to see updated statuses
      setTimeout(() => {
        loadData();
        setRefreshing(false);
      }, 10000);
    } catch (err: any) {
      setRefreshing(false);
      alert(err.response?.data?.error || 'Failed to start refresh');
    }
  };


  const handleStatusChange = async (
    id: number, 
    newStatus: 'not_scanned' | 'scanned' | 'delivered',
    timestamp?: string | null
  ) => {
    try {
      await api.updateTrackingStatus(id, newStatus, timestamp);
      // Reload data to show updated status
      loadData();
      setEditingTrackingId(null);
      setCustomTimestamp('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleBoxChange = async (id: number, boxId: number | null) => {
    try {
      await api.updateTrackingNumberBox(id, boxId);
      // Reload data to show updated box
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update box');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + 
           date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  // Get the most recently updated tracking number
  const getMostRecentUpdate = () => {
    if (trackingNumbers.length === 0) return null;
    return trackingNumbers.reduce((latest, current) => {
      return new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest;
    });
  };

  const mostRecent = getMostRecentUpdate();

  if (loading && trackingNumbers.length === 0) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>📊 Dashboard</h2>
        <div className="dashboard-actions">
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="bulk-delete-btn"
            >
              🗑️ Delete Selected ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="refresh-btn"
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh All Statuses'}
          </button>
        </div>
      </div>

      <div className="filter-controls">
        <label className="search-tracking-label">
          <span style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600, color: '#2c3e50' }}>
            🔍 Search Tracking Number
          </span>
          <input
            type="text"
            placeholder="Enter tracking number to search..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1); // Reset to first page when search changes
            }}
          />
        </label>
        <label>
          Filter by King Box:
          <select
            value={selectedKingBox || ''}
            onChange={(e) => {
              setSelectedKingBox(e.target.value ? parseInt(e.target.value) : null);
              setCurrentPage(1); // Reset to first page when filter changes
            }}
            aria-label="Filter by King Box"
          >
            <option value="">All King Boxes</option>
            {kingBoxes.map((kingBox) => (
              <option key={kingBox.id} value={kingBox.id}>
                👑 {kingBox.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter by Box:
          <select
            value={selectedBox === -1 ? -1 : (selectedBox || '')}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '-1') {
                setSelectedBox(-1); // Special value for unassigned
              } else if (value === '') {
                setSelectedBox(null);
              } else {
                setSelectedBox(parseInt(value));
              }
              setCurrentPage(1); // Reset to first page when filter changes
            }}
            aria-label="Filter by Box"
          >
            <option value="">All Boxes</option>
            <option value="-1">📦 No Box (Unassigned)</option>
            {boxes.map((box) => (
              <option key={box.id} value={box.id}>
                {box.is_king_box ? '👑 ' : ''}{box.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter by Status:
          <select
            value={selectedStatus || ''}
            onChange={(e) => {
              const value = e.target.value;
              setSelectedStatus(value ? value as 'not_scanned' | 'scanned' | 'delivered' : null);
              setCurrentPage(1); // Reset to first page when filter changes
            }}
            aria-label="Filter by Status"
          >
            <option value="">All Statuses</option>
            <option value="not_scanned">🔴 Not Collected ({stats.not_scanned})</option>
            <option value="scanned">🟡 In Transit ({stats.scanned})</option>
            <option value="delivered">🟢 Ready for Pickup ({stats.delivered})</option>
          </select>
        </label>
        <label>
          Filter by Custom Timestamp:
          <input
            type="date"
            value={selectedCustomTimestamp || ''}
            onChange={(e) => {
              setSelectedCustomTimestamp(e.target.value || null);
              setCurrentPage(1); // Reset to first page when filter changes
            }}
          />
        </label>
        <label>
          Items per page:
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(parseInt(e.target.value));
              setCurrentPage(1); // Reset to first page when page size changes
            }}
            aria-label="Items per page"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stats">
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.not_scanned }}>
          <div className="stat-emoji">{STATUS_EMOJIS.not_scanned}</div>
          <div className="stat-value">
            {stats.not_scanned}
          </div>
          <div className="stat-label">Not Collected</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.scanned }}>
          <div className="stat-emoji">{STATUS_EMOJIS.scanned}</div>
          <div className="stat-value">
            {stats.scanned}
          </div>
          <div className="stat-label">In Transit</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.delivered }}>
          <div className="stat-emoji">{STATUS_EMOJIS.delivered}</div>
          <div className="stat-value">
            {stats.delivered}
          </div>
          <div className="stat-label">Ready for Pickup</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      {mostRecent && (
        <div className="last-update-banner">
          <div className="last-update-icon">
            {STATUS_EMOJIS[mostRecent.current_status]}
          </div>
          <div className="last-update-content">
            <div className="last-update-label">Last Status Update</div>
            <div className="last-update-text">
              <strong>{mostRecent.tracking_number}</strong> - {STATUS_LABELS[mostRecent.current_status]} 
              {mostRecent.box_name && ` (${mostRecent.box_name})`}
            </div>
            <div className="last-update-time">Updated {formatDate(mostRecent.updated_at)}</div>
          </div>
        </div>
      )}

      <div className="tracking-table-container">
        <table className="tracking-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = isSomeSelected;
                  }}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  aria-label="Select all tracking numbers"
                />
              </th>
              <th>Status</th>
              <th>Status Details</th>
              <th>Pickup Code</th>
              <th>Location</th>
              <th>Tracking Number</th>
              <th>Box</th>
              <th>TrackingMore Status</th>
              <th>Custom Timestamp</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trackingNumbers.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty-state">
                  No tracking numbers found
                </td>
              </tr>
            ) : (
              trackingNumbers.map((tn) => {
                const renderTimestampEdit = () => (
                  editingTrackingId === tn.id ? (
                <div className="timestamp-edit">
                  <input
                    type="date"
                    value={customTimestamp || (tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '')}
                    onChange={(e) => setCustomTimestamp(e.target.value)}
                    aria-label={`Edit custom timestamp for tracking number ${tn.tracking_number}`}
                    onPaste={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const pastedText = e.clipboardData.getData('text').trim();
                          console.log('Pasted text:', pastedText);
                          
                          let parsedDate = '';
                          let parsedTime = '00:00:00';
                          
                          const commaMatch = pastedText.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)/);
                          if (commaMatch) {
                            const datePart = commaMatch[1];
                            const timePart = commaMatch[2];
                            const parts = datePart.split(/[\/\-]/);
                            const day = parts[0].padStart(2, '0');
                            const month = parts[1].padStart(2, '0');
                            const year = parts[2];
                            parsedDate = `${year}-${month}-${day}`;
                            const timeParts = timePart.split(':');
                            parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                            console.log('Converted (comma format):', parsedDate, parsedTime);
                          }
                          else if (/^\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(pastedText)) {
                            const parts = pastedText.split(/\s+/);
                            parsedDate = parts[0];
                            if (parts[1]) {
                              const timeParts = parts[1].split(':');
                              parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                            }
                          } 
                          else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}(\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(pastedText)) {
                            const parts = pastedText.split(/\s+/);
                            const datePart = parts[0];
                            const dateParts = datePart.split(/[\/\-]/);
                            const day = dateParts[0].padStart(2, '0');
                            const month = dateParts[1].padStart(2, '0');
                            const year = dateParts[2];
                            parsedDate = `${year}-${month}-${day}`;
                            if (parts[1]) {
                              const timeParts = parts[1].split(':');
                              parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                            }
                            console.log('Converted (UK format):', parsedDate, parsedTime);
                          }
                          else {
                            const date = new Date(pastedText);
                            if (!isNaN(date.getTime())) {
                              parsedDate = date.toISOString().slice(0, 10);
                              parsedTime = date.toISOString().slice(11, 19);
                              console.log('Parsed via Date object:', parsedDate, parsedTime);
                            }
                          }
                          
                          if (parsedDate) {
                            setTimeout(() => {
                              setCustomTimestamp(parsedDate);
                              const dateTimestamp = new Date(`${parsedDate}T${parsedTime}`).toISOString();
                              handleStatusChange(tn.id, tn.current_status, dateTimestamp);
                            }, 0);
                          } else {
                            console.warn('Could not parse pasted date:', pastedText);
                          }
                        }}
                        onBlur={() => {
                          if (customTimestamp) {
                            const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                            handleStatusChange(tn.id, tn.current_status, dateTimestamp);
                          } else {
                            setEditingTrackingId(null);
                          }
                        }}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && customTimestamp) {
                            const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                            handleStatusChange(tn.id, tn.current_status, dateTimestamp);
                          } else if (e.key === 'Escape') {
                            setEditingTrackingId(null);
                            setCustomTimestamp('');
                          }
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="timestamp-display">
                      <span>{tn.custom_timestamp ? formatDate(tn.custom_timestamp) : '-'}</span>
                      <button 
                        onClick={() => {
                          setEditingTrackingId(tn.id);
                          setCustomTimestamp(tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '');
                        }}
                        className="edit-timestamp-btn"
                        title="Edit timestamp"
                      >
                        ✏️
                      </button>
                    </div>
                  )
                );

                return (
                <tr key={tn.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tn.id)}
                      onChange={(e) => handleSelectOne(tn.id, e.target.checked)}
                      aria-label={`Select tracking number ${tn.tracking_number}`}
                    />
                  </td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[tn.current_status] }}
                    >
                      {STATUS_EMOJIS[tn.current_status]} {STATUS_LABELS[tn.current_status]}
                    </span>
                  </td>
                  <td className="status-details">{tn.status_details || '-'}</td>
                  <td className="pickup-code" style={{ 
                    fontWeight: tn.pickup_code ? 'bold' : 'normal',
                    color: tn.pickup_code ? '#27ae60' : '#999',
                    fontSize: tn.pickup_code ? '1.1rem' : '0.9rem'
                  }}>
                    {tn.pickup_code || '-'}
                  </td>
                  <td className="locker-location" style={{
                    fontSize: '0.85rem',
                    maxWidth: '200px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }} title={tn.locker_id || undefined}>
                    {tn.locker_id || '-'}
                  </td>
                  <td className="tracking-number">
                    <span 
                      style={{ cursor: 'pointer', textDecoration: 'underline', color: '#3498db' }}
                      onClick={() => handleTrackingNumberClick(tn.id)}
                      title="Click to view event timeline"
                    >
                      {tn.tracking_number}
                    </span>
                    {tn.is_manual_status && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#7f8c8d' }} title="Status manually set - will not auto-update">
                        🔒 Manual
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      value={tn.box_id || ''}
                      onChange={(e) => {
                        const boxId = e.target.value ? parseInt(e.target.value) : null;
                        handleBoxChange(tn.id, boxId);
                      }}
                      className="box-select"
                      style={{ padding: '0.3rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', minWidth: '120px', maxWidth: '130px' }}
                      aria-label={`Select box for tracking number ${tn.tracking_number}`}
                    >
                      <option value="">No Box</option>
                      {boxes.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{tn.trackingmore_status || '-'}</td>
                  <td>
                    {renderTimestampEdit()}
                  </td>
                  <td>{formatDateShort(tn.created_at)}</td>
                  <td>{formatDateShort(tn.updated_at)}</td>
                  <td>
                    <div className="action-buttons">
                      <select
                        value={tn.current_status}
                        onChange={(e) => {
                          const newStatus = e.target.value as 'not_scanned' | 'scanned' | 'delivered';
                          if (editingTrackingId === tn.id && customTimestamp) {
                            // Convert date to ISO timestamp (midnight UTC)
                            const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                            handleStatusChange(tn.id, newStatus, dateTimestamp);
                          } else {
                            handleStatusChange(tn.id, newStatus, tn.custom_timestamp || null);
                          }
                        }}
                        className="status-select"
                        aria-label={`Change status for tracking number ${tn.tracking_number}`}
                      >
                        <option value="not_scanned">🔴 Not Collected</option>
                        <option value="scanned">🟡 In Transit</option>
                        <option value="delivered">🟢 Ready for Pickup</option>
                      </select>
                      <button
                        onClick={() => handleRefreshSingle(tn.id)}
                        className="refresh-btn"
                        title={tn.is_manual_status ? "Cannot refresh: Status is manually set" : "Refresh this tracking number"}
                        disabled={tn.is_manual_status}
                        style={{ marginRight: '3px', opacity: tn.is_manual_status ? 0.5 : 1 }}
                      >
                        🔄 Refresh
                      </button>
                      <button
                        onClick={() => handleDelete(tn.id)}
                        className="delete-btn"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="tracking-card">
        {trackingNumbers.length === 0 ? (
          <div className="empty-state">
            No tracking numbers found
          </div>
        ) : (
          trackingNumbers.map((tn) => {
            const renderTimestampEdit = () => (
              editingTrackingId === tn.id ? (
                <div className="timestamp-edit">
                  <input
                    type="date"
                    value={customTimestamp || (tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '')}
                    onChange={(e) => setCustomTimestamp(e.target.value)}
                    aria-label={`Edit custom timestamp for tracking number ${tn.tracking_number}`}
                    onBlur={() => {
                      if (customTimestamp) {
                        const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                        handleStatusChange(tn.id, tn.current_status, dateTimestamp);
                      } else {
                        setEditingTrackingId(null);
                      }
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && customTimestamp) {
                        const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                        handleStatusChange(tn.id, tn.current_status, dateTimestamp);
                      } else if (e.key === 'Escape') {
                        setEditingTrackingId(null);
                        setCustomTimestamp('');
                      }
                    }}
                    autoFocus
                  />
                </div>
              ) : (
                <div className="timestamp-display">
                  <span>{tn.custom_timestamp ? formatDate(tn.custom_timestamp) : '-'}</span>
                  <button 
                    onClick={() => {
                      setEditingTrackingId(tn.id);
                      setCustomTimestamp(tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '');
                    }}
                    className="edit-timestamp-btn"
                    title="Edit timestamp"
                  >
                    ✏️
                  </button>
                </div>
              )
            );

            return (
              <div key={tn.id} className="tracking-card-item">
                <div className="tracking-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tn.id)}
                      onChange={(e) => handleSelectOne(tn.id, e.target.checked)}
                      aria-label={`Select tracking number ${tn.tracking_number}`}
                    />
                    <div className="tracking-card-tracking-number">
                      {tn.tracking_number}
                      {tn.is_manual_status && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#7f8c8d' }} title="Status manually set - will not auto-update">
                          🔒 Manual
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: STATUS_COLORS[tn.current_status] }}
                  >
                    {STATUS_EMOJIS[tn.current_status]} {STATUS_LABELS[tn.current_status]}
                  </span>
                </div>
                <div className="tracking-card-details">
                  {tn.status_details && (
                    <div className="tracking-card-detail-row">
                      <span className="tracking-card-detail-label">Status Details:</span>
                      <span className="tracking-card-detail-value">{tn.status_details}</span>
                    </div>
                  )}
                  <div className="tracking-card-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span className="tracking-card-detail-label">Box:</span>
                    <select
                      value={tn.box_id || ''}
                      onChange={(e) => {
                        const boxId = e.target.value ? parseInt(e.target.value) : null;
                        handleBoxChange(tn.id, boxId);
                      }}
                      aria-label={`Select box for tracking number ${tn.tracking_number}`}
                      className="box-select"
                      style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                    >
                      <option value="">No Box</option>
                      {boxes.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="tracking-card-detail-row">
                    <span className="tracking-card-detail-label">TrackingMore Status:</span>
                    <span className="tracking-card-detail-value">{tn.trackingmore_status || '-'}</span>
                  </div>
                  <div className="tracking-card-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span className="tracking-card-detail-label">Custom Timestamp:</span>
                    <div style={{ width: '100%' }}>{renderTimestampEdit()}</div>
                  </div>
                  <div className="tracking-card-detail-row">
                    <span className="tracking-card-detail-label">Created:</span>
                    <span className="tracking-card-detail-value">{formatDate(tn.created_at)}</span>
                  </div>
                  <div className="tracking-card-detail-row">
                    <span className="tracking-card-detail-label">Updated:</span>
                    <span className="tracking-card-detail-value">{formatDate(tn.updated_at)}</span>
                  </div>
                </div>
                <div className="tracking-card-actions">
                  <div className="action-buttons">
                    <select
                      value={tn.current_status}
                      onChange={(e) => {
                        const newStatus = e.target.value as 'not_scanned' | 'scanned' | 'delivered';
                        if (editingTrackingId === tn.id && customTimestamp) {
                          const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                          handleStatusChange(tn.id, newStatus, dateTimestamp);
                        } else {
                          handleStatusChange(tn.id, newStatus, tn.custom_timestamp || null);
                        }
                      }}
                      aria-label={`Change status for tracking number ${tn.tracking_number}`}
                      className="status-select"
                      style={{ width: '100%', minHeight: '44px' }}
                    >
                      <option value="not_scanned">🔴 Not Collected</option>
                      <option value="scanned">🟡 In Transit</option>
                      <option value="delivered">🟢 Ready for Pickup</option>
                    </select>
                    <button
                      onClick={() => handleRefreshSingle(tn.id)}
                      className="refresh-btn"
                      title={tn.is_manual_status ? "Cannot refresh: Status is manually set" : "Refresh this tracking number"}
                      disabled={tn.is_manual_status}
                      style={{ width: '100%', minHeight: '44px', opacity: tn.is_manual_status ? 0.5 : 1 }}
                    >
                      🔄 Refresh
                    </button>
                    <button
                      onClick={() => handleDelete(tn.id)}
                      className="delete-btn"
                      style={{ width: '100%', minHeight: '44px' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {totalItems > itemsPerPage && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
          </div>
          <div className="pagination-controls">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>
            <span className="pagination-page-info">
              Page {currentPage} of {Math.ceil(totalItems / itemsPerPage)}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalItems / itemsPerPage), prev + 1))}
              disabled={currentPage >= Math.ceil(totalItems / itemsPerPage)}
              className="pagination-btn"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(Math.ceil(totalItems / itemsPerPage))}
              disabled={currentPage >= Math.ceil(totalItems / itemsPerPage)}
              className="pagination-btn"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Event Timeline Modal */}
      {selectedTrackingId && (
        <div className="modal-overlay" onClick={closeEventModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                📦 Event Timeline
                {trackingNumbers.find(tn => tn.id === selectedTrackingId)?.tracking_number && (
                  <span style={{ marginLeft: '1rem', fontSize: '1rem', fontWeight: 'normal', color: '#7f8c8d' }}>
                    {trackingNumbers.find(tn => tn.id === selectedTrackingId)?.tracking_number}
                  </span>
                )}
              </h2>
              <button className="modal-close" onClick={closeEventModal}>×</button>
            </div>
            <div className="modal-body">
              {loadingEvents ? (
                <div className="loading">Loading events...</div>
              ) : trackingEvents.length === 0 ? (
                <div className="empty-state">
                  <p>No tracking events available yet.</p>
                  <p style={{ fontSize: '0.9rem', color: '#7f8c8d', marginTop: '0.5rem' }}>
                    Events will appear here once the package starts moving.
                  </p>
                </div>
              ) : (
                <div className="event-timeline">
                  {trackingEvents.map((event) => (
                    <div key={event.id} className="event-item">
                      <div className="event-marker"></div>
                      <div className="event-content">
                        <div className="event-date">
                          {new Date(event.event_date).toLocaleString()}
                        </div>
                        {event.location && (
                          <div className="event-location">
                            📍 {event.location}
                          </div>
                        )}
                        {event.description && (
                          <div className="event-description">
                            {event.description}
                          </div>
                        )}
                        {event.checkpoint_status && (
                          <div className="event-status">
                            <span className="status-badge-small">
                              {event.checkpoint_status}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


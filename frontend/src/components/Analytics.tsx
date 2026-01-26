import { useState, useEffect } from 'react';
import { api, Box } from '../api/api';
import './Analytics.css';

interface BoxAnalytics {
  id: number;
  name: string;
  created_at: string;
  sent_out_date: string | null;
  parent_box_id: number | null;
  is_king_box: boolean;
  total_items: number;
  not_scanned_count: number;
  scanned_count: number;
  delivered_count: number;
  scanned_in_box_count: number;
  not_scanned_in_box_count: number;
  avg_scan_to_delivery_hours: number | null;
  avg_drop_to_scan_hours: number | null;
  avg_time_from_added_hours: number | null;
}

interface OverviewAnalytics {
  total_items: number;
  not_scanned_count: number;
  scanned_count: number;
  delivered_count: number;
  avg_scan_to_delivery_hours: number | null;
  avg_drop_to_scan_hours: number | null;
}

interface TrackingDetail {
  id: number;
  tracking_number: string;
  current_status: string;
  dropped_at: string;
  scanned_at: string | null;
  delivered_at: string | null;
  drop_to_scan_hours: number | null;
  scan_to_delivery_hours: number | null;
  time_from_added_hours: number | null;
}

type SortOption = 'sent_out_date' | 'name_asc' | 'name_desc' | 'created_at';

export default function Analytics() {
  const [boxAnalytics, setBoxAnalytics] = useState<BoxAnalytics[]>([]);
  const [overview, setOverview] = useState<OverviewAnalytics | null>(null);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [boxDetails, setBoxDetails] = useState<{
    box: Box;
    tracking_numbers: TrackingDetail[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('sent_out_date');
  const [boxFilter, setBoxFilter] = useState<'individual' | 'all' | 'king'>('individual');

  useEffect(() => {
    loadAnalytics();
  }, [boxFilter]);

  useEffect(() => {
    if (selectedBox) {
      loadBoxDetails(selectedBox);
    } else {
      setBoxDetails(null);
    }
  }, [selectedBox]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      // Determine filter parameter: 'all' means show aggregated (no filter), 'king' means king boxes only, 'individual' means all boxes
      const filterParam = boxFilter === 'all' ? undefined : boxFilter;
      const [boxesRes, overviewRes] = await Promise.all([
        api.getBoxAnalytics(filterParam),
        api.getOverviewAnalytics(),
      ]);
      setBoxAnalytics(boxesRes.data);
      setOverview(overviewRes.data);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBoxDetails = async (boxId: number) => {
    try {
      const response = await api.getBoxAnalyticsDetail(boxId);
      setBoxDetails(response.data);
    } catch (error) {
      console.error('Failed to load box details:', error);
    }
  };

  const formatHours = (hours: number | null | string) => {
    if (hours === null || hours === undefined) return 'N/A';
    // Convert to number if it's a string
    const numHours = typeof hours === 'string' ? parseFloat(hours) : hours;
    if (isNaN(numHours)) return 'N/A';
    if (numHours < 24) return `${numHours.toFixed(1)}h`;
    const days = Math.floor(numHours / 24);
    const remainingHours = numHours % 24;
    return `${days}d ${remainingHours.toFixed(1)}h`;
  };

  const sortBoxes = (boxes: BoxAnalytics[], sortOption: SortOption): BoxAnalytics[] => {
    const sorted = [...boxes];
    switch (sortOption) {
      case 'sent_out_date':
        sorted.sort((a, b) => {
          const dateA = a.sent_out_date ? new Date(a.sent_out_date).getTime() : new Date(a.created_at).getTime();
          const dateB = b.sent_out_date ? new Date(b.sent_out_date).getTime() : new Date(b.created_at).getTime();
          return dateA - dateB; // Ascending (oldest first)
        });
        break;
      case 'name_asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'created_at':
        sorted.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateA - dateB; // Ascending (oldest first)
        });
        break;
    }
    return sorted;
  };

  const sortedBoxAnalytics = sortBoxes(boxAnalytics, sortBy);

  if (loading) {
    return <div className="loading">Loading analytics...</div>;
  }

  return (
    <div className="analytics">
      <h2>📈 Analytics</h2>

      {overview && (
        <div className="overview-section">
          <h3>Overview</h3>
          <div className="overview-stats">
            <div className="stat-item">
              <div className="stat-label">Total Items</div>
              <div className="stat-value">{overview.total_items}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Not Collected</div>
              <div className="stat-value">{overview.not_scanned_count}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Scanned</div>
              <div className="stat-value">{overview.scanned_count}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Delivered</div>
              <div className="stat-value">{overview.delivered_count}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Avg Drop → Scan</div>
              <div className="stat-value">
                {formatHours(overview.avg_drop_to_scan_hours)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Avg Scan → Delivery</div>
              <div className="stat-value">
                {formatHours(overview.avg_scan_to_delivery_hours)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="boxes-section">
        <div className="boxes-section-header">
          <h3>Box Analytics</h3>
          <div className="controls-group">
            <label className="view-control">
              <span>Filter:</span>
              <select
                value={boxFilter}
                onChange={(e) => {
                  const newFilter = e.target.value as 'individual' | 'all' | 'king';
                  setBoxFilter(newFilter);
                }}
              >
                <option value="individual">Individual Boxes</option>
                <option value="all">All Boxes</option>
                <option value="king">King Boxes</option>
              </select>
            </label>
            {(boxFilter === 'individual' || boxFilter === 'king') && (
              <label className="sort-control">
                <span>Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                >
                  <option value="sent_out_date">Sent Out Date (Default)</option>
                  <option value="name_asc">Name (Ascending)</option>
                  <option value="name_desc">Name (Descending)</option>
                  <option value="created_at">Added Date/Time</option>
                </select>
              </label>
            )}
          </div>
        </div>
        {(boxFilter === 'individual' || boxFilter === 'king') && (
          <div className="boxes-grid">
            {sortedBoxAnalytics.map((box) => {
            // Check if box should show green: all items are scanned or delivered (nothing pending)
            // Green if: not_scanned_count === 0 (all items have progressed past "not scanned")
            // Yellow if: scanned_count + delivered_count > 0 (box opened by RM)
            // Convert to number in case PostgreSQL returns string
            const notScannedCount = Number(box.not_scanned_count) || 0;
            const scannedCount = Number(box.scanned_count) || 0;
            const deliveredCount = Number(box.delivered_count) || 0;
            const totalItems = Number(box.total_items) || 0;
            const isFullyDelivered = totalItems > 0 && notScannedCount === 0;
            const hasScanned = (scannedCount + deliveredCount) > 0;
            
            return (
              <div
                key={box.id}
                className={`box-card ${selectedBox === box.id ? 'selected' : ''} ${isFullyDelivered ? 'fully-delivered' : hasScanned ? 'has-scanned' : ''}`}
                onClick={() => setSelectedBox(box.id)}
              >
              <h4>
                {box.is_king_box ? '👑 ' : ''}{box.name}
                {hasScanned && (
                  <span className="rm-opened-badge" title="Box opened by InPost">
                    📦 InPost
                  </span>
                )}
              </h4>
              <div className="box-stats">
                <div className="box-stat">
                  <span className="box-stat-label">Total:</span>
                  <span className="box-stat-value">{box.total_items}</span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">🔴 Not Collected:</span>
                  <span className="box-stat-value">{box.not_scanned_count}</span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">🟡 In Transit:</span>
                  <span className="box-stat-value">{box.scanned_count}</span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">🟢 Ready for Pickup:</span>
                  <span className="box-stat-value">{box.delivered_count}</span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">Avg Drop → Scan:</span>
                  <span className="box-stat-value">
                    {formatHours(box.avg_drop_to_scan_hours)}
                  </span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">Avg Scan → Delivery:</span>
                  <span className="box-stat-value">
                    {formatHours(box.avg_scan_to_delivery_hours)}
                  </span>
                </div>
                <div className="box-stat">
                  <span className="box-stat-label">Avg Time From Added:</span>
                  <span className="box-stat-value">
                    {formatHours(box.avg_time_from_added_hours)}
                  </span>
                </div>
              </div>
            </div>
            );
            })}
          </div>
        )}
        
        {/* All Boxes View */}
        {boxFilter === 'all' && overview && (
          <div className="all-boxes-card">
            <h4>All Boxes (Aggregated)</h4>
            <div className="box-stats">
              <div className="box-stat">
                <span className="box-stat-label">Total:</span>
                <span className="box-stat-value">{overview.total_items}</span>
              </div>
              <div className="box-stat">
                <span className="box-stat-label">🔴 Not Collected:</span>
                <span className="box-stat-value">{overview.not_scanned_count}</span>
              </div>
              <div className="box-stat">
                <span className="box-stat-label">🟡 Scanned:</span>
                <span className="box-stat-value">{overview.scanned_count}</span>
              </div>
              <div className="box-stat">
                <span className="box-stat-label">🟢 Delivered:</span>
                <span className="box-stat-value">{overview.delivered_count}</span>
              </div>
              <div className="box-stat">
                <span className="box-stat-label">Avg Drop → Scan:</span>
                <span className="box-stat-value">
                  {formatHours(overview.avg_drop_to_scan_hours)}
                </span>
              </div>
              <div className="box-stat">
                <span className="box-stat-label">Avg Scan → Delivery:</span>
                <span className="box-stat-value">
                  {formatHours(overview.avg_scan_to_delivery_hours)}
                </span>
              </div>
            </div>
          </div>
        )}
        
      </div>

      {/* Modal for Box Details */}
      {boxDetails && (
        <div className="modal-overlay" onClick={() => setSelectedBox(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Details: {boxDetails.box.name}</h3>
              <button className="modal-close" onClick={() => setSelectedBox(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="details-table-container">
                <table className="details-table">
                  <thead>
                    <tr>
                      <th>Tracking Number</th>
                      <th>Status</th>
                      <th>Time From Added</th>
                      <th>Dropped</th>
                      <th>Scanned</th>
                      <th>Delivered</th>
                      <th>Drop → Scan</th>
                      <th>Scan → Delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxDetails.tracking_numbers.map((tn) => (
                      <tr key={tn.id}>
                        <td className="tracking-number">{tn.tracking_number}</td>
                        <td>
                          <span className={`status-badge status-${tn.current_status}`}>
                            {tn.current_status}
                          </span>
                        </td>
                        <td>{formatHours(tn.time_from_added_hours)}</td>
                        <td>{new Date(tn.dropped_at).toLocaleString()}</td>
                        <td>
                          {tn.scanned_at
                            ? new Date(tn.scanned_at).toLocaleString()
                            : '-'}
                        </td>
                        <td>
                          {tn.delivered_at
                            ? new Date(tn.delivered_at).toLocaleString()
                            : '-'}
                        </td>
                        <td>{formatHours(tn.drop_to_scan_hours)}</td>
                        <td>{formatHours(tn.scan_to_delivery_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


import { useState, useEffect } from 'react';
import { api, DateBasedStats, TrackingNumber } from '../api/api';
import './LastScanned.css';

export default function LastScanned() {
  const [stats, setStats] = useState<DateBasedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'yesterday' | 'twoDaysAgo' | 'threeDaysAgo' | null>(null);
  const [notScannedItems, setNotScannedItems] = useState<TrackingNumber[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getFirstScans();
      setStats(response.data);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
      setError(err.response?.data?.error || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const getDateString = (period: 'today' | 'yesterday' | 'twoDaysAgo' | 'threeDaysAgo'): string => {
    const now = new Date();
    const date = new Date(now);
    
    if (period === 'yesterday') {
      date.setDate(date.getDate() - 1);
    } else if (period === 'twoDaysAgo') {
      date.setDate(date.getDate() - 2);
    } else if (period === 'threeDaysAgo') {
      date.setDate(date.getDate() - 3);
    }
    
    return date.toISOString().split('T')[0];
  };

  const handleCardClick = async (period: 'today' | 'yesterday' | 'twoDaysAgo' | 'threeDaysAgo') => {
    const periodStats = stats?.[period];
    if (!periodStats || periodStats.not_scanned === 0) {
      return; // Don't open modal if no not_scanned items
    }

    setSelectedPeriod(period);
    setModalOpen(true);
    setLoadingItems(true);
    setItemsError(null);
    setNotScannedItems([]);

    try {
      const date = getDateString(period);
      const response = await api.getNotScannedByDate(date);
      setNotScannedItems(response.data);
    } catch (err: any) {
      console.error('Failed to load not scanned items:', err);
      setItemsError(err.response?.data?.error || 'Failed to load items');
    } finally {
      setLoadingItems(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedPeriod(null);
    setNotScannedItems([]);
    setItemsError(null);
  };

  if (loading) {
    return (
      <div className="last-scanned">
        <h2>Total ID Added by Date</h2>
        <div className="loading">Loading stats...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="last-scanned">
        <h2>Total ID Added by Date</h2>
        <div className="error">Error: {error}</div>
        <button onClick={loadStats} className="retry-btn">
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="last-scanned">
        <h2>Total ID Added by Date</h2>
        <div className="no-logs">No data available</div>
      </div>
    );
  }

  const isCelebrating = (dayStats: { not_scanned: number; scanned: number; delivered: number; total: number }) => {
    return dayStats.not_scanned === 0 && dayStats.total > 0;
  };

  return (
    <div className="last-scanned">
      <div className="last-scanned-header">
        <h2>Total ID Added by Date</h2>
        <button onClick={loadStats} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>

      <div className="stats-cards-container">
        <div 
          className={`stat-card-date ${isCelebrating(stats.today) ? 'celebrating' : ''} ${stats.today.not_scanned > 0 ? 'clickable' : ''}`}
          onClick={() => handleCardClick('today')}
        >
          <h3>Total ID added today</h3>
          <div className="stat-card-content">
            <div className="status-count-group">
              <span className="status-emoji">🔴</span>
              <span className="status-count status-red">{stats.today.not_scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟠</span>
              <span className="status-count status-orange">{stats.today.scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟢</span>
              <span className="status-count status-green">{stats.today.delivered}</span>
            </div>
            <div className="total-count">Total: {stats.today.total}</div>
            {isCelebrating(stats.today) && (
              <div className="celebration-badge">🎉 All items processed!</div>
            )}
          </div>
        </div>

        <div 
          className={`stat-card-date ${isCelebrating(stats.yesterday) ? 'celebrating' : ''} ${stats.yesterday.not_scanned > 0 ? 'clickable' : ''}`}
          onClick={() => handleCardClick('yesterday')}
        >
          <h3>Total ID yesterday</h3>
          <div className="stat-card-content">
            <div className="status-count-group">
              <span className="status-emoji">🔴</span>
              <span className="status-count status-red">{stats.yesterday.not_scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟠</span>
              <span className="status-count status-orange">{stats.yesterday.scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟢</span>
              <span className="status-count status-green">{stats.yesterday.delivered}</span>
            </div>
            <div className="total-count">Total: {stats.yesterday.total}</div>
            {isCelebrating(stats.yesterday) && (
              <div className="celebration-badge">🎉 All items processed!</div>
            )}
          </div>
        </div>

        <div 
          className={`stat-card-date ${isCelebrating(stats.twoDaysAgo) ? 'celebrating' : ''} ${stats.twoDaysAgo.not_scanned > 0 ? 'clickable' : ''}`}
          onClick={() => handleCardClick('twoDaysAgo')}
        >
          <h3>Total ID 2d ago</h3>
          <div className="stat-card-content">
            <div className="status-count-group">
              <span className="status-emoji">🔴</span>
              <span className="status-count status-red">{stats.twoDaysAgo.not_scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟠</span>
              <span className="status-count status-orange">{stats.twoDaysAgo.scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟢</span>
              <span className="status-count status-green">{stats.twoDaysAgo.delivered}</span>
            </div>
            <div className="total-count">Total: {stats.twoDaysAgo.total}</div>
            {isCelebrating(stats.twoDaysAgo) && (
              <div className="celebration-badge">🎉 All items processed!</div>
            )}
          </div>
        </div>

        <div 
          className={`stat-card-date ${isCelebrating(stats.threeDaysAgo) ? 'celebrating' : ''} ${stats.threeDaysAgo.not_scanned > 0 ? 'clickable' : ''}`}
          onClick={() => handleCardClick('threeDaysAgo')}
        >
          <h3>Total ID 3d ago</h3>
          <div className="stat-card-content">
            <div className="status-count-group">
              <span className="status-emoji">🔴</span>
              <span className="status-count status-red">{stats.threeDaysAgo.not_scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟠</span>
              <span className="status-count status-orange">{stats.threeDaysAgo.scanned}</span>
            </div>
            <div className="status-count-group">
              <span className="status-emoji">🟢</span>
              <span className="status-count status-green">{stats.threeDaysAgo.delivered}</span>
            </div>
            <div className="total-count">Total: {stats.threeDaysAgo.total}</div>
            {isCelebrating(stats.threeDaysAgo) && (
              <div className="celebration-badge">🎉 All items processed!</div>
            )}
          </div>
        </div>
      </div>

      {/* Modal for Not Scanned Items */}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                🔴 Not Scanned Items - {
                  selectedPeriod === 'today' ? 'Today' :
                  selectedPeriod === 'yesterday' ? 'Yesterday' :
                  selectedPeriod === 'twoDaysAgo' ? '2 Days Ago' :
                  '3 Days Ago'
                }
                {notScannedItems.length > 0 && (
                  <span className="modal-item-count">
                    ({notScannedItems.length} {notScannedItems.length === 1 ? 'item' : 'items'})
                  </span>
                )}
              </h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {loadingItems ? (
                <div className="loading">Loading items...</div>
              ) : itemsError ? (
                <div className="error">{itemsError}</div>
              ) : notScannedItems.length === 0 ? (
                <div className="empty-state">
                  <p>No not scanned items found for this date.</p>
                </div>
              ) : (
                <div className="not-scanned-list">
                  {notScannedItems.map((item) => (
                    <div key={item.id} className="not-scanned-item">
                      <div className="item-header">
                        <div className="item-tracking-number">{item.tracking_number}</div>
                        {item.box_name && (
                          <div className="item-box-name">📦 {item.box_name}</div>
                        )}
                      </div>
                      <div className="item-details">
                        {item.status_details && (
                          <div className="item-detail-row">
                            <span className="detail-label">Status Details:</span>
                            <span className="detail-value">{item.status_details}</span>
                          </div>
                        )}
                        {item.trackingmore_status && (
                          <div className="item-detail-row">
                            <span className="detail-label">TrackingMore Status:</span>
                            <span className="detail-value">{item.trackingmore_status}</span>
                          </div>
                        )}
                        <div className="item-detail-row">
                          <span className="detail-label">Created:</span>
                          <span className="detail-value">
                            {new Date(item.created_at).toLocaleString()}
                          </span>
                        </div>
                        {item.custom_timestamp && (
                          <div className="item-detail-row">
                            <span className="detail-label">Custom Timestamp:</span>
                            <span className="detail-value">
                              {new Date(item.custom_timestamp).toLocaleString()}
                            </span>
                          </div>
                        )}
                        {item.is_manual_status && (
                          <div className="item-detail-row">
                            <span className="detail-label">Manual Status:</span>
                            <span className="detail-value">Yes</span>
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

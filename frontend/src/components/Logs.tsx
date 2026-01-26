import { useState, useEffect, useRef } from 'react';
import { api, StatusChangeLog, Box } from '../api/api';
import './Logs.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export default function Logs() {
  const [logs, setLogs] = useState<StatusChangeLog[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [changeTypeFilter, setChangeTypeFilter] = useState<'all' | 'status_change' | 'details_update'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_scanned' | 'scanned' | 'delivered'>('all');
  const [boxFilter, setBoxFilter] = useState<number | null>(null);
  const [trackingNumberSearch, setTrackingNumberSearch] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadBoxes();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [limit, changeTypeFilter, statusFilter, boxFilter, trackingNumberSearch]);

  // Set up SSE connection for real-time updates
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.warn('No token found, skipping SSE connection');
      setIsConnected(false);
      return;
    }
    
    // Test if endpoint is accessible first
    const testConnection = async () => {
      try {
        const testUrl = `${API_URL}/tracking/logs/stream/test`;
        const response = await fetch(testUrl, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) {
          console.error('SSE test endpoint failed:', response.status, response.statusText);
          setIsConnected(false);
          return false;
        }
        const data = await response.json();
        console.log('SSE endpoint test passed:', data);
        return true;
      } catch (error) {
        console.error('SSE endpoint test failed:', error);
        setIsConnected(false);
        return false;
      }
    };
    
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    // Test connection first, then establish SSE
    testConnection().then((canConnect) => {
      if (!canConnect) {
        console.error('Cannot establish SSE connection - endpoint test failed');
        return;
      }
      
      // Create new SSE connection
      const streamUrl = `${API_URL}/tracking/logs/stream?token=${encodeURIComponent(token)}`;
      console.log('Attempting SSE connection to:', streamUrl.replace(/token=[^&]+/, 'token=***'));
      console.log('API_URL:', API_URL);
      console.log('Full URL (sanitized):', streamUrl.replace(/token=[^&]+/, 'token=***'));
      
      const eventSource = new EventSource(streamUrl);
      console.log('EventSource created, initial readyState:', eventSource.readyState, '(0=CONNECTING)');
      
      eventSourceRef.current = eventSource;
      
      // Monitor readyState changes to detect when connection opens
      const checkReadyState = () => {
        const states = ['CONNECTING', 'OPEN', 'CLOSED'];
        const currentState = eventSource.readyState;
        console.log('EventSource readyState:', states[currentState], `(${currentState})`);
        if (currentState === EventSource.OPEN) {
          console.log('✓ EventSource is OPEN - setting connected to true');
          setIsConnected(true);
        } else if (currentState === EventSource.CLOSED) {
          setIsConnected(false);
        }
      };
      
      // Check initial state
      checkReadyState();
      
      // Monitor state changes (check every 500ms for first 5 seconds, then stop)
      let checkCount = 0;
      const maxChecks = 10; // 5 seconds
      const stateCheckInterval = setInterval(() => {
        checkReadyState();
        checkCount++;
        if (checkCount >= maxChecks) {
          clearInterval(stateCheckInterval);
          console.log('Stopped monitoring readyState (connection should be established by now)');
        }
      }, 500);
      
      eventSource.onopen = () => {
        console.log('✓ SSE connection opened successfully (onopen event)');
        console.log('EventSource readyState:', eventSource.readyState, '(should be 1 = OPEN)');
        console.log('EventSource URL:', eventSource.url.replace(/token=[^&]+/, 'token=***'));
        setIsConnected(true);
        if (stateCheckInterval) {
          clearInterval(stateCheckInterval);
        }
      };
      
      // Also check readyState immediately after a short delay
      // Sometimes onopen doesn't fire but readyState becomes OPEN
      const timeoutChecks = [500, 1000, 2000, 3000];
      timeoutChecks.forEach((delay) => {
        setTimeout(() => {
          const currentState = eventSource.readyState;
          console.log(`[${delay}ms] EventSource readyState check:`, currentState, currentState === EventSource.OPEN ? 'OPEN' : currentState === EventSource.CONNECTING ? 'CONNECTING' : 'CLOSED');
          if (currentState === EventSource.OPEN) {
            console.log(`✓ EventSource readyState is OPEN (detected at ${delay}ms)`);
            setIsConnected(true);
          } else if (currentState === EventSource.CLOSED && delay >= 2000) {
            console.error(`✗ EventSource is CLOSED after ${delay}ms - connection failed`);
            setIsConnected(false);
          }
        }, delay);
      });
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE message received:', data.type);
          
          if (data.type === 'logs' && data.logs && data.logs.length > 0) {
            console.log(`Received ${data.logs.length} new log entries`);
            // Add all new logs (filters will be applied when rendering)
            setLogs(prevLogs => {
              const newLogIds = new Set(data.logs.map((l: StatusChangeLog) => l.id));
              const filteredPrev = prevLogs.filter(l => !newLogIds.has(l.id));
              // Add new logs at the beginning, then apply limit
              return [...data.logs, ...filteredPrev].slice(0, limit * 2); // Keep more in memory for filtering
            });
          } else if (data.type === 'heartbeat') {
            // Connection is alive, just log for debugging
            console.debug('SSE heartbeat received');
            setIsConnected(true); // Ensure we're marked as connected on heartbeat
          } else if (data.type === 'connected') {
            console.log('✓ SSE connected message received:', data.message);
            console.log('Setting isConnected to true');
            setIsConnected(true);
          } else if (data.type === 'error') {
            console.error('SSE error:', data.message);
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        console.error('EventSource readyState:', eventSource.readyState);
        console.error('EventSource URL:', eventSource.url.replace(/token=[^&]+/, 'token=***'));
        console.error('EventSource withCredentials:', eventSource.withCredentials);
        
        // readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        if (eventSource.readyState === EventSource.CLOSED) {
          console.error('SSE connection closed/failed. Check:');
          console.error('  1. Open Network tab and look for the /logs/stream request');
          console.error('  2. Check the response status code (should be 200)');
          console.error('  3. Check for CORS errors in console');
          console.error('  4. Verify token is valid');
          console.error('  5. API_URL:', API_URL);
          console.error('  6. Full URL:', eventSource.url.replace(/token=[^&]+/, 'token=***'));
          
          setIsConnected(false);
          clearInterval(stateCheckInterval);
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          console.log('SSE reconnecting...');
        } else if (eventSource.readyState === EventSource.OPEN) {
          // Sometimes onerror fires even when connection is open
          console.log('SSE error event but connection is OPEN - might be temporary');
          setIsConnected(true);
        }
        // EventSource will automatically try to reconnect
      };
    });
    
    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        console.log('Cleaning up SSE connection');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, []); // Only set up once, filters are applied in onmessage

  const loadBoxes = async () => {
    try {
      const response = await api.getBoxes();
      setBoxes(response.data);
    } catch (err) {
      console.error('Failed to load boxes:', err);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await api.getStatusChangeLogs(
        limit,
        changeTypeFilter !== 'all' ? changeTypeFilter : undefined,
        statusFilter !== 'all' ? statusFilter : undefined,
        boxFilter || undefined,
        trackingNumberSearch || undefined
      );
      setLogs(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  // Apply filters to logs when rendering
  const filteredLogs = logs.filter(log => {
    if (changeTypeFilter !== 'all' && log.change_type !== changeTypeFilter) {
      return false;
    }
    if (statusFilter !== 'all' && log.new_status !== statusFilter) {
      return false;
    }
    if (trackingNumberSearch && !log.tracking_number.toLowerCase().includes(trackingNumberSearch.toLowerCase())) {
      return false;
    }
    // Note: boxFilter would need box_id in StatusChangeLog to work properly
    // For now, we'll skip box filtering in real-time updates
    return true;
  }).slice(0, limit);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'not_scanned': return '🔴';
      case 'scanned': return '🟡';
      case 'delivered': return '🟢';
      default: return '⚪';
    }
  };

  const getChangeTypeIcon = (changeType: string) => {
    return changeType === 'status_change' ? '📈' : '📝';
  };

  if (loading) {
    return (
      <div className="logs">
        <h2>Status Change Logs</h2>
        <div className="loading">Loading logs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="logs">
        <h2>Status Change Logs</h2>
        <div className="error">Error: {error}</div>
        <button onClick={loadLogs} className="retry-btn">Retry</button>
      </div>
    );
  }

  return (
    <div className="logs">
      <div className="logs-header">
        <h2>📋 Status Change Logs</h2>
        <div className="logs-controls">
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`} title={isConnected ? 'Real-time updates active' : 'Real-time updates disconnected'}>
            {isConnected ? '🟢 Live' : '🔴 Offline'}
          </span>
          <label>
            Show last:
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
            >
              <option value={50}>50 entries</option>
              <option value={100}>100 entries</option>
              <option value={200}>200 entries</option>
            </select>
          </label>
          <button onClick={loadLogs} className="refresh-btn">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="logs-filters">
        <div className="filter-group">
          <label>
            <span>Change Type:</span>
            <select
              value={changeTypeFilter}
              onChange={(e) => setChangeTypeFilter(e.target.value as 'all' | 'status_change' | 'details_update')}
            >
              <option value="all">All Types</option>
              <option value="status_change">📈 Status Change</option>
              <option value="details_update">📝 Details Update</option>
            </select>
          </label>
        </div>

        <div className="filter-group">
          <label>
            <span>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'not_scanned' | 'scanned' | 'delivered')}
            >
              <option value="all">All Statuses</option>
              <option value="not_scanned">🔴 Not Scanned</option>
              <option value="scanned">🟡 Scanned</option>
              <option value="delivered">🟢 Delivered</option>
            </select>
          </label>
        </div>

        <div className="filter-group">
          <label>
            <span>Box:</span>
            <select
              value={boxFilter || ''}
              onChange={(e) => setBoxFilter(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">All Boxes</option>
              {boxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter-group">
          <label>
            <span>🔍 Search Tracking:</span>
            <input
              type="text"
              placeholder="Enter tracking number..."
              value={trackingNumberSearch}
              onChange={(e) => setTrackingNumberSearch(e.target.value)}
            />
          </label>
        </div>

        {(changeTypeFilter !== 'all' || statusFilter !== 'all' || boxFilter !== null || trackingNumberSearch) && (
          <button
            onClick={() => {
              setChangeTypeFilter('all');
              setStatusFilter('all');
              setBoxFilter(null);
              setTrackingNumberSearch('');
            }}
            className="clear-filters-btn"
          >
            Clear Filters
          </button>
        )}
      </div>

      {filteredLogs.length === 0 ? (
        <div className="no-logs">
          <p>No status changes recorded yet.</p>
          <p>Status changes will appear here when tracking numbers are updated automatically or manually.</p>
        </div>
      ) : (
        <div className="logs-table-container">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Tracking Number</th>
                <th>Change Type</th>
                <th>Status Change</th>
                <th>Details</th>
                <th>Box</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className="timestamp">
                    {formatDate(log.changed_at)}
                  </td>
                  <td className="tracking-number">
                    <code>{log.tracking_number}</code>
                  </td>
                  <td className="change-type">
                    {getChangeTypeIcon(log.change_type)}
                    {log.change_type === 'status_change' ? 'Status Change' : 'Details Update'}
                  </td>
                  <td className="status-change">
                    {log.change_type === 'status_change' ? (
                      <span>
                        {log.old_status && (
                          <span className="old-status">
                            {getStatusIcon(log.old_status)} {log.old_status}
                          </span>
                        )}
                        <span className="arrow"> → </span>
                        <span className="new-status">
                          {getStatusIcon(log.new_status)} {log.new_status}
                        </span>
                      </span>
                    ) : (
                      <span className="details-only">Details only</span>
                    )}
                  </td>
                  <td className="status-details">
                    {log.status_details || <em>(none)</em>}
                  </td>
                  <td className="box-name">
                    {log.box_name || <em>(none)</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="logs-info">
        <p>
          <strong>Note:</strong> These logs show recent status changes for tracking numbers.
          Status changes occur through automatic updates (every 4 hours) or manual refreshes.
          {isConnected && ' Logs update in real-time as changes occur.'}
        </p>
      </div>
    </div>
  );
}

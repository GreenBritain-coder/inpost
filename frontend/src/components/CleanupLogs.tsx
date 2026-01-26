import { useState, useEffect } from 'react';
import { api, CleanupLog } from '../api/api';
import './CleanupLogs.css';

export default function CleanupLogs() {
  const [cleanupLogs, setCleanupLogs] = useState<CleanupLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    loadCleanupLogs();
  }, []);

  const loadCleanupLogs = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getCleanupLogs(50);
      console.log('Cleanup logs API response:', response);
      console.log('Cleanup logs data:', response.data);
      console.log('Number of logs:', response.data?.length || 0);
      setCleanupLogs(response.data);
    } catch (err: any) {
      console.error('Failed to load cleanup logs:', err);
      setError(err.response?.data?.error || 'Failed to load cleanup logs');
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm('This will delete all tracking data older than 5 weeks. This action cannot be undone. Continue?')) {
      return;
    }

    try {
      setCleaning(true);
      setError(null);
      await api.triggerCleanup();
      alert('Cleanup started! Check the logs below to see what was deleted.');
      // Reload logs after a short delay
      setTimeout(() => {
        loadCleanupLogs();
        setCleaning(false);
      }, 2000);
    } catch (err: any) {
      setCleaning(false);
      alert(err.response?.data?.error || 'Failed to start cleanup');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="cleanup-logs">
        <h2>Cleanup Logs</h2>
        <div className="loading">Loading cleanup logs...</div>
      </div>
    );
  }

  return (
    <div className="cleanup-logs">
      <div className="cleanup-logs-header">
        <h2>🗑️ Cleanup Logs</h2>
        <div className="cleanup-logs-actions">
          <button 
            onClick={handleCleanup} 
            disabled={cleaning}
            className="cleanup-btn"
          >
            {cleaning ? 'Cleaning...' : 'Delete older than 5 weeks'}
          </button>
          <button onClick={loadCleanupLogs} className="refresh-btn">
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      <div className="cleanup-info">
        <p>
          <strong>Note:</strong> The cleanup process automatically deletes tracking data older than 5 weeks.
          This includes tracking numbers, status history, and tracking events. Cleanup runs automatically daily at 2 AM,
          or you can trigger it manually using the button above.
        </p>
      </div>

      {cleanupLogs.length === 0 ? (
        <div className="no-logs">
          <p>No cleanup logs recorded yet.</p>
          <p>Cleanup logs will appear here after the first cleanup runs (automatically at 2 AM or manually).</p>
        </div>
      ) : (
        <div className="logs-table-container">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Cutoff Date</th>
                <th>Deleted Events</th>
                <th>Deleted History</th>
                <th>Deleted Tracking</th>
                <th>Total Deleted</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {cleanupLogs.map((log) => (
                <tr key={log.id} className={log.status === 'error' ? 'error-row' : ''}>
                  <td className="timestamp">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="timestamp">
                    {formatDate(log.cutoff_date)}
                  </td>
                  <td className="number-cell">
                    {log.deleted_tracking_events}
                  </td>
                  <td className="number-cell">
                    {log.deleted_status_history}
                  </td>
                  <td className="number-cell">
                    {log.deleted_tracking_numbers}
                  </td>
                  <td className="number-cell total">
                    {log.deleted_tracking_events + log.deleted_status_history + log.deleted_tracking_numbers}
                  </td>
                  <td className="status-cell">
                    <span className={`status-badge status-${log.status}`}>
                      {log.status === 'success' ? '✅ Success' : '❌ Error'}
                    </span>
                  </td>
                  <td className="error-cell">
                    {log.error_message || <em>-</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

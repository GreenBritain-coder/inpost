import { useState, useRef } from 'react';
import { api } from '../api/api';
import './UploadCSV.css';

interface UploadResult {
  tracking_number: string;
  status: 'created' | 'duplicate' | 'error';
  message?: string;
}

interface UserLink {
  user_id: number;
  link: string;
}

interface UploadResponse {
  message: string;
  summary: {
    total: number;
    created: number;
    duplicates: number;
    errors: number;
  };
  user_links?: UserLink[];
  results: UploadResult[];
}

export default function UploadCSV() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const copyLink = (user_id: number, link: string) => {
    navigator.clipboard.writeText(link);
    setCopiedId(user_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.uploadCSV(formData);
      setResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload CSV');
      console.error('CSV upload error:', err);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const downloadTemplate = () => {
    // Template with all optional fields - users can remove columns they don't need
    const template = 'tracking_number,user_id,email_used\nJJD0002233573349153,7744334263,\nMD000000867865453,8899445511,';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tracking_upload_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="upload-csv-container">
      <div className="upload-csv-header">
        <h2>📤 Upload Tracking Numbers (CSV)</h2>
        <button onClick={downloadTemplate} className="download-template-btn">
          📥 Download Template
        </button>
      </div>

      <div className="upload-instructions">
        <h3>CSV Format</h3>
        <p><strong>Required column:</strong> <code>tracking_number</code> - InPost tracking number</p>
        <p><strong>Optional columns:</strong></p>
        <ul>
          <li><strong>user_id</strong> - <strong>Telegram user ID</strong> (Telegram's numeric ID, e.g., 7744334263). If provided, the system will find or create a user with this Telegram ID and link the tracking to them. If omitted, tracking will be created without a user assignment.</li>
          <li><strong>email_used</strong> - Email address used for this tracking</li>
        </ul>
        <p className="example-note">
          <strong>Note:</strong> Only <code>tracking_number</code> is required. All other fields are optional. 
          If you provide <code>user_id</code>, it's treated as <strong>Telegram user ID</strong> (not database user ID). 
          The system automatically creates users if they don't exist. After upload, you'll get <code>/start</code> links using database user IDs to share with users.
        </p>
        <p className="example-note">
          <strong>Examples:</strong><br/>
          Minimal: <code>tracking_number</code> — <code>JJD0002233573349153</code><br/>
          With user: <code>user_id,tracking_number</code> — <code>7744334263,JJD0002233573349153</code>
        </p>
      </div>

      <div className="upload-area">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={uploading}
          className="file-input"
          id="csv-upload"
        />
        <label htmlFor="csv-upload" className={`file-label ${uploading ? 'disabled' : ''}`}>
          {uploading ? '⏳ Uploading...' : '📁 Choose CSV File'}
        </label>
      </div>

      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="upload-results">
          <div className="results-summary">
            <h3>✅ {result.message}</h3>
            <div className="summary-stats">
              <div className="stat-item success">
                <span className="stat-label">Created:</span>
                <span className="stat-value">{result.summary.created}</span>
              </div>
              <div className="stat-item duplicate">
                <span className="stat-label">Duplicates:</span>
                <span className="stat-value">{result.summary.duplicates}</span>
              </div>
              <div className="stat-item error">
                <span className="stat-label">Errors:</span>
                <span className="stat-value">{result.summary.errors}</span>
              </div>
            </div>
          </div>

          {result.user_links && result.user_links.length > 0 && (
            <div className="results-details user-links-section">
              <h4>🔗 /start user_id links (share with each user)</h4>
              <p className="user-links-note">Send each user their link; when they open the bot and tap Start they are linked and see their trackings.</p>
              <ul className="user-links-list">
                {result.user_links.map(({ user_id, link }) => (
                  <li key={user_id} className="user-link-item">
                    <span className="user-id">User {user_id}</span>
                    <a href={link} target="_blank" rel="noopener noreferrer" className="user-link">{link}</a>
                    <button
                      type="button"
                      className="copy-link-btn"
                      onClick={() => copyLink(user_id, link)}
                      title="Copy link"
                    >
                      {copiedId === user_id ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(result.summary.duplicates > 0 || result.summary.errors > 0) && (
            <div className="results-details">
              <h4>Details</h4>
              <div className="results-table-container">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Tracking Number</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results
                      .filter(r => r.status !== 'created')
                      .map((r, index) => (
                        <tr key={index} className={`status-${r.status}`}>
                          <td>{r.tracking_number}</td>
                          <td>
                            <span className={`status-badge ${r.status}`}>
                              {r.status === 'duplicate' ? '⚠️ Duplicate' : '❌ Error'}
                            </span>
                          </td>
                          <td>{r.message || '-'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

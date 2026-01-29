import { useState, useRef } from 'react';
import { api } from '../api/api';
import './UploadCSV.css';

interface UploadResult {
  tracking_number: string;
  status: 'created' | 'duplicate' | 'error';
  message?: string;
}

interface UploadResponse {
  message: string;
  summary: {
    total: number;
    created: number;
    duplicates: number;
    errors: number;
  };
  results: UploadResult[];
}

export default function UploadCSV() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const template = 'user_id,tracking_number,telegram_chat_id,email_used\n123,JJD0002233573349153,7744334263,user@example.com\n456,MD000000867865453,,';
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
        <p>Your CSV file should have the following columns (header row required):</p>
        <ul>
          <li><strong>tracking_number</strong> (required) - InPost tracking number</li>
          <li><strong>user_id</strong> (optional) - User ID from your system</li>
          <li><strong>telegram_chat_id</strong> (optional) - Telegram chat ID for notifications</li>
          <li><strong>email_used</strong> (optional) - Email address used for this tracking</li>
        </ul>
        <p className="example-note">Example: <code>user_id,tracking_number,telegram_chat_id,email_used</code></p>
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

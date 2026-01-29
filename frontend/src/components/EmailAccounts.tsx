import { useEffect, useState } from 'react';
import { api, EmailAccount } from '../api/api';
import './EmailAccounts.css';

export default function EmailAccounts() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form fields
  const [formEmail, setFormEmail] = useState('');
  const [formPhoneNumber, setFormPhoneNumber] = useState('');
  const [formAppPassword, setFormAppPassword] = useState('');
  const [formHost, setFormHost] = useState('imap.gmail.com');
  const [formPort, setFormPort] = useState('993');
  const [formIsActive, setFormIsActive] = useState(true);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.getEmailAccounts();
      setAccounts(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load email accounts');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormEmail('');
    setFormPhoneNumber('');
    setFormAppPassword('');
    setFormHost('imap.gmail.com');
    setFormPort('993');
    setFormIsActive(true);
  };

  const startEdit = (acc: EmailAccount) => {
    setEditingId(acc.id);
    setFormEmail(acc.email);
    setFormPhoneNumber(acc.phone_number || '');
    setFormAppPassword(''); // Don't pre-fill password
    setFormHost(acc.host);
    setFormPort(acc.port.toString());
    setFormIsActive(acc.is_active);
    setShowAddForm(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmail || !formAppPassword) {
      setError('Email and App Password are required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await api.createEmailAccount({
        email: formEmail,
        app_password: formAppPassword,
        phone_number: formPhoneNumber || null,
        host: formHost || 'imap.gmail.com',
        port: parseInt(formPort) || 993,
      });
      await loadAccounts();
      setShowAddForm(false);
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create email account');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateAccount = async () => {
    if (editingId == null) return;

    try {
      setSaving(true);
      setError('');
      await api.updateEmailAccount(editingId, {
        email: formEmail,
        phone_number: formPhoneNumber || null,
        host: formHost,
        port: parseInt(formPort) || 993,
        is_active: formIsActive,
        ...(formAppPassword && { app_password: formAppPassword }),
      });
      await loadAccounts();
      cancelEdit();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update email account');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async (acc: EmailAccount) => {
    if (!window.confirm(`Delete email account ${acc.email}? This cannot be undone.`)) return;

    try {
      setDeletingId(acc.id);
      setError('');
      await api.deleteEmailAccount(acc.id);
      await loadAccounts();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete email account');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActive = async (acc: EmailAccount) => {
    try {
      setError('');
      await api.updateEmailAccount(acc.id, { is_active: !acc.is_active });
      await loadAccounts();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle account status');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="email-accounts-container">
        <p>Loading email accounts...</p>
      </div>
    );
  }

  return (
    <div className="email-accounts-container">
      <div className="email-accounts-header">
        <h2>Email Accounts</h2>
        <button
          type="button"
          onClick={() => {
            setShowAddForm(!showAddForm);
            setEditingId(null);
            resetForm();
          }}
          className="email-accounts-btn email-accounts-btn-add"
        >
          {showAddForm ? 'Cancel' : '+ Add Account'}
        </button>
      </div>

      <p className="email-accounts-intro">
        Configure Gmail accounts to scan for InPost pickup codes and location information.
        Use <strong>Gmail App Passwords</strong> (not your regular password) for authentication.
        <a
          href="https://support.google.com/accounts/answer/185833"
          target="_blank"
          rel="noopener noreferrer"
          className="email-accounts-help-link"
        >
          How to create an App Password
        </a>
      </p>

      {error && <div className="email-accounts-error">{error}</div>}

      {showAddForm && (
        <form onSubmit={handleAddAccount} className="email-accounts-form">
          <h3>Add New Email Account</h3>
          <div className="email-accounts-form-row">
            <label>
              Email Address *
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="your-email@gmail.com"
                required
                className="email-accounts-input"
              />
            </label>
            <label>
              Phone Number (optional)
              <input
                type="text"
                value={formPhoneNumber}
                onChange={(e) => setFormPhoneNumber(e.target.value)}
                placeholder="e.g. +44 7700 900000"
                className="email-accounts-input"
              />
            </label>
          </div>
          <div className="email-accounts-form-row">
            <label>
              Gmail App Password *
              <input
                type="password"
                value={formAppPassword}
                onChange={(e) => setFormAppPassword(e.target.value)}
                placeholder="16-character app password"
                required
                className="email-accounts-input"
              />
            </label>
          </div>
          <div className="email-accounts-form-row">
            <label>
              IMAP Host
              <input
                type="text"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
                placeholder="imap.gmail.com"
                className="email-accounts-input"
              />
            </label>
            <label>
              IMAP Port
              <input
                type="number"
                value={formPort}
                onChange={(e) => setFormPort(e.target.value)}
                placeholder="993"
                className="email-accounts-input"
              />
            </label>
          </div>
          <div className="email-accounts-form-actions">
            <button type="submit" disabled={saving} className="email-accounts-btn email-accounts-btn-save">
              {saving ? 'Adding...' : 'Add Account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                resetForm();
              }}
              className="email-accounts-btn email-accounts-btn-cancel"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="email-accounts-table-wrap">
        <table className="email-accounts-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Phone Number</th>
              <th>Status</th>
              <th>Last Checked</th>
              <th>Last Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="email-accounts-empty">
                  No email accounts configured. Click "Add Account" to get started.
                </td>
              </tr>
            ) : (
              accounts.map((acc) => (
                <tr key={acc.id} className={!acc.is_active ? 'email-accounts-row-inactive' : ''}>
                  {editingId === acc.id ? (
                    <>
                      <td>
                        <input
                          type="email"
                          value={formEmail}
                          onChange={(e) => setFormEmail(e.target.value)}
                          className="email-accounts-input"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={formPhoneNumber}
                          onChange={(e) => setFormPhoneNumber(e.target.value)}
                          className="email-accounts-input"
                        />
                      </td>
                      <td>
                        <label className="email-accounts-toggle">
                          <input
                            type="checkbox"
                            checked={formIsActive}
                            onChange={(e) => setFormIsActive(e.target.checked)}
                          />
                          <span>{formIsActive ? 'Active' : 'Inactive'}</span>
                        </label>
                      </td>
                      <td colSpan={2}>
                        <input
                          type="password"
                          value={formAppPassword}
                          onChange={(e) => setFormAppPassword(e.target.value)}
                          placeholder="New password (leave blank to keep)"
                          className="email-accounts-input"
                        />
                      </td>
                      <td>
                        <span className="email-accounts-actions">
                          <button
                            type="button"
                            onClick={handleUpdateAccount}
                            disabled={saving}
                            className="email-accounts-btn email-accounts-btn-save"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="email-accounts-btn email-accounts-btn-cancel"
                          >
                            Cancel
                          </button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{acc.email}</td>
                      <td>{acc.phone_number || '—'}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => toggleActive(acc)}
                          className={`email-accounts-status-badge ${acc.is_active ? 'active' : 'inactive'}`}
                          title={`Click to ${acc.is_active ? 'deactivate' : 'activate'}`}
                        >
                          {acc.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td>{formatDate(acc.last_checked_at)}</td>
                      <td className="email-accounts-error-cell" title={acc.last_error || undefined}>
                        {acc.last_error ? (
                          <span className="email-accounts-error-text">{acc.last_error}</span>
                        ) : (
                          <span className="email-accounts-success-text">OK</span>
                        )}
                      </td>
                      <td>
                        <span className="email-accounts-actions">
                          <button
                            type="button"
                            onClick={() => startEdit(acc)}
                            className="email-accounts-btn email-accounts-btn-edit"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAccount(acc)}
                            disabled={deletingId === acc.id}
                            className="email-accounts-btn email-accounts-btn-delete"
                          >
                            {deletingId === acc.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

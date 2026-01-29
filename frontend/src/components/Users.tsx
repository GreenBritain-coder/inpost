import { useEffect, useState } from 'react';
import { api, UserSummary } from '../api/api';
import './Users.css';

export default function Users() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [telegramUserId, setTelegramUserId] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.getUsers();
      setUsers(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (u: UserSummary) => {
    setEditingId(u.id);
    setTelegramUserId(u.telegram_user_id ?? '');
    setTelegramUsername(u.telegram_username ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setTelegramUserId('');
    setTelegramUsername('');
  };

  const saveTelegram = async () => {
    if (editingId == null) return;
    try {
      setSaving(true);
      setError('');
      await api.updateUserTelegram(editingId, {
        telegram_user_id: telegramUserId.trim() || null,
        telegram_username: telegramUsername.trim() || null,
      });
      await loadUsers();
      cancelEdit();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="users-container">
        <p>Loading users…</p>
      </div>
    );
  }

  return (
    <div className="users-container">
      <div className="users-header">
        <h2>Link Telegram (Users)</h2>
      </div>
      <p className="users-intro">
        When uploading tracking numbers via CSV, use <strong>Telegram user ID</strong> (Telegram's numeric ID, e.g., 7744334263) in the <code>user_id</code> column. 
        The system will automatically find or create users with that Telegram ID, allowing automatic matching when users interact with the bot.
      </p>

      {error && (
        <div className="users-error">{error}</div>
      )}

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Telegram user ID<br/><span className="users-th-subtitle">(Telegram's numeric ID)</span></th>
              <th>Telegram @username</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {editingId === u.id ? (
                    <input
                      type="text"
                      value={telegramUserId}
                      onChange={(e) => setTelegramUserId(e.target.value)}
                      placeholder="e.g. 7744334263"
                      className="users-input"
                    />
                  ) : (
                    <span>{u.telegram_user_id ?? '—'}</span>
                  )}
                </td>
                <td>
                  {editingId === u.id ? (
                    <input
                      type="text"
                      value={telegramUsername}
                      onChange={(e) => setTelegramUsername(e.target.value)}
                      placeholder="e.g. @username"
                      className="users-input"
                    />
                  ) : (
                    <span>{u.telegram_username ?? '—'}</span>
                  )}
                </td>
                <td>
                  {editingId === u.id ? (
                    <span className="users-actions">
                      <button type="button" onClick={saveTelegram} disabled={saving} className="users-btn users-btn-save">
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEdit} disabled={saving} className="users-btn users-btn-cancel">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => startEdit(u)} className="users-btn users-btn-edit">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

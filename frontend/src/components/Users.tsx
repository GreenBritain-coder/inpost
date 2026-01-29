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

  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'GB_Track_Bot';
  const startLink = (uid: number) => `https://t.me/${botUsername}?start=${uid}`;

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
        Link users to Telegram so they can open the bot and tap <strong>/tracking</strong> to see their trackings.
        Set their <strong>Telegram user ID</strong> (the numeric ID from Telegram). You can also share their personal link so they link via Start.
      </p>

      {error && (
        <div className="users-error">{error}</div>
      )}

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Telegram user ID</th>
              <th>Telegram @username</th>
              <th>Personal link</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.email}</td>
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
                  <a href={startLink(u.id)} target="_blank" rel="noopener noreferrer" className="users-link">
                    Start link
                  </a>
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

import { useEffect, useState } from 'react';
import { api, UserSummary, TrackingNumber } from '../api/api';
import './Users.css';

export default function Users() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [telegramUserId, setTelegramUserId] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [trackingsModalUser, setTrackingsModalUser] = useState<UserSummary | null>(null);
  const [trackingsModalList, setTrackingsModalList] = useState<TrackingNumber[]>([]);
  const [trackingsModalLoading, setTrackingsModalLoading] = useState(false);
  const [fetchingUsernameId, setFetchingUsernameId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const openTrackingsModal = async (u: UserSummary) => {
    setTrackingsModalUser(u);
    setTrackingsModalList([]);
    setTrackingsModalLoading(true);
    try {
      const res = await api.getTrackingNumbers(undefined, 1, 500, undefined, undefined, undefined, undefined, undefined, u.id);
      setTrackingsModalList(res.data.data);
    } catch {
      setTrackingsModalList([]);
    } finally {
      setTrackingsModalLoading(false);
    }
  };

  const closeTrackingsModal = () => {
    setTrackingsModalUser(null);
    setTrackingsModalList([]);
  };

  const fetchTelegramUsername = async (u: UserSummary) => {
    if (!u.telegram_user_id?.trim()) return;
    try {
      setFetchingUsernameId(u.id);
      setError('');
      const res = await api.fetchTelegramUsername(u.id);
      if (res.data.username != null) {
        await loadUsers();
      } else {
        setError('Username not found (user may not have started the bot).');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch username from Telegram');
    } finally {
      setFetchingUsernameId(null);
    }
  };

  const handleDeleteUser = async (u: UserSummary) => {
    if (!window.confirm(`Delete user ${u.id}? Their trackings will be unassigned (not deleted).`)) return;
    try {
      setDeletingId(u.id);
      setError('');
      await api.deleteUser(u.id);
      if (trackingsModalUser?.id === u.id) closeTrackingsModal();
      await loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete user');
    } finally {
      setDeletingId(null);
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
                <td>
                  {editingId !== u.id && (
                    <>
                      {u.telegram_user_id?.trim() && (
                        <button
                          type="button"
                          onClick={() => fetchTelegramUsername(u)}
                          disabled={fetchingUsernameId === u.id}
                          className="users-btn users-btn-fetch-username"
                          title="Get @username from Telegram using their user ID (user must have started the bot)"
                        >
                          {fetchingUsernameId === u.id ? 'Fetching…' : 'Fetch username'}
                        </button>
                      )}
                      <button type="button" onClick={() => openTrackingsModal(u)} className="users-btn users-btn-trackings" title="View linked tracking numbers">
                        View trackings
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        disabled={deletingId === u.id}
                        className="users-btn users-btn-delete"
                        title="Delete this user (trackings become unassigned)"
                      >
                        {deletingId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trackingsModalUser && (() => {
        // Use current user from list so modal shows updated ID/username after Fetch username or Edit
        const currentUser = users.find((x) => x.id === trackingsModalUser.id) ?? trackingsModalUser;
        return (
        <div className="users-modal-overlay" onClick={closeTrackingsModal} role="presentation">
          <div className="users-modal" onClick={(e) => e.stopPropagation()}>
            <div className="users-modal-header">
              <h3>Trackings linked to user</h3>
              <p className="users-modal-subtitle">
                User ID {currentUser.id}
                {currentUser.telegram_user_id && ` · Telegram ${currentUser.telegram_user_id}`}
                {currentUser.telegram_username && ` · @${currentUser.telegram_username.replace(/^@/, '')}`}
              </p>
              <button type="button" onClick={closeTrackingsModal} className="users-modal-close" aria-label="Close">
                ×
              </button>
            </div>
            <div className="users-modal-body">
              {trackingsModalLoading ? (
                <p>Loading trackings…</p>
              ) : trackingsModalList.length === 0 ? (
                <p className="users-modal-empty">No tracking numbers linked to this user.</p>
              ) : (
                <ul className="users-modal-trackings-list">
                  {trackingsModalList.map((t) => (
                    <li key={t.id} className="users-modal-tracking-item">
                      <span className="users-modal-tracking-number">{t.tracking_number}</span>
                      <span className={`users-modal-tracking-status status-${t.current_status}`}>{t.current_status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

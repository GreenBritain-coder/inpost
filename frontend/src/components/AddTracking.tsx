import { useState, useEffect } from 'react';
import { api, Box } from '../api/api';
import './AddTracking.css';

export default function AddTracking() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [kingBoxes, setKingBoxes] = useState<Box[]>([]);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [newBoxName, setNewBoxName] = useState('');
  const [newBoxIsKingBox, setNewBoxIsKingBox] = useState(false);
  const [newBoxParentId, setNewBoxParentId] = useState<number | null>(null);
  const [showNewBox, setShowNewBox] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [emailUsed, setEmailUsed] = useState('');
  const [bulkTrackingNumbers, setBulkTrackingNumbers] = useState('');
  const [bulkCustomTimestamp, setBulkCustomTimestamp] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showBoxManagement, setShowBoxManagement] = useState(false);
  const [deletingBoxId, setDeletingBoxId] = useState<number | null>(null);
  const [editingBox, setEditingBox] = useState<{ id: number; name: string; parent_box_id: number | null; is_king_box: boolean } | null>(null);

  useEffect(() => {
    loadBoxes();
    loadKingBoxes();
  }, []);

  const loadBoxes = async () => {
    try {
      const response = await api.getBoxes();
      setBoxes(response.data);
    } catch (error) {
      console.error('Failed to load boxes:', error);
    }
  };

  const loadKingBoxes = async () => {
    try {
      const response = await api.getKingBoxes();
      setKingBoxes(response.data);
    } catch (error) {
      console.error('Failed to load king boxes:', error);
    }
  };

  const handleCreateBox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoxName.trim()) return;

    try {
      const response = await api.createBox(
        newBoxName.trim(),
        newBoxIsKingBox ? null : newBoxParentId,
        newBoxIsKingBox
      );
      // Reload boxes to ensure we have the latest data with parent relationships
      await loadBoxes();
      if (newBoxIsKingBox) {
        await loadKingBoxes();
      }
      setSelectedBox(response.data.id);
      setNewBoxName('');
      setNewBoxIsKingBox(false);
      setNewBoxParentId(null);
      setShowNewBox(false);
      setMessage({ type: 'success', text: `${newBoxIsKingBox ? 'King box' : 'Box'} created successfully` });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 
                          (error.response?.data?.details ? JSON.stringify(error.response.data.details) : null) ||
                          'Failed to create box';
      console.error('Error creating box:', error.response?.data || error);
      setMessage({
        type: 'error',
        text: errorMessage,
      });
    }
  };

  const handleDeleteBox = async (boxId: number, boxName: string) => {
    if (!window.confirm(`Are you sure you want to delete the box "${boxName}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingBoxId(boxId);
    try {
      await api.deleteBox(boxId);
      setBoxes(boxes.filter(box => box.id !== boxId));
      // Clear selection if the deleted box was selected
      if (selectedBox === boxId) {
        setSelectedBox(null);
      }
      setMessage({ type: 'success', text: `Box "${boxName}" deleted successfully` });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to delete box',
      });
    } finally {
      setDeletingBoxId(null);
    }
  };

  const handleUpdateBox = async (boxId: number, newName: string, parentBoxId?: number | null, isKingBox?: boolean) => {
    if (!newName.trim()) {
      setEditingBox(null);
      return;
    }

    try {
      const response = await api.updateBox(boxId, newName.trim(), parentBoxId, isKingBox);
      setBoxes(boxes.map(box => box.id === boxId ? response.data : box));
      if (response.data.is_king_box) {
        setKingBoxes(kingBoxes.map(box => box.id === boxId ? response.data : box));
      }
      setEditingBox(null);
      setMessage({ type: 'success', text: 'Box updated successfully' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to update box',
      });
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingNumber.trim()) return;
    if (!telegramUserId.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      await api.createTrackingNumber(
        trackingNumber.trim(),
        selectedBox || undefined,
        telegramUserId.trim() || undefined,
        emailUsed.trim() || undefined
      );
      setTrackingNumber('');
      setTelegramUserId('');
      setEmailUsed('');
      setMessage({ type: 'success', text: 'Tracking number added successfully' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to add tracking number',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkTrackingNumbers.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      // Parse tracking numbers (split by newline, comma, or space)
      const numbers = bulkTrackingNumbers
        .split(/[\n,]+/)
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      if (numbers.length === 0) {
        setMessage({ type: 'error', text: 'No valid tracking numbers found' });
        setLoading(false);
        return;
      }

      // Convert custom timestamp to ISO8601 format if provided
      const customTimestamp = bulkCustomTimestamp 
        ? new Date(bulkCustomTimestamp + 'T00:00:00Z').toISOString() 
        : null;

      const response = await api.bulkCreateTrackingNumbers(
        numbers,
        selectedBox || undefined,
        customTimestamp
      );
      setBulkTrackingNumbers('');
      setBulkCustomTimestamp('');
      setMessage({
        type: 'success',
        text: `Successfully added ${response.data.tracking_numbers.length} tracking numbers`,
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to add tracking numbers',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-tracking">
      <h2>➕ Add Tracking Numbers</h2>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="box-selector">
        <label>
          Select Box (optional):
          <select
            value={selectedBox || ''}
            onChange={(e) =>
              setSelectedBox(e.target.value ? parseInt(e.target.value) : null)
            }
          >
            <option value="">No Box</option>
            {boxes.filter(box => !box.is_king_box).map((box) => {
              const parentKingBox = box.parent_box_id ? kingBoxes.find(kb => kb.id === box.parent_box_id) : null;
              return (
                <option key={box.id} value={box.id}>
                  {box.name}{parentKingBox ? ` (👑 ${parentKingBox.name})` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <button
          onClick={() => setShowNewBox(!showNewBox)}
          className="new-box-btn"
        >
          {showNewBox ? 'Cancel' : '+ New Box'}
        </button>
      </div>

      {showNewBox && (
        <form onSubmit={handleCreateBox} className="new-box-form">
          <input
            type="text"
            placeholder="Box name"
            value={newBoxName}
            onChange={(e) => setNewBoxName(e.target.value)}
            required
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={newBoxIsKingBox}
              onChange={(e) => {
                setNewBoxIsKingBox(e.target.checked);
                if (e.target.checked) {
                  setNewBoxParentId(null);
                }
              }}
            />
            <span>👑 Create as King Box</span>
          </label>
          {!newBoxIsKingBox && (
            <label>
              Assign to King Box:
              <select
                value={newBoxParentId || ''}
                onChange={(e) => setNewBoxParentId(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">No King Box (Standalone)</option>
                {kingBoxes.map((kingBox) => (
                  <option key={kingBox.id} value={kingBox.id}>
                    👑 {kingBox.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit">Create {newBoxIsKingBox ? 'King ' : ''}Box</button>
        </form>
      )}

      <div className="box-management">
        <button
          onClick={() => setShowBoxManagement(!showBoxManagement)}
          className="manage-boxes-btn"
        >
          {showBoxManagement ? 'Hide' : 'Manage'} Boxes ({boxes.length})
        </button>

        {showBoxManagement && (
          <div className="box-list">
            {boxes.length === 0 ? (
              <p className="no-boxes">No boxes created yet.</p>
            ) : (
              boxes.map((box) => {
                const parentKingBox = box.parent_box_id ? kingBoxes.find(kb => kb.id === box.parent_box_id) : null;
                return (
                  <div key={box.id} className="box-item">
                    {editingBox?.id === box.id ? (
                      <>
                        <input
                          type="text"
                          value={editingBox.name}
                          onChange={(e) => setEditingBox({ ...editingBox, name: e.target.value })}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdateBox(editingBox.id, editingBox.name, editingBox.parent_box_id, editingBox.is_king_box);
                            } else if (e.key === 'Escape') {
                              setEditingBox(null);
                            }
                          }}
                          autoFocus
                          className="box-edit-input"
                          aria-label="Edit box name"
                        />
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={editingBox.is_king_box}
                            onChange={(e) => {
                              setEditingBox({ ...editingBox, is_king_box: e.target.checked, parent_box_id: e.target.checked ? null : editingBox.parent_box_id });
                            }}
                          />
                          <span>👑 King Box</span>
                        </label>
                        {!editingBox.is_king_box && (
                          <select
                            value={editingBox.parent_box_id || ''}
                            onChange={(e) => setEditingBox({ ...editingBox, parent_box_id: e.target.value ? parseInt(e.target.value) : null })}
                            aria-label="Select parent king box"
                          >
                            <option value="">No King Box</option>
                            {kingBoxes.map((kb) => (
                              <option key={kb.id} value={kb.id}>👑 {kb.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => handleUpdateBox(editingBox.id, editingBox.name, editingBox.parent_box_id, editingBox.is_king_box)}
                          className="save-box-btn"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingBox(null)}
                          className="cancel-box-btn"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="box-name-container">
                          <span className="box-name">
                            {box.is_king_box ? '👑 ' : ''}{box.name}
                          </span>
                          {parentKingBox && (
                            <span className="box-parent-badge">
                              👑 Assigned to {parentKingBox.name}
                            </span>
                          )}
                        </div>
                        <div className="box-item-actions">
                          <button
                            onClick={() => setEditingBox({ id: box.id, name: box.name, parent_box_id: box.parent_box_id, is_king_box: box.is_king_box })}
                            className="edit-box-btn"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteBox(box.id, box.name)}
                            disabled={deletingBoxId === box.id}
                            className="delete-box-btn"
                          >
                            {deletingBoxId === box.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="mode-selector">
        <button
          className={mode === 'single' ? 'active' : ''}
          onClick={() => setMode('single')}
        >
          Single Entry
        </button>
        <button
          className={mode === 'bulk' ? 'active' : ''}
          onClick={() => setMode('bulk')}
        >
          Bulk Upload
        </button>
      </div>

      {mode === 'single' ? (
        <form onSubmit={handleSingleSubmit} className="tracking-form">
          <div className="form-group">
            <label htmlFor="tracking-number">Tracking Number</label>
            <input
              type="text"
              id="tracking-number"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Enter tracking number"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="telegram-user-id">Telegram User ID <span className="required">*</span></label>
            <input
              type="text"
              id="telegram-user-id"
              value={telegramUserId}
              onChange={(e) => setTelegramUserId(e.target.value)}
              placeholder="e.g. 7744334263"
              required
            />
            <small>Telegram's numeric user ID (required for linking trackings to users)</small>
          </div>
          <div className="form-group">
            <label htmlFor="email-used">Email Used (optional)</label>
            <input
              type="text"
              id="email-used"
              value={emailUsed}
              onChange={(e) => setEmailUsed(e.target.value)}
              placeholder="e.g. user@example.com"
            />
            <small>Email address used for this tracking number (optional)</small>
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adding...' : 'Add Tracking Number'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleBulkSubmit} className="tracking-form">
          <div className="form-group">
            <label htmlFor="bulk-tracking-numbers">
              Tracking Numbers (one per line or comma-separated)
            </label>
            <textarea
              id="bulk-tracking-numbers"
              value={bulkTrackingNumbers}
              onChange={(e) => setBulkTrackingNumbers(e.target.value)}
              placeholder="Enter tracking numbers, one per line or separated by commas"
              rows={10}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="bulk-custom-timestamp">
              Custom Timestamp (optional)
            </label>
            <input
              type="date"
              id="bulk-custom-timestamp"
              value={bulkCustomTimestamp}
              onChange={(e) => setBulkCustomTimestamp(e.target.value)}
            />
            <small>If provided, this timestamp will be applied to all tracking numbers in this bulk import.</small>
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adding...' : 'Add Tracking Numbers'}
          </button>
        </form>
      )}
    </div>
  );
}

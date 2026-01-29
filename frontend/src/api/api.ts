import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Box {
  id: number;
  name: string;
  parent_box_id: number | null;
  is_king_box: boolean;
  created_at: string;
  updated_at?: string;
}

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
  status_details?: string | null;
  custom_timestamp?: string | null;
  is_manual_status: boolean;
  trackingmore_status: string | null;
  pickup_code?: string | null;
  locker_id?: string | null;
  created_at: string;
  updated_at: string;
  box_name?: string | null;
}

export interface StatusChangeLog {
  id: number;
  tracking_number: string;
  old_status: string | null;
  new_status: string;
  status_details: string | null;
  box_name: string | null;
  changed_at: string;
  change_type: 'status_change' | 'details_update';
}

export interface ScannedChangeLog {
  id: number;
  tracking_number: string;
  box_name: string | null;
  box_id: number | null;
  box_color_state: 'red' | 'yellow' | 'green';
  changed_at: string;
  status_details: string | null;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
}

export interface TrackingEvent {
  id: number;
  tracking_number_id: number;
  event_date: string;
  location: string | null;
  status: string | null;
  description: string | null;
  checkpoint_status: string | null;
  created_at: string;
}

export const api = {
  // Boxes
  getBoxes: (kingBoxId?: number | null) => {
    const params: any = {};
    if (kingBoxId !== undefined && kingBoxId !== null) {
      params.kingBoxId = kingBoxId;
    }
    return axios.get<Box[]>(`${API_URL}/tracking/boxes`, { params });
  },
  getKingBoxes: () => axios.get<Box[]>(`${API_URL}/tracking/boxes/king`),
  createBox: (
    name: string,
    parentBoxId?: number | null,
    isKingBox: boolean = false
  ) => axios.post<Box>(`${API_URL}/tracking/boxes`, {
    name,
    parent_box_id: parentBoxId || null,
    is_king_box: isKingBox,
  }),
  updateBox: (
    id: number,
    name: string,
    parentBoxId?: number | null,
    isKingBox?: boolean
  ) => {
    const body: any = { name };
    if (parentBoxId !== undefined) body.parent_box_id = parentBoxId;
    if (isKingBox !== undefined) body.is_king_box = isKingBox;
    return axios.patch<Box>(`${API_URL}/tracking/boxes/${id}`, body);
  },
  deleteBox: (id: number) => axios.delete(`${API_URL}/tracking/boxes/${id}`),

  // Tracking Numbers
  getTrackingNumbers: (boxId?: number, page?: number, limit?: number, status?: 'not_scanned' | 'scanned' | 'delivered', customTimestamp?: string, search?: string, unassignedOnly?: boolean, kingBoxId?: number | null) => {
    const params: any = {};
    if (boxId) params.boxId = boxId;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    if (status) params.status = status;
    if (customTimestamp) params.customTimestamp = customTimestamp;
    if (search) params.search = search;
    if (unassignedOnly) params.unassignedOnly = 'true';
    if (kingBoxId !== undefined && kingBoxId !== null) params.kingBoxId = kingBoxId;
    return axios.get<{ 
      data: TrackingNumber[]; 
      total: number; 
      page: number; 
      limit: number;
      stats: {
        not_scanned: number;
        scanned: number;
        delivered: number;
        total: number;
      };
    }>(`${API_URL}/tracking/numbers`, { params });
  },
  createTrackingNumber: (
    trackingNumber: string, 
    boxId?: number,
    userId?: number,
    telegramChatId?: number,
    emailUsed?: string
  ) =>
    axios.post<TrackingNumber>(`${API_URL}/tracking/numbers`, {
      tracking_number: trackingNumber,
      box_id: boxId,
      user_id: userId,
      telegram_chat_id: telegramChatId,
      email_used: emailUsed,
    }),
  bulkCreateTrackingNumbers: (trackingNumbers: string[], boxId?: number, customTimestamp?: string | null) =>
    axios.post(`${API_URL}/tracking/numbers/bulk`, {
      tracking_numbers: trackingNumbers,
      box_id: boxId,
      custom_timestamp: customTimestamp,
    }),
  deleteTrackingNumber: (id: number) =>
    axios.delete(`${API_URL}/tracking/numbers/${id}`),
  bulkDeleteTrackingNumbers: (ids: number[]) =>
    axios.post(`${API_URL}/tracking/numbers/bulk/delete`, { ids }),
  deleteAllTrackingNumbers: () =>
    axios.delete(`${API_URL}/tracking/numbers`),
  updateTrackingStatus: (
    id: number, 
    status: 'not_scanned' | 'scanned' | 'delivered',
    customTimestamp?: string | null
  ) =>
    axios.patch<TrackingNumber>(`${API_URL}/tracking/numbers/${id}/status`, { 
      status,
      custom_timestamp: customTimestamp
    }),
  updateTrackingNumberBox: (id: number, boxId?: number | null) =>
    axios.patch<TrackingNumber>(`${API_URL}/tracking/numbers/${id}/box`, {
      box_id: boxId,
    }),
  getTrackingNumberById: (id: number) =>
    axios.get<TrackingNumber>(`${API_URL}/tracking/numbers/${id}`),
  getTrackingEvents: (id: number) =>
    axios.get<TrackingEvent[]>(`${API_URL}/tracking/numbers/${id}/events`),

  // Analytics
  getBoxAnalytics: (filter?: 'individual' | 'all' | 'king') => {
    const params: any = {};
    if (filter) params.filter = filter;
    return axios.get(`${API_URL}/analytics/boxes`, { params });
  },
  getBoxAnalyticsDetail: (boxId: number) =>
    axios.get(`${API_URL}/analytics/boxes/${boxId}`),
  getOverviewAnalytics: () => axios.get(`${API_URL}/analytics/overview`),

  // Refresh tracking statuses
  refreshTrackingStatuses: () => axios.post(`${API_URL}/tracking/refresh`),
  refreshTrackingNumber: (id: number) =>
    axios.post<{ message: string; tracking: TrackingNumber }>(`${API_URL}/tracking/numbers/${id}/refresh`),
  
  // Check emails for pickup codes and locations
  checkEmails: () => axios.post(`${API_URL}/tracking/check-emails`),

  // Logs
  getStatusChangeLogs: (
    limit?: number,
    changeType?: 'status_change' | 'details_update',
    status?: 'not_scanned' | 'scanned' | 'delivered',
    boxId?: number,
    trackingNumber?: string
  ) => {
    const params: any = {};
    if (limit) params.limit = limit;
    if (changeType) params.changeType = changeType;
    if (status) params.status = status;
    if (boxId) params.boxId = boxId;
    if (trackingNumber) params.trackingNumber = trackingNumber;
    return axios.get<StatusChangeLog[]>(`${API_URL}/tracking/logs/status-changes`, { params });
  },
  getScannedChanges: (limit?: number) => {
    const params: any = {};
    if (limit) params.limit = limit;
    return axios.get<ScannedChangeLog[]>(`${API_URL}/tracking/logs/scanned-changes`, { params });
  },
  getFirstScans: (limit?: number) => {
    const params: any = {};
    if (limit) params.limit = limit;
    return axios.get<DateBasedStats>(`${API_URL}/tracking/logs/first-scans`, { params });
  },
  getNotScannedByDate: (date: string) =>
    axios.get<TrackingNumber[]>(`${API_URL}/tracking/numbers/not-scanned-by-date`, { 
      params: { date } 
    }),
  triggerCleanup: () => axios.post(`${API_URL}/tracking/cleanup`),
  getCleanupLogs: (limit?: number) => {
    const params: any = {};
    if (limit) params.limit = limit;
    return axios.get<CleanupLog[]>(`${API_URL}/tracking/cleanup-logs`, { params });
  },
  uploadCSV: (formData: FormData) =>
    axios.post(`${API_URL}/tracking/numbers/upload-csv`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
};

export interface CleanupLog {
  id: number;
  cutoff_date: string;
  deleted_tracking_events: number;
  deleted_status_history: number;
  deleted_tracking_numbers: number;
  status: 'success' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface FirstScanLog {
  id: number;
  tracking_number: string;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
  first_scanned_at: string;
  created_at: string;
  box_name: string | null;
  box_id: number | null;
}

export interface DateBasedStats {
  today: { not_scanned: number; scanned: number; delivered: number; total: number };
  yesterday: { not_scanned: number; scanned: number; delivered: number; total: number };
  twoDaysAgo: { not_scanned: number; scanned: number; delivered: number; total: number };
  threeDaysAgo: { not_scanned: number; scanned: number; delivered: number; total: number };
}

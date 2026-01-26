# Changelog

## Updates - King Box Display Simplification & Last 50 Log Filter

### Date: 2024

### Changes Made:

#### 1. King Box Display Simplification
**File Modified:** `frontend/src/components/Analytics.tsx`

**Change:** Removed redundant "In Box" statistics section from King Box display.

**Details:**
- Removed the conditional block that displayed "In Box - Scanned", "In Box - Not Scanned", and "In Box - Total" statistics for king boxes
- King boxes now display the same core statistics as regular boxes:
  - Total items
  - Not Scanned count
  - Scanned count
  - Delivered count
  - Average Drop → Scan time
  - Average Scan → Delivery time
- Focus is now on the key state transition from Red (not_scanned) to Orange (scanned)

**Lines Removed:** 238-255 (the conditional `{box.is_king_box && ...}` block)

#### 2. Last 50 Log - First-Time Scan Filter
**File Modified:** `backend/src/models/statusHistory.ts`

**Change:** Updated `getRecentScannedChanges` function to only show first-time scans.

**Details:**
- Modified the WHERE clause in the SQL query to explicitly filter for transitions from `'not_scanned'` (or NULL) to `'scanned'`
- Added additional filter to ensure tracking number's current_status is 'scanned' or 'delivered' (meaning it was actually scanned and hasn't reverted)
- Ensures only orders that have been scanned by InPost for the first time are displayed
- Excludes any subsequent "scanned" status updates
- Excludes entries where status_history shows 'scanned' but the tracking number's current status is still 'not_scanned'

**Query Changes:**
- **First change:** `AND (swl.old_status IS NULL OR swl.old_status != 'scanned')` → `AND (swl.old_status IS NULL OR swl.old_status = 'not_scanned')`
- **Second change (fix):** Added `AND t.current_status IN ('scanned', 'delivered')` to ensure only actually scanned items are shown

**Lines Modified:** 139, 140

#### 3. Last 50 Log Display Simplification
**File Modified:** `frontend/src/components/LastScanned.tsx`, `backend/src/models/statusHistory.ts`, `frontend/src/api/api.ts`

**Change:** Simplified the display to focus on key information: scan time, tracking number, status, and box name.

**Details:**
- Updated query to only show items with current_status = 'scanned' (excludes delivered items, since we're showing first-time scans)
- Added status column with icons (🔴 Not Scanned, 🟡 Scanned, 🟢 Delivered)
- Updated column header from "Time" to "Scan Time" for clarity
- Updated page title from "Last 50 Scanned State Changes" to "Last 50 First-Time Scans"
- Updated description to clearly state it shows items scanned by InPost for the first time, with scan time and box information

**Columns Now Displayed:**
- Scan Time (when Royal Mail first scanned the item)
- Tracking Number
- Status (with icon: 🟡 Scanned)
- Box Name (which box the item came from)
- Details (status details from InPost)

**Query Change:**
- Filter by `current_status = 'scanned'` to only show items that were first scanned AND are still currently scanned (not delivered)
- Use `item_received` field (ItemReceived from TrackingMore API) to identify first scans
- Match first scans with item_received timestamp (within 24 hours) to ensure we're showing the true first scan
- Added `item_received` column to tracking_numbers table to store ItemReceived timestamp
- Extract ItemReceived from TrackingMore API response and store it when updating tracking status
- Based on TrackingMore API: ItemReceived = "Time of a first tracking info appeared" - this is the definitive first scan timestamp

### Summary:
- Simplified King Box analytics display by removing redundant information
- Improved Last 50 Log accuracy by filtering to only first-time scans
- Simplified Last 50 Log display to focus on scan time, tracking number, and box name
- Both changes focus on the important state transition from Red (not_scanned) to Orange (scanned)

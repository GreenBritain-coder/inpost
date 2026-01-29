import axios from 'axios';
import { TrackingStatus } from '../models/tracking';

const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY || '';
const TRACKINGMORE_API_BASE = 'https://api.trackingmore.com/v4';

/**
 * Pick TrackingMore courier code by tracking number format.
 * UK numbers (JJD..., MD...) use InPost UK; others use InPost Poland (Paczkomaty).
 */
function getCourierCodeForTrackingNumber(trackingNumber: string): string {
  const clean = trackingNumber.replace(/\s+/g, '').toUpperCase();
  // InPost UK formats: JJD (to recipient), MD (sender receipt) - 15–18 chars
  if (clean.startsWith('JJD') || clean.startsWith('MD')) {
    return 'inpost-uk';
  }
  return 'inpost-paczkomaty';
}

/**
 * Parse TrackingMore API response
 */
function parseTrackingMoreResponse(data: any, trackingNumber: string): {
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
  trackingmoreStatus?: string;
  itemReceived?: Date | string | null;
  events?: Array<{
    event_date: Date | string;
    location?: string | null;
    status?: string | null;
    description?: string | null;
    checkpoint_status?: string | null;
  }>;
} {
  try {
    // Log the full response structure for debugging
    console.log(`[${trackingNumber}] Parsing TrackingMore response:`, JSON.stringify(data, null, 2).substring(0, 1000));
    
    // TrackingMore API response structure - try multiple possible formats
    // Handle case where data.data is an empty array vs an object
    let trackingData;
    if (data?.data) {
      if (Array.isArray(data.data)) {
        // If data is an array, use first item if available, otherwise it's empty
        if (data.data.length > 0) {
          trackingData = data.data[0];
        } else {
          // Empty array - tracking exists but no data yet
          trackingData = null;
        }
      } else {
        // data is an object
        trackingData = data.data;
      }
    } else {
      trackingData = data?.item || data;
    }
    
    // If no tracking data found, return not_scanned
    if (!trackingData || (Array.isArray(trackingData) && trackingData.length === 0)) {
      console.log(`[${trackingNumber}] TrackingMore: Empty data array - tracking exists but not yet processed`);
      return {
        status: 'not_scanned',
        details: 'Tracking exists in TrackingMore but not yet processed',
        statusHeader: 'Pending',
        trackingmoreStatus: undefined,
      };
    }
    
    // Try different status field names - new API uses delivery_status
    const statusText = trackingData?.delivery_status ||
                      trackingData?.status || 
                      trackingData?.latest_status || 
                      trackingData?.lastEvent || 
                      trackingData?.last_event ||
                      trackingData?.tracking_status ||
                      '';
    const statusLower = statusText.toLowerCase();
    
    // Get the raw TrackingMore status - try multiple fields to get the most detailed status
    // latest_event is an object with description, time_iso, location - extract description
    // Priority: latest_event.description (most detailed) > delivery_status > status > sub_status
    let trackingmoreStatus: string | undefined;
    if (trackingData?.latest_event) {
      // latest_event is an object, extract the description or stringify it
      if (typeof trackingData.latest_event === 'string') {
        trackingmoreStatus = trackingData.latest_event;
      } else if (trackingData.latest_event.description) {
        trackingmoreStatus = trackingData.latest_event.description;
      } else {
        // If it's an object without description, stringify it
        trackingmoreStatus = JSON.stringify(trackingData.latest_event);
      }
    } else {
      trackingmoreStatus = trackingData?.delivery_status || 
                          trackingData?.status || 
                          trackingData?.sub_status ||
                          trackingData?.substatus ||
                          undefined;
    }
    
    // Extract status header/description
    const statusHeader = trackingData?.delivery_status ||
                        trackingData?.latest_status || 
                        trackingData?.status || 
                        trackingData?.lastEvent ||
                        trackingData?.last_event ||
                        trackingData?.sub_status ||
                        trackingData?.substatus ||
                        statusText;
    
    // Extract ItemReceived - time when first tracking info appeared
    const itemReceived = trackingData?.ItemReceived || 
                        trackingData?.item_received || 
                        trackingData?.itemReceived ||
                        null;
    
    // Extract details from tracking events - try multiple possible paths
    // New API structure: origin_info.trackinfo is an array
    const events = trackingData?.origin_info?.trackinfo || 
                   trackingData?.destination_info?.trackinfo ||
                   trackingData?.tracking_info || 
                   trackingData?.trackinfo ||
                   trackingData?.events ||
                   trackingData?.origin_info?.tracking_info ||
                   [];
    
    // Parse events into structured format for storage
    const parsedEvents = events.map((e: any) => {
      const eventDate = e.checkpoint_date || e.date || e.track_date || e.time || e.time_iso || e.track_time;
      const location = e.track_location || e.location || e.checkpoint_location || null;
      const description = e.tracking_detail || e.details || e.track_detail || e.description || null;
      const checkpointStatus = e.checkpoint_delivery_status || e.status || e.track_status || e.event || null;
      
      return {
        event_date: eventDate ? new Date(eventDate) : new Date(),
        location: location,
        status: checkpointStatus,
        description: description,
        checkpoint_status: checkpointStatus
      };
    }).filter((e: any) => e.event_date); // Filter out events without dates
    
    const details = events.length > 0 
      ? JSON.stringify(events.map((e: any) => ({
          date: e.checkpoint_date || e.date || e.track_date || e.time,
          status: e.checkpoint_delivery_status || e.status || e.track_status || e.event,
          details: e.tracking_detail || e.details || e.track_location || e.location
        }))).substring(0, 500)
      : JSON.stringify(trackingData).substring(0, 500);
    
    // Check if tracking exists but has no status yet (pending)
    // New API: delivery_status can be "pending" with empty trackinfo
    if ((!statusText || statusLower === 'pending') && !events.length && trackingData) {
      // If we have tracking data but no status/events, it might be pending
      console.log(`[${trackingNumber}] TrackingMore: Has tracking data but no status yet, checking for pending state`);
      if (trackingData.tracking_number || trackingData.courier_code || trackingData.id) {
        // Tracking was created but not yet scanned by courier
        return {
          status: 'not_scanned',
          details,
          statusHeader: 'Pending',
          trackingmoreStatus,
          itemReceived: itemReceived || null,
          events: parsedEvents,
        };
      }
    }
    
    // Map TrackingMore status to our TrackingStatus enum
    if (statusLower.includes('delivered') || 
        statusLower.includes('delivery completed') ||
        statusLower.includes('delivered to recipient')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected DELIVERED status`);
      return {
        status: 'delivered',
        details,
        statusHeader: statusHeader || 'Delivered',
        trackingmoreStatus,
        itemReceived: itemReceived || null,
        events: parsedEvents,
      };
    } else if (statusLower.includes('cancelled') ||
               statusLower.includes('canceled') ||
               statusLower.includes('cancelled by sender') ||
               statusLower.includes('canceled by sender') ||
               statusLower.includes('cancelled by recipient') ||
               statusLower.includes('canceled by recipient')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected CANCELLED status`);
      return {
        status: 'cancelled',
        details,
        statusHeader: statusHeader || 'Cancelled',
        trackingmoreStatus,
        itemReceived: itemReceived || null,
        events: parsedEvents,
      };
    } else if (statusLower === 'transit' ||
               statusLower === 'pickup' ||
               statusLower === 'inforeceived' ||
               statusLower.includes('in transit') || 
               statusLower.includes('on its way') ||
               statusLower.includes('collected') ||
               statusLower.includes('accepted') ||
               statusLower.includes('processed') ||
               statusLower.includes('scanned') ||
               statusLower.includes('we\'ve got it') ||
               statusLower.includes('arrived') ||
               statusLower.includes('departed') ||
               statusLower.includes('out for delivery')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected SCANNED status`);
      return {
        status: 'scanned',
        details,
        statusHeader: statusHeader || 'In Transit',
        trackingmoreStatus,
        itemReceived: itemReceived || null,
        events: parsedEvents,
      };
    } else if (statusLower.includes('not found') ||
               statusLower.includes('no information') ||
               statusLower.includes('pending')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected NOT_SCANNED status`);
      return {
        status: 'not_scanned',
        details,
        statusHeader: statusHeader || 'Not Collected',
        trackingmoreStatus,
        events: parsedEvents,
      };
    } else {
      // Default: if we have any tracking info, consider it scanned
      if (events.length > 0) {
        console.log(`[${trackingNumber}] TrackingMore: Has tracking events, defaulting to SCANNED`);
        return {
          status: 'scanned',
          details,
          statusHeader: statusHeader || 'In Transit',
          trackingmoreStatus,
          itemReceived: itemReceived || null,
          events: parsedEvents,
        };
      } else {
        console.log(`[${trackingNumber}] TrackingMore: No tracking info, defaulting to NOT_SCANNED`);
        return {
          status: 'not_scanned',
          details,
          statusHeader: statusHeader || 'Not Collected',
          trackingmoreStatus,
          itemReceived: itemReceived || null,
          events: parsedEvents,
        };
      }
    }
  } catch (error) {
    console.error(`[${trackingNumber}] Error parsing TrackingMore response:`, error);
    return {
      status: 'not_scanned',
      details: 'Error parsing TrackingMore response',
      trackingmoreStatus: undefined,
    };
  }
}

export async function checkInPostStatus(trackingNumber: string): Promise<{
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
  trackingmoreStatus?: string;
  itemReceived?: Date | string | null;
  events?: Array<{
    event_date: Date | string;
    location?: string | null;
    status?: string | null;
    description?: string | null;
    checkpoint_status?: string | null;
  }>;
}> {
  try {
    // Use TrackingMore API
    if (!TRACKINGMORE_API_KEY) {
      console.error('TrackingMore API key not configured');
      return { 
        status: 'not_scanned', 
        details: 'TrackingMore API key not configured' 
      };
    }

    // Debug: Log API key status (first 4 chars only for security)
    console.log(`[${trackingNumber}] TrackingMore API key configured: ${TRACKINGMORE_API_KEY.substring(0, 4)}... (length: ${TRACKINGMORE_API_KEY.length})`);
    console.log(`[${trackingNumber}] Fetching via TrackingMore API...`);
    
    // Clean tracking number (remove spaces)
    const cleanTrackingNumber = trackingNumber.replace(/\s+/g, '');
    
    try {
      // Step 1: Create tracking in TrackingMore (if not already exists)
      // Use InPost UK for JJD/MD (UK), InPost Poland (Paczkomaty) for others
      const courierCode = getCourierCodeForTrackingNumber(cleanTrackingNumber);
      let trackingCreated = false;
      
      try {
        console.log(`[${trackingNumber}] Creating tracking in TrackingMore with courier code: ${courierCode}...`);
        const requestBody = {
          tracking_number: cleanTrackingNumber,
          courier_code: courierCode,
        };
        
        // Add delay to avoid rate limiting (429 errors)
        // 500ms delay = max 2 requests/second, well under API limit of 10/sec
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Use the correct endpoint: /trackings/create
        // Try both header formats - v4 might use different header than v2
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        };
        
        // Try Tracking-Api-Key first (v4 format), fallback to Trackingmore-Api-Key (v2 format)
        // Based on user feedback that same API key works on another site
        headers['Tracking-Api-Key'] = TRACKINGMORE_API_KEY;
        
        console.log(`[${trackingNumber}] Using header: Tracking-Api-Key (v4 format)`);
        console.log(`[${trackingNumber}] API Base URL: ${TRACKINGMORE_API_BASE}`);
        
        const createResponse = await axios.post(
          `${TRACKINGMORE_API_BASE}/trackings/create`,
          requestBody,
          {
            headers,
            timeout: 30000,
          }
        );
        console.log(`[${trackingNumber}] Created via /trackings/create endpoint`);
        console.log(`[${trackingNumber}] POST response status: ${createResponse.status}`);
        console.log(`[${trackingNumber}] POST response body:`, JSON.stringify(createResponse.data, null, 2).substring(0, 1000));
        
        // Check meta.code in response - 200 means success
        const metaCode = createResponse.data?.meta?.code;
        const metaMessage = createResponse.data?.meta?.message || '';
        
        if (metaCode === 200) {
          // Check if data exists - new API returns data object with id, tracking_number, etc.
          if (createResponse.data?.data) {
            const dataObj = createResponse.data.data;
            // Check if it's an object with tracking info (new API format)
            if (!Array.isArray(dataObj) && (dataObj.id || dataObj.tracking_number)) {
              console.log(`[${trackingNumber}] Tracking successfully created in TrackingMore with courier code: ${courierCode}`);
              // Use the response data directly - it contains the tracking info
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else if (Array.isArray(dataObj) && dataObj.length > 0) {
              // Array format (old API)
              console.log(`[${trackingNumber}] Tracking created/updated (200) in TrackingMore with courier code: ${courierCode}`);
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else {
              console.warn(`[${trackingNumber}] POST returned 200 but data is empty or invalid`);
            }
          } else {
            console.warn(`[${trackingNumber}] POST returned 200 but no data field`);
          }
        } else {
          console.warn(`[${trackingNumber}] POST returned meta.code ${metaCode}: ${metaMessage}`);
        }
        
        trackingCreated = true;
      } catch (createError) {
        if (axios.isAxiosError(createError) && createError.response) {
          const errorData = createError.response.data;
          const errorCode = errorData?.meta?.code;
          const errorStatus = createError.response.status;
          
          // Enhanced logging for 401 errors
          if (errorStatus === 401) {
            console.error(`[${trackingNumber}] 401 Authentication Error Details:`);
            console.error(`  API Key configured: ${TRACKINGMORE_API_KEY ? 'YES' : 'NO'}`);
            console.error(`  API Key length: ${TRACKINGMORE_API_KEY?.length || 0}`);
            console.error(`  API Key preview: ${TRACKINGMORE_API_KEY?.substring(0, 8) || 'N/A'}...`);
            console.error(`  Header used: Tracking-Api-Key`);
            console.error(`  API Base: ${TRACKINGMORE_API_BASE}`);
            console.error(`  Error message: ${errorData?.meta?.message || 'Unknown'}`);
            console.error(`  Full error response:`, JSON.stringify(errorData, null, 2));
          }
          
          // Handle 400 with code 4101: "Tracking No. already exists" - response may only have minimal data
          if (errorStatus === 400 && errorCode === 4101) {
            console.log(`[${trackingNumber}] Tracking already exists in TrackingMore (4101), checking if response has full data`);
            if (errorData?.data && !Array.isArray(errorData.data)) {
              const dataObj = errorData.data;
              // Check if response has actual status information (not just id/tracking_number/courier_code)
              if (dataObj.delivery_status || dataObj.latest_event || dataObj.origin_info?.trackinfo?.length > 0) {
                console.log(`[${trackingNumber}] 400/4101 response contains full tracking data, using it`);
                return parseTrackingMoreResponse(errorData, trackingNumber);
              } else {
                console.log(`[${trackingNumber}] 400/4101 response only has minimal data (id/tracking_number), will fetch full data via GET`);
              }
            }
            trackingCreated = true; // Tracking exists, we need to GET it for full data
          }
          // Handle 409: Tracking already exists (alternative status code)
          else if (errorStatus === 409) {
            console.log(`[${trackingNumber}] Tracking already exists in TrackingMore (409), checking if response has full data`);
            if (errorData?.data && !Array.isArray(errorData.data)) {
              const dataObj = errorData.data;
              // Check if response has actual status information
              if (dataObj.delivery_status || dataObj.latest_event || dataObj.origin_info?.trackinfo?.length > 0) {
                console.log(`[${trackingNumber}] 409 response contains full tracking data, using it`);
                return parseTrackingMoreResponse(errorData, trackingNumber);
              } else {
                console.log(`[${trackingNumber}] 409 response only has minimal data, will fetch full data via GET`);
              }
            } else if (errorData?.data && Array.isArray(errorData.data) && errorData.data.length > 0) {
              console.log(`[${trackingNumber}] 409 response contains tracking data array, using it`);
              return parseTrackingMoreResponse(errorData, trackingNumber);
            }
            trackingCreated = true; // Tracking exists, we need to GET it for full data
          }
          // Handle 429: Rate limit exceeded
          // Per TrackingMore docs: wait 120 seconds after 429 error
          else if (errorStatus === 429) {
            console.warn(`[${trackingNumber}] Rate limit exceeded (429), waiting 120 seconds before retrying GET (per API docs)`);
            // Wait 120 seconds as recommended by TrackingMore API documentation
            await new Promise(resolve => setTimeout(resolve, 120000));
            trackingCreated = true; // Assume it might exist, try to GET it
          }
          // Handle 4120: Invalid courier code (shouldn't happen with inpost-paczkomaty, but log it)
          else if (errorCode === 4120) {
            console.warn(`[${trackingNumber}] Invalid courier code (4120): ${errorData?.meta?.message}`);
          }
          // Other errors
          else {
            console.warn(`[${trackingNumber}] Failed to create tracking:`, 
              `${errorStatus} ${createError.response.statusText}`,
              JSON.stringify(errorData).substring(0, 200));
          }
        } else {
          console.warn(`[${trackingNumber}] Failed to create tracking:`, createError);
        }
      }
      
      // If POST response was empty, try to GET the tracking data
      // This handles cases where tracking exists in TrackingMore but POST didn't return data
      if (!trackingCreated) {
        console.warn(`[${trackingNumber}] Could not create tracking with any courier code, trying to fetch existing tracking...`);
      } else {
        console.log(`[${trackingNumber}] POST returned empty data, fetching tracking from TrackingMore...`);
      }
      
      // Wait longer for TrackingMore to process the tracking (especially if it was just created)
      // Also add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try to GET the tracking data using the correct endpoint: /trackings/get?tracking_numbers=...
      try {
        // Add delay before GET to avoid rate limiting (500ms = max 2 requests/second)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log(`[${trackingNumber}] Fetching tracking data from TrackingMore using GET API...`);
        const getResponse = await axios.get(
          `${TRACKINGMORE_API_BASE}/trackings/get`,
          {
            params: {
              tracking_numbers: cleanTrackingNumber,
            },
            headers: {
              'Tracking-Api-Key': TRACKINGMORE_API_KEY,  // v4 uses Tracking-Api-Key
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
        
        if (getResponse.status === 200 && getResponse.data) {
          const responseData = getResponse.data;
          // GET API returns data as an array
          if (responseData?.data && Array.isArray(responseData.data) && responseData.data.length > 0) {
            // Find the matching tracking number in the array
            const trackingData = responseData.data.find((item: any) => 
              item.tracking_number === cleanTrackingNumber || 
              item.tracking_number?.replace(/\s+/g, '') === cleanTrackingNumber
            );
            
            if (trackingData) {
              console.log(`[${trackingNumber}] Successfully fetched tracking data from TrackingMore`);
              console.log(`[${trackingNumber}] GET response delivery_status: ${trackingData.delivery_status}`);
              
              // Check if delivery_status is "pending" but tracking might actually be delivered
              // Sometimes TrackingMore API returns stale "pending" even when dashboard shows "delivered"
              // Check for other indicators like latest_event, trackinfo, etc.
              if (trackingData.delivery_status === 'pending' || !trackingData.delivery_status) {
                // Check if there are tracking events that might indicate actual status
                const hasEvents = trackingData.origin_info?.trackinfo?.length > 0 || 
                                 trackingData.destination_info?.trackinfo?.length > 0;
                const hasLatestEvent = !!trackingData.latest_event;
                
                if (hasEvents || hasLatestEvent) {
                  console.log(`[${trackingNumber}] GET returned "pending" but has events/latest_event - may be stale data, will parse anyway`);
                } else {
                  console.log(`[${trackingNumber}] GET returned "pending" with no events - likely truly pending`);
                }
              }
              
              // Wrap in the expected format for parseTrackingMoreResponse
              return parseTrackingMoreResponse({ data: trackingData }, trackingNumber);
            } else {
              console.log(`[${trackingNumber}] GET returned data but tracking number not found in array`);
            }
          } else {
            console.log(`[${trackingNumber}] GET returned 200 but data is empty. Full response:`, 
              JSON.stringify(responseData, null, 2).substring(0, 1000));
          }
        }
      } catch (getError) {
        if (axios.isAxiosError(getError) && getError.response) {
          const errorStatus = getError.response.status;
          const errorData = getError.response.data;
          
          // Handle 429: Rate limit exceeded
          // Per TrackingMore docs: wait 120 seconds after 429 error
          if (errorStatus === 429) {
            console.warn(`[${trackingNumber}] GET rate limit exceeded (429), returning not_scanned (will retry on next scheduler run)`);
            // Don't retry immediately - wait for next scheduler run (5 minutes)
            // Per API docs, should wait 120 seconds, but scheduler runs every 5 minutes anyway
          } else {
            console.warn(`[${trackingNumber}] GET failed (${errorStatus}):`,
              JSON.stringify(errorData).substring(0, 200));
          }
        } else {
          console.warn(`[${trackingNumber}] GET failed:`, getError);
        }
      }
      
      
      // If GET also fails or returns empty, tracking hasn't been scanned yet
      console.log(`[${trackingNumber}] No tracking data available yet - returning not_scanned`);
      return {
        status: 'not_scanned',
        details: 'Tracking created but not yet scanned by InPost',
      };
    } catch (trackingMoreError) {
      console.error(`[${trackingNumber}] TrackingMore API error:`, 
        axios.isAxiosError(trackingMoreError) 
          ? `${trackingMoreError.response?.status} ${trackingMoreError.response?.statusText}: ${JSON.stringify(trackingMoreError.response?.data)}`
          : 'Unknown error');
      
      // Return not_scanned if TrackingMore fails
      return {
        status: 'not_scanned',
        details: `TrackingMore API error: ${axios.isAxiosError(trackingMoreError) ? trackingMoreError.message : 'Unknown error'}`,
      };
    }
    
    // If we reach here, both methods failed
    return {
      status: 'not_scanned',
      details: 'Unable to fetch tracking information',
    };
    
  } catch (error) {
    console.error(`Error checking status for ${trackingNumber}:`, error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Server responded with error status
        console.error(`TrackingMore API error: ${error.response.status} ${error.response.statusText}`);
        console.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
        console.error(`Response headers:`, error.response.headers);
      } else if (error.request) {
        // Request was made but no response received (timeout, network error, etc.)
        console.error(`TrackingMore request failed - no response received`);
        console.error(`Request config:`, {
          url: error.config?.url,
          method: error.config?.method,
          timeout: error.config?.timeout,
        });
        if (error.code === 'ECONNABORTED') {
          console.error(`Request timed out after ${error.config?.timeout}ms`);
        } else {
          console.error(`Error code: ${error.code}`);
        }
      } else {
        // Error setting up the request
        console.error(`Error setting up TrackingMore request:`, error.message);
      }
    } else {
      console.error(`Non-Axios error:`, error);
    }
    return { 
      status: 'not_scanned', 
      details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// No need for browser cleanup with TrackingMore
export async function closeBrowser(): Promise<void> {
  // No-op - TrackingMore is API-based
}

// ─── API Types ───
// Mirrors the Django backend models & serializers cleanly.

// ─── Auth ───
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
}

export interface TokenRefreshRequest {
  refresh: string;
}

export interface TokenRefreshResponse {
  access: string;
  refresh: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: UserRole;
  password: string;
  confirm_password: string;
  society_id?: number | null;
  block_id?: number | null;
  flat_id?: number | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
  home_label?: string;
  area_label?: string;
  base_latitude?: number | null;
  base_longitude?: number | null;
  max_travel_km?: number;
  serves_nearby_societies?: boolean;
  post_label?: string;
}

// ─── User ───
export type UserRole = 'resident' | 'guardian' | 'volunteer' | 'security' | 'admin';

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: UserRole;
  address: string;
  profile_image_url: string | null;
  is_active?: boolean;
  is_society_linked?: boolean;
  society_details?: {
    society_linked: boolean;
    society_id?: number | null;
    society_name?: string | null;
    block_id?: number | null;
    block_name?: string | null;
    flat_id?: number | null;
    flat_number?: string | null;
  } | null;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

// ─── Society ───
export interface Society {
  id: number;
  name: string;
  registration_number: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contact_email: string;
  contact_phone: string;
  admin: number | null;
  admin_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Block {
  id: number;
  society: number;
  society_name: string;
  name: string;
  block_name?: string;
  total_floors: number;
  description: string;
  flat_count: number;
  created_at: string;
}

export interface Flat {
  id: number;
  block: number;
  block_name: string;
  society_name: string;
  flat_number: string;
  floor: number;
  area_sqft: string | null;
  is_occupied: boolean;
  created_at: string;
}

export interface ResidentFlatMapping {
  id: number;
  user: number;
  user_name: string;
  user_email: string;
  flat: number;
  flat_number: string;
  block_name: string;
  society_name: string;
  occupancy_type: 'owner' | 'tenant';
  is_primary_resident: boolean;
  move_in_date: string | null;
  move_out_date: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Emergency Contacts & Guardian Requests ───
export type ContactType = 'primary_guardian' | 'secondary_guardian' | 'emergency_contact';
export type GuardianRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type Relationship =
  | 'spouse'
  | 'parent'
  | 'sibling'
  | 'child'
  | 'relative'
  | 'friend'
  | 'neighbor'
  | 'colleague'
  | 'doctor'
  | 'other';

export interface UserLookupResult {
  id: number;
  name: string;
  username: string;
  masked_phone: string;
  role: UserRole;
}

export interface EmergencyContact {
  id: number;
  resident: number;
  resident_name?: string;
  linked_user?: number | null;
  linked_username?: string | null;
  contact_type: ContactType;
  relationship: Relationship;
  name: string;
  phone: string;
  masked_phone?: string;
  email: string;
  address?: string;
  priority: number;
  status: GuardianRequestStatus;
  is_verified: boolean;
  verified_at?: string | null;
  responded_at?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreateContactRequest {
  contact_type: ContactType;
  relationship: Relationship;
  identifier?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  priority?: number;
}

export interface GuardianIncomingRequest {
  id: number;
  contact_id: number;
  resident_id: number;
  resident_name: string;
  resident_phone: string;
  flat: string;
  block: string;
  society: string;
  contact_type: ContactType;
  relationship: Relationship;
  priority: number;
  status: GuardianRequestStatus;
  created_at: string;
  responded_at: string | null;
}

export interface GuardianDependent {
  id: number;
  contact_id: number;
  name: string;
  phone: string;
  flat: string;
  society: string;
  contact_type: ContactType;
  relationship: Relationship;
  verified_at: string | null;
  has_active_incident: boolean;
  active_incident_id: number | null;
}

// ─── Incidents (Milestone 3 official 6 statuses) ───
export type EmergencyType = 'medical' | 'fall' | 'fire' | 'security' | 'accident' | 'other';

export type IncidentStatus =
  | 'REPORTED'
  | 'ACKNOWLEDGED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';

export interface IncidentPersonSummary {
  id: number;
  name: string;
  phone: string;
}

export interface IncidentLocation {
  available: boolean;
  latitude: string | null;
  longitude: string | null;
  accuracy: number | null;
  captured_at: string | null;
}

export interface IncidentEvidence {
  id: number;
  incident: number;
  uploaded_by: number;
  uploaded_by_name: string;
  image: string;
  image_url: string | null;
  url: string | null;
  created_at: string;
}

export type HistoryEventType =
  | 'created'
  | 'status_changed'
  | 'assigned'
  | 'reassigned'
  | 'evidence_added'
  | 'escalated'
  | 'auto_escalated'
  | 'guardian_acknowledged'
  | 'no_responder';

export interface IncidentHistory {
  id: number;
  incident: number;
  changed_by: number | null;
  changed_by_name: string;
  event_type: HistoryEventType;
  from_status: string;
  to_status: string;
  note: string;
  created_at: string;
}

export interface IncidentHistorySummary {
  total_events: number;
  latest_event_type: HistoryEventType | null;
  latest_note: string;
  latest_event_at: string | null;
}

export interface Incident {
  id: number;
  resident: number;
  resident_name: string;
  flat_number: string | null;
  block_name?: string | null;
  reported_by: number | null;
  reporter: IncidentPersonSummary;
  title: string;
  category: EmergencyType;
  emergency_type: EmergencyType;
  description: string;
  latitude: string | null;
  longitude: string | null;
  location_available: boolean;
  location_captured_at: string | null;
  location_accuracy: number | null;
  location: IncidentLocation;
  status: IncidentStatus;
  is_escalated: boolean;
  escalated_at: string | null;
  guardian_alerted_at?: string | null;
  guardian_acknowledged_at?: string | null;
  guardian_acknowledged_by?: IncidentPersonSummary | null;
  escalate_at?: string | null;
  escalation_window_seconds?: number;
  escalation_plan?: IncidentEscalationInfo | null;
  escalated_by?: IncidentPersonSummary | null;
  escalation_trigger?: string | null;
  no_responder_alerted_at?: string | null;
  escalation?: IncidentEscalationInfo | null;
  handoff_defaults?: string[];
  assigned_to_id: number | null;
  assigned_to: IncidentPersonSummary | null;
  assigned_at: string | null;
  acknowledged_at: string | null;
  in_progress_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  close_reason: string;
  evidence: IncidentEvidence[];
  evidence_urls: string[];
  history: IncidentHistory[];
  history_summary: IncidentHistorySummary;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface SOSRequest {
  emergency_type: EmergencyType;
  description?: string;
  latitude?: string;
  longitude?: string;
  location_captured_at?: string;
  location_accuracy?: number;
}

export interface SOSResponse {
  id: number;
  status: IncidentStatus;
  created_at: string;
  location_available: boolean;
}

export interface ReportIncidentResponse {
  id: number;
  title: string;
  category: EmergencyType;
  status: IncidentStatus;
  created_at: string;
  location_available: boolean;
  evidence_count: number;
}

export interface IncidentStatusResponse {
  id: number;
  status: IncidentStatus;
  is_escalated: boolean;
  escalated_at: string | null;
  acknowledged_at: string | null;
  assigned_at: string | null;
  in_progress_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  close_reason: string;
  updated_at: string;
}

export interface AvailableVolunteer {
  id: number;
  name: string;
  phone: string;
  email: string;
  is_available: boolean;
  open_assignments_count: number;
}

// ─── Notifications ───
export type NotificationChannel = 'push' | 'sms' | 'email' | 'in_app';
export type NotificationEventType =
  | 'INCIDENT_REPORTED'
  | 'INCIDENT_ASSIGNED'
  | 'STATUS_CHANGED'
  | 'EVIDENCE_ADDED'
  | 'ESCALATED'
  | 'GUARDIAN_REQUEST'
  | 'GUARDIAN_ACCEPTED'
  | 'GUARDIAN_DECLINED'
  | 'GUARDIAN_SOS'
  | 'ESCALATION_HANDOFF'
  | 'ESCALATION_AUTO'
  | 'ESCALATION_ACCEPTED'
  | 'NO_RESPONDER'
  | 'ESCALATION_NOTICE';
export type RecipientType =
  | 'primary_guardian'
  | 'secondary_guardian'
  | 'security'
  | 'volunteer'
  | 'community'
  | 'admin'
  | 'resident';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface Notification {
  id: number;
  incident: number | null;
  event_type: NotificationEventType;
  recipient_type: RecipientType;
  channel: NotificationChannel;
  title: string;
  message: string;
  delivery_status: DeliveryStatus;
  is_simulated: boolean;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface NotificationRecord {
  id: number;
  event_type: NotificationEventType;
  recipient_name: string;
  recipient_type: RecipientType;
  channel: NotificationChannel;
  delivery_status: DeliveryStatus;
  is_simulated: boolean;
  provider_message_id: string;
  failure_reason: string;
  attempt_count: number;
  last_attempt_at: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface RetryResult {
  retried: number;
  skipped_max_attempts: number;
  skipped_cooldown: number;
}

// ─── Mocked legacy types (kept for existing chat/guardian adapters) ───
export interface IncidentMessage {
  id: string;
  incident_id: number;
  user_id: number;
  user_name: string;
  user_role: UserRole;
  message: string;
  created_at: string;
}

export interface IncidentResponder {
  id: string;
  incident_id: number;
  user_id: number;
  user_name: string;
  user_role: UserRole;
  role?: string;
  status: 'accepted' | 'declined' | 'en_route' | 'arrived';
  accepted_at: string;
}

// ─── Milestone 3 Escalation & Volunteer Matching Types ───

export interface IncidentEscalationInfo {
  window_seconds: number;
  escalate_at: string | null;
  targets: string[];
  has_verified_guardian: boolean;
  primary_guardian_name: string | null;
  primary_guardian_id?: number | null;
  secondary_guardian_name?: string | null;
  security_included?: boolean;
  security_skip_reason?: string | null;
  target_counts?: Record<string, number>;
  volunteer_ids?: number[];
}

export interface ResidentEscalationSettings {
  has_security_guard: boolean;
  escalate_to_security: boolean;
  escalate_to_volunteers: boolean;
  escalate_to_secondary_guardian: boolean;
  response_window_seconds: number;
  volunteer_radius_km: number;
  updated_at?: string;
}

export interface EscalationPreview {
  has_verified_guardian: boolean;
  primary_guardian: { id: number; name: string; phone: string } | null;
  has_secondary_guardian: boolean;
  secondary_guardian: { id: number; name: string; phone: string } | null;
  security_available: boolean;
  volunteer_breakdown: {
    summary: string;
    total_count: number;
    same_block_count: number;
    same_society_count: number;
    neighbour_society_count: number;
  };
}

export interface ResidentEscalationSettingsResponse extends ResidentEscalationSettings {
  preview: EscalationPreview;
}

export interface VolunteerProfile {
  id: number;
  name?: string;
  email?: string;
  society: number;
  society_name?: string;
  block: number | null;
  block_name?: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  pin_label?: string;
  max_travel_km: number;
  serves_nearby_societies: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_reviewed_at: string | null;
  approval_note: string;
  pin_far_from_society: boolean;
  pin_distance_from_society_km: number | null;
  area_label?: string | null;
  user_name?: string;
  username?: string;
  phone?: string;
  created_at?: string;
}

export interface VolunteerLocation {
  latitude: number | string | null;
  longitude: number | string | null;
  accuracy: number | null;
  updated_at: string | null;
}

export interface SocietyAlertPolicy {
  id?: number;
  society?: number;
  notify_community: boolean;
  include_neighbour_societies: boolean;
  neighbour_radius_km: number;
  society_latitude?: number | string | null;
  society_longitude?: number | string | null;
}

export interface GuardianHandoffRequest {
  targets: ('secondary_guardian' | 'security' | 'volunteers')[];
  reason: 'far_away' | 'busy' | 'other';
  note?: string;
  volunteer_mode?: 'auto' | 'selected';
  volunteer_ids?: number[];
  security_guard_ids?: number[];
}


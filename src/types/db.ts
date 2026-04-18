export interface UserRow {
  id: string;
  role: "admin" | "pgbo";
  pgcode: string | null;
  email: string | null;
  katasandi_hash: string;
  pageid: string | null;
  foto_profil_url: string | null;
  nama_lengkap: string | null;
  nama_panggilan: string | null;
  no_telpon: string | null;
  link_group_whatsapp: string | null;
  sosmed_facebook: string | null;
  sosmed_instagram: string | null;
  sosmed_tiktok: string | null;
  is_active: number;
  created_at: string;
}

export interface LeadRow {
  id: string;
  user_id: string;
  nama: string | null;
  branch: string | null;
  no_telpon: string | null;
  created_at: string;
  exported_at: string | null;
}

export interface AnalyticsRow {
  id: string;
  user_id: string;
  event_type: string;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

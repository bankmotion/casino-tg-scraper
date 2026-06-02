export interface ChannelDef {
  id: number;
  partner_id: string;
  username: string | null;
  invite_link: string | null;
  title: string;
  is_active: boolean;
}

export interface ChannelInput {
  partner_id: string;
  username?: string | null;
  invite_link?: string | null;
  title: string;
  is_active?: boolean;
}

export interface ChannelPatch {
  partner_id?: string;
  username?: string | null;
  invite_link?: string | null;
  title?: string;
  is_active?: boolean;
}

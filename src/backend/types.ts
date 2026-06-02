export interface ChannelDef {
  id: number;
  username: string | null;
  invite_link: string | null;
  title: string;
  is_active: boolean;
}

export interface ChannelInput {
  username?: string | null;
  invite_link?: string | null;
  title: string;
  is_active?: boolean;
}

export interface ChannelPatch {
  username?: string | null;
  invite_link?: string | null;
  title?: string;
  is_active?: boolean;
}

import type { Availability, ContentType, LiveStreamStatus, MediaKind, PublishStatus, UserRole } from "./domain.ts";

/** Query parameters shared by every list endpoint. */
export type ListQuery = {
  limit: number;
  offset: number;
  page: number;
  sort: string;
  order: "asc" | "desc";
  q?: string;
  language?: string;
  includeDrafts?: boolean;
};

export type ListMeta = {
  total: number;
  limit: number;
  offset: number;
  page: number;
  pageCount: number;
  hasMore: boolean;
};

export type Envelope<T> = {
  data: T;
  meta?: ListMeta;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  tokenType: "Bearer";
};

export type AuthSession = {
  user: import("./domain.ts").User;
  tokens: AuthTokens;
};

export type TrackFilters = ListQuery & {
  kind?: MediaKind;
  albumId?: string;
  artist?: string;
  genre?: string;
  mood?: string;
  downloadable?: boolean;
  featured?: boolean;
  live?: boolean;
  collectionId?: string;
};

export type VideoFilters = ListQuery & {
  category?: string;
  captions?: boolean;
  downloadable?: boolean;
};

export type HymnFilters = ListQuery & {
  edition?: string;
  theme?: string;
  number?: string;
  downloadable?: boolean;
};

export type SermonFilters = ListQuery & {
  series?: string;
  speaker?: string;
  topic?: string;
  downloadable?: boolean;
};

export type NewsFilters = ListQuery & {
  category?: string;
  region?: string;
  tag?: string;
  featured?: boolean;
};

export type ChurchFilters = ListQuery & {
  country?: string;
  city?: string;
  region?: string;
  verified?: boolean;
  live?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
};

export type EventFilters = ListQuery & {
  category?: string;
  churchId?: string;
  online?: boolean;
  live?: boolean;
  from?: string;
  to?: string;
};

export type LiveFilters = ListQuery & {
  status?: LiveStreamStatus;
  churchId?: string;
};

export type BibleFilters = ListQuery & {
  version?: string;
  testament?: "Old" | "New";
};

export type SearchFilters = ListQuery & {
  types?: ContentType[];
  availability?: Availability;
  includeBody?: boolean;
};

export type PublishStatusFilter = PublishStatus;
export type RoleFilter = UserRole;

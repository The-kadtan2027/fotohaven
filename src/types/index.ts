export interface Ceremony {
  id: string;
  name: string;
  albumId: string;
  order: number;
}

export interface Photo {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  ceremonyId: string;
  isReturn?: boolean;
  returnOf?: string | null;
  isSelected?: boolean;
}

export interface ReturnUploadPayload {
  ceremonyId: string;
  filename: string;
  contentType: string;
  size: number;
  returnOf?: string; // optional link to original photoId
}

export interface Album {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  expiresAt: string | null;
  ceremonies: Ceremony[];
}

export interface UploadPhotoPayload {
  ceremonyId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface UploadPhotoResponse {
  photoId: string;
  uploadUrl: string;
  storageKey: string;
}

export interface CreateAlbumPayload {
  title: string;
  clientName: string;
  ceremonies: string[];
  expiresAt: string | null;
  password?: string | null;
  notifyEmail?: string | null;
}



export interface Comment {
  id: string;
  body: string;
  author: string;
  photoId: string;
  createdAt: string;
}


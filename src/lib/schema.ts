import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const albums = sqliteTable('Album', {
  id:          text('id').primaryKey(),
  title:       text('title').notNull(),
  clientName:  text('clientName').notNull(),
  shareToken:  text('shareToken').notNull().unique(),
  password:    text('password'),
  notifyEmail: text('notifyEmail'),
  compressionQuality: integer('compressionQuality').notNull().default(80),
  compressionFormat: text('compressionFormat').notNull().default('webp'),
  dedupThreshold: integer('dedupThreshold').notNull().default(10),
  expiresAt:   integer('expiresAt', { mode: 'timestamp_ms' }),
  firstViewedAt: integer('firstViewedAt', { mode: 'timestamp_ms' }),
  createdAt:   integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:   integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const ceremonies = sqliteTable('Ceremony', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  albumId:   text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  order:     integer('order').notNull().default(0),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const photos = sqliteTable('Photo', {
  id:           text('id').primaryKey(),
  filename:     text('filename').notNull(),
  originalName: text('originalName').notNull(),
  size:         integer('size').notNull(),
  mimeType:     text('mimeType').notNull(),
  storageKey:   text('storageKey').notNull(),
  width:        integer('width'),
  height:       integer('height'),
  ceremonyId:   text('ceremonyId').notNull().references(() => ceremonies.id, { onDelete: 'cascade' }),
  isReturn:     integer('isReturn', { mode: 'boolean' }).notNull().default(false),
  returnOf:     text('returnOf'),
  isSelected:   integer('isSelected', { mode: 'boolean' }).notNull().default(false),
  isBlurred:    integer('isBlurred', { mode: 'boolean' }).notNull().default(false),
  imageHash:    text('imageHash'),
  faceProcessed: integer('faceProcessed', { mode: 'boolean' }).notNull().default(false),
  thumbnailKey: text('thumbnailKey'),
  createdAt:    integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const comments = sqliteTable('Comment', {
  id:        text('id').primaryKey(),
  body:      text('body').notNull(),
  author:    text('author').notNull(),
  photoId:   text('photoId').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const photographers = sqliteTable('Photographer', {
  id:           text('id').primaryKey(),
  username:     text('username').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  createdAt:    integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const guests = sqliteTable('Guest', {
  id:             text('id').primaryKey(),
  albumId:        text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  name:           text('name').notNull(),
  email:          text('email'),
  phone:          text('phone'),
  faceDescriptor: text('faceDescriptor'),
  sessionToken:   text('sessionToken'),
  createdAt:      integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const photoFaces = sqliteTable('PhotoFace', {
  id:          text('id').primaryKey(),
  photoId:     text('photoId').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  descriptor:  text('descriptor').notNull(),
  boundingBox: text('boundingBox').notNull(),
});

export const guestOtps = sqliteTable('GuestOtp', {
  id:         text('id').primaryKey(),
  albumId:    text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  email:      text('email').notNull(),
  codeHash:   text('codeHash').notNull(),
  expiresAt:  integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  consumedAt: integer('consumedAt', { mode: 'timestamp_ms' }),
  createdAt:  integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const activityLogs = sqliteTable('ActivityLog', {
  id:        text('id').primaryKey(),
  albumId:   text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  guestId:   text('guestId').references(() => guests.id, { onDelete: 'cascade' }),
  eventType: text('eventType').notNull(),
  payload:   text('payload'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const albumsRelations = relations(albums, ({ many }) => ({
  ceremonies: many(ceremonies),
  guests: many(guests),
  guestOtps: many(guestOtps),
  activityLogs: many(activityLogs),
}));

export const ceremoniesRelations = relations(ceremonies, ({ one, many }) => ({
  album: one(albums, {
    fields: [ceremonies.albumId],
    references: [albums.id],
  }),
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  ceremony: one(ceremonies, {
    fields: [photos.ceremonyId],
    references: [ceremonies.id],
  }),
  comments: many(comments),
  photoFaces: many(photoFaces),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  photo: one(photos, {
    fields: [comments.photoId],
    references: [photos.id],
  }),
}));

export const guestsRelations = relations(guests, ({ one, many }) => ({
  album: one(albums, {
    fields: [guests.albumId],
    references: [albums.id],
  }),
  activityLogs: many(activityLogs),
}));

export const photoFacesRelations = relations(photoFaces, ({ one }) => ({
  photo: one(photos, {
    fields: [photoFaces.photoId],
    references: [photos.id],
  }),
}));

export const guestOtpsRelations = relations(guestOtps, ({ one }) => ({
  album: one(albums, {
    fields: [guestOtps.albumId],
    references: [albums.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  album: one(albums, {
    fields: [activityLogs.albumId],
    references: [albums.id],
  }),
  guest: one(guests, {
    fields: [activityLogs.guestId],
    references: [guests.id],
  }),
}));

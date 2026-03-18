import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const albums = sqliteTable('Album', {
  id:          text('id').primaryKey(),
  title:       text('title').notNull(),
  clientName:  text('clientName').notNull(),
  shareToken:  text('shareToken').notNull().unique(),
  password:    text('password'),
  notifyEmail: text('notifyEmail'),
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
  createdAt:    integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const comments = sqliteTable('Comment', {
  id:        text('id').primaryKey(),
  body:      text('body').notNull(),
  author:    text('author').notNull(),
  photoId:   text('photoId').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});

export const albumsRelations = relations(albums, ({ many }) => ({
  ceremonies: many(ceremonies),
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
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  photo: one(photos, {
    fields: [comments.photoId],
    references: [photos.id],
  }),
}));

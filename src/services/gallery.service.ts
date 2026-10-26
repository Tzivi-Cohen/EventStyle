import type { EventType, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { toGalleryDto } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import type { GalleryQuery } from '../schemas/gallery.schema';
import { getImageStorage, removeImagesSafely } from './storage/imageStorage';

export async function listGallery(query: GalleryQuery) {
  const where: Prisma.GalleryItemWhereInput = query.category ? { category: query.category } : {};
  const [totalItems, items] = await prisma.$transaction([
    prisma.galleryItem.count({ where }),
    prisma.galleryItem.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ]);
  return toPage(items.map(toGalleryDto), totalItems, query);
}

export async function addGalleryItem(file: Express.Multer.File, data: { title: string; category: EventType }) {
  const image = await getImageStorage().upload(file, 'gallery');
  try {
    const item = await prisma.galleryItem.create({
      data: { title: data.title, category: data.category, url: image.url, publicId: image.publicId },
    });
    return toGalleryDto(item);
  } catch (error) {
    await removeImagesSafely([image.publicId]);
    throw error;
  }
}

export async function deleteGalleryItem(id: number) {
  const item = await prisma.galleryItem.findUnique({ where: { id } });
  if (!item) throw HttpError.notFound('Gallery item not found');
  await prisma.galleryItem.delete({ where: { id } });
  await removeImagesSafely([item.publicId]);
}

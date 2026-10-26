import type { Request, Response } from 'express';
import * as galleryService from '../services/gallery.service';
import { idParamSchema } from '../schemas/common.schema';
import {
  adminGalleryQuerySchema,
  galleryBodySchema,
  galleryQuerySchema,
  galleryUpdateSchema,
} from '../schemas/gallery.schema';

export async function listGallery(req: Request, res: Response) {
  const filter = galleryQuerySchema.parse(req.query);
  res.json(await galleryService.listGallery(filter));
}

export async function getGallerySummary(_req: Request, res: Response) {
  res.json(await galleryService.getGallerySummary());
}

export async function listAdminGallery(req: Request, res: Response) {
  const filter = adminGalleryQuerySchema.parse(req.query);
  res.json(await galleryService.listAdminGallery(filter));
}

export async function addGalleryItem(req: Request, res: Response) {
  const data = galleryBodySchema.parse(req.body);
  res.status(201).json(await galleryService.addGalleryItem(req.file!, data));
}

export async function updateGalleryItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = galleryUpdateSchema.parse(req.body);
  res.json(await galleryService.updateGalleryItem(id, input));
}

export async function deleteGalleryItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await galleryService.deleteGalleryItem(id);
  res.status(204).send();
}

import type { NextFunction, Request, Response } from 'express';
import * as photosService from '../services/photos.service';
import { idParamSchema } from '../schemas/common.schema';
import { photoParamsSchema } from '../schemas/event.schema';
import { adminPhotoQuerySchema, consentBodySchema, publishBodySchema } from '../schemas/photo.schema';

/** לפני קבלת הקבצים: רק מנהלת או בעלת האירוע, ורק אם האירוע עוד לא מלא – כך קבצים של מי שאין לו הרשאה לא מעובדים */
export async function authorizePhotoUpload(req: Request, _res: Response, next: NextFunction) {
  const { id } = idParamSchema.parse(req.params);
  await photosService.assertCanUpload(id, req.user!);
  next();
}

export async function listEventPhotos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await photosService.listEventPhotos(id, req.user!));
}

export async function getEventPhoto(req: Request, res: Response) {
  const { id, photoId } = photoParamsSchema.parse(req.params);
  res.json(await photosService.getEventPhoto(id, photoId, req.user!));
}

export async function addEventPhotos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const files = req.files as Express.Multer.File[];
  res.status(201).json(await photosService.addEventPhotos(id, files, req.user!));
}

export async function deleteEventPhoto(req: Request, res: Response) {
  const { id, photoId } = photoParamsSchema.parse(req.params);
  await photosService.deleteEventPhoto(id, photoId, req.user!);
  res.status(204).send();
}

export async function setPublishConsent(req: Request, res: Response) {
  const { id, photoId } = photoParamsSchema.parse(req.params);
  const { publishConsent } = consentBodySchema.parse(req.body);
  res.json(await photosService.setPublishConsent(id, photoId, publishConsent, req.user!));
}

export async function publishPhoto(req: Request, res: Response) {
  const { id, photoId } = photoParamsSchema.parse(req.params);
  const input = publishBodySchema.parse(req.body);
  res.status(201).json(await photosService.publishPhoto(id, photoId, input));
}

export async function listAdminPhotos(req: Request, res: Response) {
  const query = adminPhotoQuerySchema.parse(req.query);
  res.json(await photosService.listAdminPhotos(query, req.user!));
}

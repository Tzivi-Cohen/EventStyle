import type { Request, Response } from 'express';
import * as eventsService from '../services/events.service';
import { idParamSchema, paginationSchema } from '../schemas/common.schema';
import {
  eventBodySchema,
  eventListQuerySchema,
  eventStatusBodySchema,
  photoParamsSchema,
} from '../schemas/event.schema';

export async function listEvents(req: Request, res: Response) {
  const query = eventListQuerySchema.parse(req.query);
  res.json(await eventsService.listEvents(query));
}

export async function listMyEvents(req: Request, res: Response) {
  const pagination = paginationSchema.parse(req.query);
  res.json(await eventsService.listMyEvents(req.user!, pagination));
}

export async function getEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await eventsService.getEvent(id, req.user!));
}

export async function createEvent(req: Request, res: Response) {
  const input = eventBodySchema.parse(req.body);
  res.status(201).json(await eventsService.createEvent(input));
}

export async function updateEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = eventBodySchema.parse(req.body);
  res.json(await eventsService.updateEvent(id, input));
}

export async function updateEventStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { status } = eventStatusBodySchema.parse(req.body);
  res.json(await eventsService.updateEventStatus(id, status));
}

export async function deleteEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await eventsService.deleteEvent(id);
  res.status(204).send();
}

export async function addEventPhotos(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const files = req.files as Express.Multer.File[];
  res.status(201).json(await eventsService.addEventPhotos(id, files));
}

export async function deleteEventPhoto(req: Request, res: Response) {
  const { id, photoId } = photoParamsSchema.parse(req.params);
  await eventsService.deleteEventPhoto(id, photoId);
  res.status(204).send();
}

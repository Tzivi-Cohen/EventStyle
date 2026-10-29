import type { Request, Response } from 'express';
import * as eventsService from '../services/events.service';
import { idParamSchema } from '../schemas/common.schema';
import {
  eventBodySchema,
  eventListQuerySchema,
  eventRequestBodySchema,
  eventRequestUpdateSchema,
  eventStatusBodySchema,
  rejectRequestBodySchema,
} from '../schemas/event.schema';

export async function listEvents(req: Request, res: Response) {
  const query = eventListQuerySchema.parse(req.query);
  res.json(await eventsService.listEvents(query));
}

export async function listMyEvents(req: Request, res: Response) {
  const query = eventListQuerySchema.parse(req.query);
  res.json(await eventsService.listMyEvents(req.user!, query));
}

export async function getEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await eventsService.getEvent(id, req.user!));
}

export async function createEvent(req: Request, res: Response) {
  const input = eventBodySchema.parse(req.body);
  res.status(201).json(await eventsService.createEvent(input, req.user!));
}

export async function updateEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = eventBodySchema.parse(req.body);
  res.json(await eventsService.updateEvent(id, input, req.user!));
}

export async function updateEventStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { status } = eventStatusBodySchema.parse(req.body);
  res.json(await eventsService.updateEventStatus(id, status, req.user!));
}

export async function deleteEvent(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await eventsService.deleteEvent(id);
  res.status(204).send();
}

export async function createRequest(req: Request, res: Response) {
  const input = eventRequestBodySchema.parse(req.body);
  res.status(201).json(await eventsService.createRequest(input, req.user!));
}

export async function updateRequest(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = eventRequestUpdateSchema.parse(req.body);
  res.json(await eventsService.updateRequest(id, input, req.user!));
}

export async function approveRequest(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  res.json(await eventsService.approveRequest(id, req.user!));
}

export async function rejectRequest(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { reason } = rejectRequestBodySchema.parse(req.body ?? {});
  res.json(await eventsService.rejectRequest(id, reason, req.user!));
}

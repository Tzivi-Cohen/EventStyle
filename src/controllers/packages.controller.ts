import type { Request, Response } from 'express';
import * as packagesService from '../services/packages.service';
import { idParamSchema } from '../schemas/common.schema';
import { adminPackagesQuerySchema, packageBodySchema, publicPackagesQuerySchema } from '../schemas/package.schema';

export async function listPackages(req: Request, res: Response) {
  const query = publicPackagesQuerySchema.parse(req.query);
  res.json(await packagesService.listPackages(query));
}

export async function listAdminPackages(req: Request, res: Response) {
  const query = adminPackagesQuerySchema.parse(req.query);
  res.json(await packagesService.listAdminPackages(query));
}

export async function createPackage(req: Request, res: Response) {
  const input = packageBodySchema.parse(req.body);
  res.status(201).json(await packagesService.createPackage(input));
}

export async function updatePackage(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = packageBodySchema.parse(req.body);
  res.json(await packagesService.updatePackage(id, input));
}

export async function archivePackage(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await packagesService.archivePackage(id);
  res.status(204).send();
}

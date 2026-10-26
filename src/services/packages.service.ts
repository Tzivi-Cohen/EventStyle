import { prisma } from '../db/prisma';
import { toPackageDto } from '../utils/mappers';

export async function listPackages() {
  const packages = await prisma.package.findMany({ orderBy: [{ price: 'asc' }, { id: 'asc' }] });
  return packages.map(toPackageDto);
}

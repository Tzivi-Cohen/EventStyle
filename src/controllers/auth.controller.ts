import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import {
  googleLoginSchema,
  loginSchema,
  registerSchema,
  resendCodeSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '../schemas/auth.schema';

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await authService.register(input));
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  res.json(await authService.login(input));
}

export async function me(req: Request, res: Response) {
  res.json(await authService.getCurrentUser(req.user!.id));
}

export async function verifyEmail(req: Request, res: Response) {
  const input = verifyEmailSchema.parse(req.body);
  res.json(await authService.verifyEmail(input));
}

export async function resendCode(req: Request, res: Response) {
  const { email } = resendCodeSchema.parse(req.body);
  res.json(await authService.resendVerificationCode(email));
}

export async function updateMe(req: Request, res: Response) {
  const input = updateProfileSchema.parse(req.body);
  res.json(await authService.updateProfile(req.user!.id, input));
}

export async function googleLogin(req: Request, res: Response) {
  const { idToken } = googleLoginSchema.parse(req.body);
  res.json(await authService.loginWithGoogle(idToken));
}

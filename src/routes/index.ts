import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import * as events from '../controllers/events.controller';
import * as gallery from '../controllers/gallery.controller';
import * as packages from '../controllers/packages.controller';
import * as system from '../controllers/system.controller';
import { authenticate, requireAdmin } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import { uploadManyImages, uploadSingleImage } from '../middleware/upload';

/**
 * כל נתיבי ה-API (תחת /api).
 * סדר ה-Middleware בכל נתיב: אימות (401) → תפקיד (403) → העלאת קבצים → Controller.
 */
const authRouter = Router();
authRouter.post('/register', authRateLimiter, auth.register);
authRouter.post('/login', authRateLimiter, auth.login);
authRouter.post('/google', authRateLimiter, auth.googleLogin);
authRouter.post('/verify-email', authRateLimiter, auth.verifyEmail);
authRouter.post('/resend-code', authRateLimiter, auth.resendCode);
authRouter.get('/me', authenticate, auth.me);
authRouter.patch('/me', authenticate, auth.updateMe);

const galleryRouter = Router();
galleryRouter.get('/', gallery.listGallery);
galleryRouter.post('/', authenticate, requireAdmin, uploadSingleImage('image'), gallery.addGalleryItem);
galleryRouter.delete('/:id', authenticate, requireAdmin, gallery.deleteGalleryItem);

const eventsRouter = Router();
eventsRouter.use(authenticate);
eventsRouter.get('/', requireAdmin, events.listEvents);
eventsRouter.get('/my', events.listMyEvents); // חייב להופיע לפני /:id
eventsRouter.get('/:id', events.getEvent); // מנהלת או בעל האירוע – נבדק ב-Service
eventsRouter.post('/', requireAdmin, events.createEvent);
eventsRouter.put('/:id', requireAdmin, events.updateEvent);
eventsRouter.patch('/:id/status', requireAdmin, events.updateEventStatus);
eventsRouter.delete('/:id', requireAdmin, events.deleteEvent);
eventsRouter.post('/:id/photos', requireAdmin, uploadManyImages('photos'), events.addEventPhotos);
eventsRouter.delete('/:id/photos/:photoId', requireAdmin, events.deleteEventPhoto);

// מחירון: צפייה ציבורית, ניהול (יצירה, עריכה, ארכיון) למנהלת בלבד
const packagesRouter = Router();
packagesRouter.get('/', packages.listPackages);
packagesRouter.post('/', authenticate, requireAdmin, packages.createPackage);
packagesRouter.put('/:id', authenticate, requireAdmin, packages.updatePackage);
packagesRouter.delete('/:id', authenticate, requireAdmin, packages.archivePackage); // ארכיון, לא מחיקה

// ממשק ניהול: כל הנתיבים כאן למנהלת בלבד
const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);
adminRouter.get('/packages', packages.listAdminPackages);

export const apiRouter = Router();
apiRouter.get('/health', system.health);
apiRouter.use('/packages', packagesRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/gallery', galleryRouter);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/admin', adminRouter);

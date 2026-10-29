import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import * as events from '../controllers/events.controller';
import * as gallery from '../controllers/gallery.controller';
import * as packages from '../controllers/packages.controller';
import * as photos from '../controllers/photos.controller';
import * as system from '../controllers/system.controller';
import { authenticate, requireAdmin, requireRole } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import { uploadManyImages, uploadSingleImage } from '../middleware/upload';

/**
 * כל נתיבי ה-API (תחת /api).
 * סדר ה-Middleware בכל נתיב: אימות (401) → תפקיד / בעלות (403) → העלאת קבצים → Controller.
 */
const authRouter = Router();
authRouter.post('/register', authRateLimiter, auth.register);
authRouter.post('/login', authRateLimiter, auth.login);
authRouter.post('/google', authRateLimiter, auth.googleLogin);
authRouter.get('/me', authenticate, auth.me);
authRouter.patch('/me', authenticate, auth.updateMe);

const galleryRouter = Router();
galleryRouter.get('/', gallery.listGallery); // ציבורי: מפורסמים בלבד
galleryRouter.get('/summary', gallery.getGallerySummary); // ציבורי: מפורסמים בלבד
galleryRouter.post('/', authenticate, requireAdmin, uploadSingleImage('image'), gallery.addGalleryItem);
galleryRouter.patch('/:id', authenticate, requireAdmin, gallery.updateGalleryItem);
galleryRouter.delete('/:id', authenticate, requireAdmin, gallery.deleteGalleryItem); // מחיקה לצמיתות

const eventsRouter = Router();
eventsRouter.use(authenticate);
eventsRouter.get('/', requireAdmin, events.listEvents);
eventsRouter.get('/my', events.listMyEvents); // חייב להופיע לפני /:id
eventsRouter.get('/:id', events.getEvent); // מנהלת או בעל האירוע – נבדק ב-Service
eventsRouter.post('/', requireAdmin, events.createEvent);
eventsRouter.put('/:id', requireAdmin, events.updateEvent);
eventsRouter.patch('/:id/status', requireAdmin, events.updateEventStatus);
eventsRouter.delete('/:id', requireAdmin, events.deleteEvent);

// בקשות לקוחות: יצירה ועריכה (Pending בלבד, בעלת הבקשה – נבדק ב-Service), אישור ודחייה בידי המנהלת
eventsRouter.post('/requests', requireRole('Client'), events.createRequest);
eventsRouter.patch('/:id/request', requireRole('Client'), events.updateRequest);
eventsRouter.post('/:id/approve', requireAdmin, events.approveRequest);
eventsRouter.post('/:id/reject', requireAdmin, events.rejectRequest);

// תמונות אירוע (פרטיות): מנהלת או בעלת האירוע – נבדק ב-Service. אירוע בלי בעלים – מנהלת בלבד
eventsRouter.get('/:id/photos', photos.listEventPhotos);
eventsRouter.post('/:id/photos', photos.authorizePhotoUpload, uploadManyImages('photos'), photos.addEventPhotos);
eventsRouter.get('/:id/photos/:photoId', photos.getEventPhoto); // רענון קישור הצפייה הזמני
eventsRouter.delete('/:id/photos/:photoId', photos.deleteEventPhoto); // לקוחה – רק תמונות שהעלתה
eventsRouter.put('/:id/photos/:photoId/consent', photos.setPublishConsent); // בעלת האירוע בלבד
eventsRouter.post('/:id/photos/:photoId/publish', requireAdmin, photos.publishPhoto); // עותק ציבורי בגלריה

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
adminRouter.get('/gallery', gallery.listAdminGallery);
adminRouter.get('/event-photos', photos.listAdminPhotos);

export const apiRouter = Router();
apiRouter.get('/health', system.health);
apiRouter.use('/packages', packagesRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/gallery', galleryRouter);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/admin', adminRouter);

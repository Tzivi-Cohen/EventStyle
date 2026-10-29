import { DEFAULT_PAGE_SIZE, EVENT_STATUSES, EVENT_TYPES, MAX_PAGE_SIZE, OPERATIONAL_EVENT_STATUSES } from '../schemas/common.schema';
import { MAX_PENDING_REQUESTS, SORT_FIELDS } from '../schemas/event.schema';
import { ALLOWED_MIME_TYPES, MAX_FILES_PER_REQUEST, MAX_FILE_SIZE_MB } from '../middleware/upload';
import { ADDRESS_MAX_LENGTH } from '../schemas/auth.schema';
import { MAX_FEATURES, MAX_SORT_ORDER } from '../schemas/package.schema';
import { MAX_GALLERY_SORT_ORDER } from '../schemas/gallery.schema';
import { MAX_IMAGE_DIMENSION } from '../services/storage/imageProcessing';
import { PHOTOS } from '../config/photos';

const TTL_MINUTES = PHOTOS.LINK_TTL_SECONDS / 60;
const MAX_PHOTOS_PER_EVENT = PHOTOS.MAX_PER_EVENT;

/**
 * מסמך OpenAPI 3 של EventStyle.
 * מוגש ב-/api-docs (Swagger UI) וב-/api-docs.json, ונשמר גם ב-docs/openapi.json.
 * כתובת השרת יחסית ("/") – כך ש-Swagger עובד גם מקומית וגם אחרי פריסה לענן.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: object, example?: unknown) => ({
  'application/json': { schema, ...(example !== undefined && { example }) },
});
const errorResponse = (description: string, code: string, message: string, details?: unknown) => ({
  description,
  content: jsonContent(ref('ErrorResponse'), { error: { code, message, ...(details !== undefined && { details }) } }),
});

const R = {
  validation: errorResponse('Validation error – שגיאת קלט', 'VALIDATION_ERROR', 'Validation failed', [
    { field: 'email', message: 'Invalid email address' },
  ]),
  unauthorized: errorResponse('Missing / invalid / expired token – לא מחובר', 'UNAUTHORIZED', 'Missing Bearer token'),
  forbidden: errorResponse(
    'Logged in but not allowed – אין הרשאה',
    'FORBIDDEN',
    'You do not have permission to perform this action',
  ),
  notFound: errorResponse('Not found – לא נמצא', 'NOT_FOUND', 'Event not found'),
  tooMany: errorResponse('Too many requests – יותר מדי בקשות', 'TOO_MANY_REQUESTS', 'Too many requests, please try again later'),
  fileTooLarge: errorResponse(`File larger than ${MAX_FILE_SIZE_MB}MB`, 'FILE_TOO_LARGE', `File is too large (max ${MAX_FILE_SIZE_MB}MB)`),
  unsupportedFile: errorResponse(
    'Unsupported file type',
    'UNSUPPORTED_FILE_TYPE',
    `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
  ),
  storageMissing: errorResponse(
    'Image storage (Cloudinary) is not configured on the server',
    'STORAGE_NOT_CONFIGURED',
    'Image storage is not configured on the server (set CLOUDINARY_* environment variables)',
  ),
  uploadFailed: errorResponse(
    'Image storage (Cloudinary) rejected the upload',
    'UPLOAD_FAILED',
    'Image upload failed, please try again later',
  ),
  storageDeleteFailed: errorResponse(
    'A public gallery copy could not be removed from storage. It is hidden, nothing else was deleted – retry the request',
    'STORAGE_DELETE_FAILED',
    'The public gallery copy could not be removed from storage. It is hidden; please try again',
    { galleryItemIds: [12] },
  ),
  copyCreatedMeanwhile: errorResponse(
    'A gallery copy was created while deleting (rare race) – nothing was deleted, retry the request',
    'PHOTO_IN_GALLERY',
    'A gallery copy was created while deleting. Please try again',
    { galleryItemIds: [12] },
  ),
  noContent: { description: 'Deleted successfully – נמחק (ללא תוכן בתשובה)' },
  eventForbidden: errorResponse(
    'Event belongs to another client, or has no owner (clients only)',
    'FORBIDDEN',
    'You do not have access to this event',
  ),
  photoNotFound: errorResponse(
    'Event or photo not found (or the photo belongs to another event)',
    'NOT_FOUND',
    'Photo not found for this event',
  ),
  consentRequired: errorResponse(
    'The event owner has not given (or revoked) the publish consent',
    'PUBLISH_CONSENT_REQUIRED',
    'The event owner has not given consent to publish this photo',
  ),
};

const bearer = [{ bearerAuth: [] }];

/** פרמטרי חלוקה לעמודים – משותפים לכל הרשימות */
const pageParams = [
  { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Page number (starts at 1)' },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
    description: `Items per page (max ${MAX_PAGE_SIZE})`,
  },
];
/** תשובת רשימה: { data: [...], pagination: {...} } */
const pageOf = (itemSchema: string) => ({
  type: 'object',
  required: ['data', 'pagination'],
  properties: { data: { type: 'array', items: ref(itemSchema) }, pagination: ref('Pagination') },
});
const examplePage = (item: unknown, totalItems = 1) => ({
  data: [item],
  pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, totalItems, totalPages: Math.ceil(totalItems / DEFAULT_PAGE_SIZE) },
});
/** סינון ומיון של אירועים – משותפים ל-GET /events ול-GET /events/my */
const eventFilterParams = [
  { name: 'eventType', in: 'query', schema: ref('EventType') },
  { name: 'status', in: 'query', schema: ref('EventStatus'), description: 'Including Pending / Rejected requests' },
  { name: 'packageId', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'minBudget', in: 'query', schema: { type: 'number', minimum: 0 }, description: 'budget >= minBudget' },
  { name: 'maxBudget', in: 'query', schema: { type: 'number', minimum: 0 }, description: 'budget <= maxBudget (minBudget cannot be greater)' },
  { name: 'sortBy', in: 'query', schema: { type: 'string', enum: [...SORT_FIELDS], default: 'eventDate' } },
  { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
];
const conflict = (description: string, message: string) => errorResponse(description, 'CONFLICT', message);

const idParam = (name = 'id', description = 'Event id') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'integer', minimum: 1 },
  example: 1,
});

const exampleUser = {
  id: 2,
  fullName: 'נועה לוי',
  email: 'noa.levi@example.com',
  phone: '050-1234567',
  address: null,
  role: 'Client',
  emailVerified: true,
  googleLinked: false,
  createdAt: '2026-10-01T09:00:00.000Z',
};
const exampleToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiQ2xpZW50Iiwic3ViIjoiMiJ9.signature';
const examplePhotoUrl =
  'https://api.cloudinary.com/v1_1/demo/image/download?api_key=123456789012345&expires_at=1792502400&format=jpg' +
  '&public_id=eventstyle%2Fevents%2F1%2Fabc&signature=0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c&timestamp=1792501800&type=authenticated';
/** תמונת אירוע כפי שהלקוחה רואה אותה */
const examplePhoto = {
  id: 7,
  eventId: 1,
  url: examplePhotoUrl,
  urlExpiresAt: '2026-10-20T12:10:00.000Z',
  isPrivate: true,
  publishConsent: false,
  publishedInGallery: false,
  uploadedByMe: true,
  canDelete: true,
  createdAt: '2026-10-20T12:00:00.000Z',
};
/** אותה תמונה כפי שהמנהלת רואה אותה */
const exampleAdminPhoto = {
  ...examplePhoto,
  uploadedByMe: false,
  publicId: 'eventstyle/events/1/abc',
  storageType: 'authenticated',
  uploadedById: 2,
  galleryItemId: null,
};
const exampleAdminPhotoListItem = {
  ...exampleAdminPhoto,
  publishConsent: true,
  event: { id: 1, eventName: 'יום הולדת 30 לנועה', eventType: 'Birthday', clientName: 'נועה לוי' },
};
const exampleEventForAdmin = {
  id: 1,
  eventName: 'יום הולדת 30 לנועה',
  clientName: 'נועה לוי',
  clientEmail: 'noa.levi@example.com',
  eventType: 'Birthday',
  eventDate: '2026-12-15',
  location: 'אולם הגן, תל אביב',
  packageId: 2,
  package: { id: 2, name: 'Premium' },
  themeColor: '#F4C2C2',
  guestCount: 80,
  budget: 4500,
  status: 'Planning',
  coverImageUrl: null,
  notes: 'להזמין בלונים בגוון ורוד עתיק',
  description: 'שולחן מתוקים בגווני ורוד עתיק וזהב, פרחים טבעיים וקשת בלונים בכניסה',
  clientNotes: 'אלרגיה לחמניות – בלי פרחי חמנייה',
  rejectionReason: null,
  reviewedAt: '2026-10-02T09:00:00.000Z',
  reviewedById: 1,
  userId: 2,
  photos: [exampleAdminPhoto],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
};
const exampleEventForClient = (({ notes: _omit, reviewedById: _r, ...rest }) => ({ ...rest, photos: [examplePhoto] }))(exampleEventForAdmin);
const exampleRequestBody = {
  eventName: 'בת מצווה לשירה',
  eventType: 'BatMitzvah',
  eventDate: '2027-03-18',
  location: 'גן אירועים השקמה, רעננה',
  packageId: 2,
  themeColor: 'לבנדר',
  guestCount: 120,
  budget: 9000,
  description: 'קונספט פרובאנס: לבנדר, עץ טבעי ונרות, פינת צילום עם קשת פרחים',
  clientNotes: 'הכניסה לאולם מתאפשרת רק משעה 16:00',
};
const examplePendingRequest = {
  ...exampleEventForClient,
  ...exampleRequestBody,
  id: 7,
  package: { id: 2, name: 'Premium' },
  clientName: 'נועה לוי',
  clientEmail: 'noa.levi@example.com',
  status: 'Pending',
  reviewedAt: null,
  photos: [],
};
const exampleListItem = (() => {
  const { photos: _p, ...rest } = exampleEventForAdmin;
  return { ...rest, photoCount: 1 };
})();
const exampleEventBody = {
  eventName: 'יום הולדת 30 לנועה',
  clientName: 'נועה לוי',
  clientEmail: 'noa.levi@example.com',
  eventType: 'Birthday',
  eventDate: '2026-12-15',
  location: 'אולם הגן, תל אביב',
  packageId: 2,
  themeColor: '#F4C2C2',
  guestCount: 80,
  budget: 4500,
  status: 'New',
  coverImageUrl: null,
  notes: 'להזמין בלונים בגוון ורוד עתיק',
};
const examplePackage = {
  id: 1,
  name: 'Basic',
  description: 'עיצוב שולחן מרכזי, צבעים ואביזרים בסיסיים',
  price: 1200,
  features: ['עיצוב שולחן מרכזי', 'התאמת צבעים', 'אביזרים בסיסיים'],
  imageUrl: 'https://picsum.photos/seed/eventstyle-basic/800/600',
  eventType: null,
  sortOrder: 0,
};
const exampleTypePackage = {
  id: 4,
  name: 'יום הולדת קלאסי',
  description: 'שולחן מתוקים ובלונים בצבעי האירוע',
  price: 1500,
  features: ['שולחן מתוקים מעוצב', 'קשת בלונים קטנה', 'שלט ברכה אישי'],
  imageUrl: 'https://picsum.photos/seed/eventstyle-type-1/800/600',
  eventType: 'Birthday',
  sortOrder: 1,
};
const exampleAdminPackage = {
  ...exampleTypePackage,
  isActive: true,
  eventCount: 2,
  createdAt: '2026-10-27T09:00:00.000Z',
  updatedAt: '2026-10-27T09:30:00.000Z',
};
const examplePackageBody = (({ id: _id, ...rest }) => rest)(exampleTypePackage);
const exampleGallery = {
  id: 3,
  title: 'בת מצווה בגווני זהב',
  category: 'BatMitzvah',
  url: 'https://picsum.photos/seed/eventstyle-gallery-3/1200/800',
  publicId: null,
  isFeatured: true,
  sortOrder: 0,
  createdAt: '2026-10-05T10:00:00.000Z',
};
const exampleAdminGallery = { ...exampleGallery, isPublished: true, sourceEventPhotoId: null, updatedAt: '2026-10-27T12:00:00.000Z' };
const examplePublishedCopy = {
  id: 12,
  title: 'שולחן מתוקים ורוד',
  category: 'Birthday',
  url: 'https://res.cloudinary.com/demo/image/upload/v1/eventstyle/gallery/xyz.jpg',
  publicId: 'eventstyle/gallery/xyz',
  isFeatured: false,
  sortOrder: 0,
  createdAt: '2026-10-27T13:00:00.000Z',
  isPublished: true,
  sourceEventPhotoId: 7,
  updatedAt: '2026-10-27T13:00:00.000Z',
};

const authResult = { token: exampleToken, user: exampleUser };

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'EventStyle API',
    version: '1.0.0',
    description:
      'API של EventStyle – סטודיו לעיצוב אירועים.\n\n' +
      '**הרשאות:** Guest (ללא התחברות), Client (לקוח מחובר), Admin (מנהלת).\n\n' +
      '**התחברות ב-Swagger:** קראו ל-`POST /api/auth/login`, העתיקו את `token` מהתשובה, ' +
      'לחצו על **Authorize** והדביקו אותו (בלי המילה Bearer).\n\n' +
      '**פורמט שגיאות אחיד:** `{ "error": { "code", "message", "details?" } }`',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Auth', description: 'הרשמה, התחברות (סיסמה או Google), אימות אימייל ופרופיל' },
    { name: 'Packages', description: 'מחירון וחבילות עיצוב לפי סוג אירוע' },
    { name: 'Admin', description: 'ממשק ניהול (מנהלת בלבד)' },
    { name: 'Gallery', description: 'גלריית עיצובים ציבורית' },
    { name: 'Events', description: 'אירועים (פרטיים – דורש התחברות)' },
    { name: 'Event Requests', description: 'בקשות לקוחות לעיצוב אירוע: שליחה ועריכה (Pending בלבד), אישור ודחייה בידי המנהלת' },
    {
      name: 'Event Photos',
      description:
        'תמונות אירוע פרטיות: מנהלת או בעלת האירוע. תמונות חדשות נשמרות כקבצים פרטיים (authenticated) ' +
        `ונצפות רק דרך קישור חתום וזמני (${TTL_MINUTES} דקות) שנוצר אחרי בדיקת ההרשאות. הסכמה לפרסום ופרסום בגלריה.`,
    },
    { name: 'System', description: 'בדיקת פעילות' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'INVALID_CREDENTIALS',
                  'TOO_MANY_REQUESTS',
                  'FILE_TOO_LARGE',
                  'UNSUPPORTED_FILE_TYPE',
                  'STORAGE_NOT_CONFIGURED',
                  'UPLOAD_FAILED',
                  'STORAGE_DELETE_FAILED',
                  'PHOTO_LIMIT_REACHED',
                  'DUPLICATE_PHOTO',
                  'PUBLISH_CONSENT_REQUIRED',
                  'ALREADY_PUBLISHED',
                  'PHOTO_IN_GALLERY',
                  'GOOGLE_AUTH_FAILED',
                  'GOOGLE_AUTH_NOT_CONFIGURED',
                  'GOOGLE_UNAVAILABLE',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string' },
              details: { description: 'Extra info, e.g. list of invalid fields' },
            },
          },
        },
      },
      Role: { type: 'string', enum: ['Admin', 'Client'] },
      EventType: { type: 'string', enum: [...EVENT_TYPES], description: 'Birthday=יום הולדת, BatMitzvah=בת מצווה, Brit=ברית/בריתה, Corporate=אירוע חברה, Private=אירוע פרטי' },
      EventStatus: {
        type: 'string',
        enum: [...EVENT_STATUSES],
        description:
          'New=חדש, Planning=בתכנון, Preparing=בהכנות, Ready=מוכן, Completed=הושלם (תפעוליים – המנהלת מנהלת אותם). ' +
          'Pending=בקשת לקוחה שממתינה לאישור, Rejected=בקשה שנדחתה (נקבעים רק דרך /events/requests, /approve ו-/reject)',
      },
      OperationalEventStatus: {
        type: 'string',
        enum: [...OPERATIONAL_EVENT_STATUSES],
        description: 'סטטוס שהמנהלת יכולה לקבוע ישירות. Pending / Rejected אינם מותרים כאן',
      },
      User: {
        type: 'object',
        required: ['id', 'fullName', 'email', 'phone', 'address', 'role', 'emailVerified', 'googleLinked', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          fullName: { type: 'string' },
          email: { type: 'string', format: 'email', description: 'Read-only (cannot be changed via the API)' },
          phone: { type: 'string', nullable: true, description: 'null for users who signed up with Google and did not add a phone yet' },
          address: {
            type: 'string',
            nullable: true,
            maxLength: ADDRESS_MAX_LENGTH,
            description: 'Optional, set only via PATCH /api/auth/me. null = no address',
          },
          role: ref('Role'),
          emailVerified: { type: 'boolean' },
          googleLinked: { type: 'boolean', description: 'true if the account can sign in with Google' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: exampleUser,
      },
      AuthResult: {
        type: 'object',
        required: ['token', 'user'],
        properties: { token: { type: 'string', description: 'JWT access token' }, user: ref('User') },
      },
      RegisterRequest: {
        type: 'object',
        required: ['fullName', 'email', 'phone', 'password'],
        properties: {
          fullName: { type: 'string', minLength: 2, maxLength: 100 },
          email: { type: 'string', format: 'email', description: 'Normalized to lowercase' },
          phone: { type: 'string', pattern: '^\\+?[0-9][0-9\\s-]{6,18}$' },
          password: { type: 'string', minLength: 8, maxLength: 72, description: 'At least one letter and one digit' },
        },
        example: { fullName: 'נועה לוי', email: 'noa.levi@example.com', phone: '050-1234567', password: 'Secret123' },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
        example: { email: 'noa.levi@example.com', password: 'Secret123' },
      },
      GoogleLoginRequest: {
        type: 'object',
        required: ['idToken'],
        additionalProperties: false,
        properties: {
          idToken: { type: 'string', description: 'Google ID Token (the "credential" returned by Google Identity Services)' },
        },
        example: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9...' },
      },
      UpdateProfileRequest: {
        type: 'object',
        description: 'At least one field. Any other field (email, role, googleId, emailVerified, id, password...) is rejected with 400.',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          fullName: { type: 'string', minLength: 2, maxLength: 100 },
          phone: { type: 'string', pattern: '^\\+?[0-9][0-9\\s-]{6,18}$' },
          address: {
            type: 'string',
            nullable: true,
            maxLength: ADDRESS_MAX_LENGTH,
            description: `Up to ${ADDRESS_MAX_LENGTH} characters (trimmed). null, "" or spaces only delete the address`,
          },
        },
        example: { fullName: 'נועה לוי-כהן', phone: '052-7654321', address: 'רחוב הרצל 10, תל אביב' },
      },
      Pagination: {
        type: 'object',
        required: ['page', 'limit', 'totalItems', 'totalPages'],
        properties: {
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
          totalItems: { type: 'integer', minimum: 0 },
          totalPages: { type: 'integer', minimum: 0, description: '0 when there are no results' },
        },
        example: { page: 1, limit: DEFAULT_PAGE_SIZE, totalItems: 23, totalPages: 3 },
      },
      Package: {
        type: 'object',
        required: ['id', 'name', 'description', 'price', 'features', 'imageUrl', 'eventType', 'sortOrder'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: {
            type: 'number',
            description: 'Current list price (ILS, demo). Not stored in events – changing it never changes existing events',
          },
          features: { type: 'array', items: { type: 'string' } },
          imageUrl: { type: 'string' },
          eventType: {
            allOf: [ref('EventType')],
            nullable: true,
            description: 'null = general package that fits every event type',
          },
          sortOrder: { type: 'integer', minimum: 0, description: 'Display order inside the event type' },
        },
        example: examplePackage,
      },
      AdminPackage: {
        description: 'חבילה בממשק הניהול: כולל ארכיון ומספר ההזמנות שמשתמשות בחבילה',
        allOf: [
          ref('Package'),
          {
            type: 'object',
            required: ['isActive', 'eventCount', 'createdAt', 'updatedAt'],
            properties: {
              isActive: { type: 'boolean', description: 'false = archived (hidden from the public price list)' },
              eventCount: { type: 'integer', minimum: 0, description: 'How many events use this package' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
        example: exampleAdminPackage,
      },
      PackageInput: {
        type: 'object',
        description: 'שדות לא מוכרים נדחים. eventType חובה בגוף הבקשה (null = חבילה כללית).',
        additionalProperties: false,
        required: ['name', 'description', 'price', 'features', 'imageUrl', 'eventType'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 50, description: 'Unique inside the event type (or among general packages)' },
          description: { type: 'string', minLength: 2, maxLength: 500 },
          price: { type: 'number', minimum: 0, description: 'Up to 2 decimal places' },
          features: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: { type: 'string', minLength: 1, maxLength: 100 } },
          imageUrl: { type: 'string', format: 'uri', maxLength: 500, description: 'https URL' },
          eventType: { allOf: [ref('EventType')], nullable: true },
          isActive: { type: 'boolean', description: 'Create default: true. Update: unchanged if omitted (true restores from the archive)' },
          sortOrder: { type: 'integer', minimum: 0, maximum: MAX_SORT_ORDER, description: 'Create default: 0. Update: unchanged if omitted' },
        },
        example: examplePackageBody,
      },
      GalleryItem: {
        type: 'object',
        description: 'פריט בגלריה הציבורית. נתיבים ציבוריים מחזירים רק פריטים מפורסמים.',
        required: ['id', 'title', 'category', 'url', 'publicId', 'isFeatured', 'sortOrder', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          category: ref('EventType'),
          url: { type: 'string' },
          publicId: { type: 'string', nullable: true },
          isFeatured: { type: 'boolean', description: 'Featured image (home page, gallery cover)' },
          sortOrder: { type: 'integer', minimum: 0, description: 'Display order (then newest first)' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: exampleGallery,
      },
      AdminGalleryItem: {
        description: 'פריט גלריה בממשק הניהול – כולל מצב הפרסום',
        allOf: [
          ref('GalleryItem'),
          {
            type: 'object',
            required: ['isPublished', 'sourceEventPhotoId', 'updatedAt'],
            properties: {
              isPublished: { type: 'boolean', description: 'false = hidden from every public endpoint (the file stays in storage)' },
              sourceEventPhotoId: {
                type: 'integer',
                nullable: true,
                description: 'The event photo this public copy was made from (admin only). null for items uploaded directly to the gallery',
              },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        ],
        example: exampleAdminGallery,
      },
      GalleryUpdateInput: {
        type: 'object',
        description: 'לפחות שדה אחד. הקובץ עצמו לא משתנה. שדות לא מוכרים (למשל url) נדחים.',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 120 },
          category: ref('EventType'),
          isPublished: { type: 'boolean' },
          isFeatured: { type: 'boolean' },
          sortOrder: { type: 'integer', minimum: 0, maximum: MAX_GALLERY_SORT_ORDER },
        },
        example: { title: 'בת מצווה בגווני זהב ולבן', isFeatured: true, sortOrder: 1 },
      },
      GallerySummaryItem: {
        type: 'object',
        required: ['category', 'count', 'cover'],
        properties: {
          category: ref('EventType'),
          count: { type: 'integer', minimum: 0, description: 'Published items only' },
          cover: {
            allOf: [ref('GalleryItem')],
            nullable: true,
            description: 'A featured item if there is one, otherwise the first by order. null when the category is empty',
          },
        },
        example: { category: 'BatMitzvah', count: 2, cover: exampleGallery },
      },
      EventPhoto: {
        type: 'object',
        description:
          'תמונת אירוע. ללקוחה לא נשלחים publicId, סוג האחסון או קישור קבוע לתמונה פרטית. ' +
          'המנהלת מקבלת גם את השדות של AdminEventPhoto.',
        required: ['id', 'eventId', 'url', 'urlExpiresAt', 'isPrivate', 'publishConsent', 'publishedInGallery', 'uploadedByMe', 'canDelete', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          eventId: { type: 'integer' },
          url: {
            type: 'string',
            nullable: true,
            description:
              `Private photo: a signed temporary link, valid for ${TTL_MINUTES} minutes (see urlExpiresAt). ` +
              'Legacy public photo: its permanent URL. null if a link cannot be created right now (e.g. storage not configured). ' +
              'Do not store this link – request the photo again for a fresh one.',
          },
          urlExpiresAt: { type: 'string', format: 'date-time', nullable: true, description: 'When the link stops working. null for legacy public photos' },
          isPrivate: { type: 'boolean', description: 'true = private file (all new uploads); false = legacy public photo' },
          publishConsent: { type: 'boolean', description: 'The event owner agreed that this photo may be published in the gallery (default false)' },
          publishedInGallery: { type: 'boolean', description: 'A public copy of this photo is currently published in the gallery' },
          uploadedByMe: { type: 'boolean' },
          canDelete: { type: 'boolean', description: 'Admin: always. Client: only photos she uploaded' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: examplePhoto,
      },
      AdminEventPhoto: {
        description: 'תמונת אירוע בתשובה למנהלת – כולל פרטי אחסון וקישור לעותק בגלריה',
        allOf: [
          ref('EventPhoto'),
          {
            type: 'object',
            required: ['publicId', 'storageType', 'uploadedById', 'galleryItemId'],
            properties: {
              publicId: { type: 'string', nullable: true },
              storageType: { type: 'string', enum: ['public', 'authenticated'] },
              uploadedById: { type: 'integer', nullable: true, description: 'null for legacy photos or a deleted user' },
              galleryItemId: { type: 'integer', nullable: true, description: 'The gallery copy made from this photo (published or hidden)' },
            },
          },
        ],
        example: exampleAdminPhoto,
      },
      AdminEventPhotoListItem: {
        allOf: [
          ref('AdminEventPhoto'),
          {
            type: 'object',
            required: ['event'],
            properties: {
              event: {
                type: 'object',
                properties: { id: { type: 'integer' }, eventName: { type: 'string' }, eventType: ref('EventType'), clientName: { type: 'string' } },
              },
            },
          },
        ],
        example: exampleAdminPhotoListItem,
      },
      ConsentInput: {
        type: 'object',
        required: ['publishConsent'],
        additionalProperties: false,
        properties: { publishConsent: { type: 'boolean', description: 'true = give consent, false = revoke (removes the gallery copy)' } },
        example: { publishConsent: true },
      },
      PublishInput: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        description: 'שדות לא מוכרים (למשל url) נדחים.',
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 120 },
          category: { allOf: [ref('EventType')], description: 'Default: the event type' },
          isPublished: { type: 'boolean', description: 'Default true. false = create the copy hidden (draft)' },
          isFeatured: { type: 'boolean', description: 'Default false' },
          sortOrder: { type: 'integer', minimum: 0, maximum: MAX_GALLERY_SORT_ORDER, description: 'Default 0' },
        },
        example: { title: 'שולחן מתוקים ורוד', isFeatured: false },
      },
      Event: {
        type: 'object',
        description:
          'אירוע. השדה notes מוחזר למנהלת בלבד. ' +
          'ברשימות מוחזר photoCount, ובאירוע בודד מוחזר photos.',
        required: [
          'id', 'eventName', 'clientName', 'clientEmail', 'eventType', 'eventDate', 'location', 'packageId',
          'themeColor', 'guestCount', 'budget', 'status', 'coverImageUrl', 'userId', 'createdAt', 'updatedAt',
        ],
        properties: {
          id: { type: 'integer' },
          eventName: { type: 'string' },
          clientName: { type: 'string' },
          clientEmail: { type: 'string', format: 'email' },
          eventType: ref('EventType'),
          eventDate: { type: 'string', format: 'date', example: '2026-12-15' },
          location: { type: 'string' },
          packageId: { type: 'integer' },
          package: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
          themeColor: { type: 'string' },
          guestCount: { type: 'integer', minimum: 1 },
          budget: { type: 'number', minimum: 0 },
          status: ref('EventStatus'),
          coverImageUrl: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true, description: 'Admin only – internal notes' },
          description: { type: 'string', nullable: true, description: 'Design concept – written in the client request, visible to the client' },
          clientNotes: { type: 'string', nullable: true, description: 'Special notes from the client request' },
          rejectionReason: { type: 'string', nullable: true, description: 'Reason given when the request was rejected (visible to the client)' },
          reviewedAt: { type: 'string', format: 'date-time', nullable: true, description: 'When the request was approved / rejected. null for admin-created events and pending requests' },
          reviewedById: { type: 'integer', nullable: true, description: 'Admin only – who approved / rejected the request' },
          userId: { type: 'integer', nullable: true, description: 'Linked verified client (set by server only)' },
          photoCount: { type: 'integer', description: 'In list responses' },
          photos: {
            type: 'array',
            items: ref('EventPhoto'),
            description: 'In single event responses, oldest first, with fresh view links. Admin responses use AdminEventPhoto',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      EventInput: {
        type: 'object',
        description: 'userId אינו שדה קלט – השרת קובע אותו לפי clientEmail של לקוח מאומת. שדות לא מוכרים נדחים.',
        additionalProperties: false,
        required: ['eventName', 'clientName', 'clientEmail', 'eventType', 'eventDate', 'location', 'packageId', 'themeColor', 'guestCount', 'budget'],
        properties: {
          eventName: { type: 'string', minLength: 2, maxLength: 120 },
          clientName: { type: 'string', minLength: 2, maxLength: 100 },
          clientEmail: { type: 'string', format: 'email' },
          eventType: ref('EventType'),
          eventDate: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
          location: { type: 'string', minLength: 2, maxLength: 200 },
          packageId: { type: 'integer', minimum: 1 },
          themeColor: { type: 'string', minLength: 1, maxLength: 30, description: 'e.g. "#F4C2C2" or "ורוד עתיק"' },
          guestCount: { type: 'integer', minimum: 1, maximum: 100000 },
          budget: { type: 'number', minimum: 0, description: 'Up to 2 decimal places' },
          status: { allOf: [ref('OperationalEventStatus')], description: 'Optional. Create default: New. Update default: unchanged' },
          coverImageUrl: { type: 'string', nullable: true, description: 'http(s) URL, or null / empty' },
          notes: { type: 'string', nullable: true, maxLength: 2000 },
          description: { type: 'string', nullable: true, maxLength: 2000, description: 'Omit to keep the current value; null / empty clears it' },
          clientNotes: { type: 'string', nullable: true, maxLength: 1000, description: 'Omit to keep the current value; null / empty clears it' },
        },
        example: exampleEventBody,
      },
      EventRequestInput: {
        type: 'object',
        description:
          'בקשת לקוחה – Allowlist מפורשת. כל שדה אחר (status, userId, clientEmail, clientName, notes, coverImageUrl…) נדחה ב-400. ' +
          'הבעלים, השם והאימייל נקבעים בשרת לפי המשתמשת המחוברת.',
        additionalProperties: false,
        required: ['eventName', 'eventType', 'eventDate', 'location', 'packageId', 'themeColor', 'guestCount', 'budget', 'description'],
        properties: {
          eventName: { type: 'string', minLength: 2, maxLength: 120 },
          eventType: ref('EventType'),
          eventDate: { type: 'string', format: 'date', description: 'YYYY-MM-DD, today or later (Israel time)' },
          location: { type: 'string', minLength: 2, maxLength: 200 },
          packageId: { type: 'integer', minimum: 1, description: 'Active package of the same event type, or a general one' },
          themeColor: { type: 'string', minLength: 1, maxLength: 30 },
          guestCount: { type: 'integer', minimum: 1, maximum: 100000 },
          budget: { type: 'number', minimum: 0, description: 'Estimated budget, up to 2 decimal places' },
          description: { type: 'string', minLength: 10, maxLength: 2000, description: 'Design concept' },
          clientNotes: { type: 'string', nullable: true, maxLength: 1000, description: 'Special notes' },
        },
        example: exampleRequestBody,
      },
      EventRequestUpdate: {
        type: 'object',
        description: 'עריכת בקשה ממתינה: אותם שדות כמו EventRequestInput, כולם אופציונליים – לפחות שדה אחד.',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          eventName: { type: 'string', minLength: 2, maxLength: 120 },
          eventType: ref('EventType'),
          eventDate: { type: 'string', format: 'date' },
          location: { type: 'string', minLength: 2, maxLength: 200 },
          packageId: { type: 'integer', minimum: 1 },
          themeColor: { type: 'string', minLength: 1, maxLength: 30 },
          guestCount: { type: 'integer', minimum: 1, maximum: 100000 },
          budget: { type: 'number', minimum: 0 },
          description: { type: 'string', minLength: 10, maxLength: 2000 },
          clientNotes: { type: 'string', nullable: true, maxLength: 1000 },
        },
        example: { guestCount: 140, clientNotes: null },
      },
      RejectInput: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', nullable: true, maxLength: 500, description: 'Optional, visible to the client' } },
        example: { reason: 'התאריך כבר תפוס. נשמח להציע תאריך חלופי' },
      },
      StatusInput: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: { status: ref('OperationalEventStatus') },
        example: { status: 'Preparing' },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          database: { type: 'string', enum: ['ok', 'unreachable'] },
          uptimeSeconds: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
        },
        example: { status: 'ok', database: 'ok', uptimeSeconds: 120, timestamp: '2026-10-24T10:00:00.000Z' },
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'הרשמת לקוח (Guest)',
        description:
          'יוצר משתמש בתפקיד **Client** בלבד ומחזיר token – אפשר להיכנס מיד, בלי קוד אימות. ' +
          'emailVerified=false: הבעלות על הכתובת לא הוכחה, ולכן אירועים שהמנהלת פתחה לפי כתובת האימייל לא מקושרים אוטומטית ' +
          '(הם מקושרים כשבעלת הכתובת מתחברת עם Google מ-Gmail / Workspace). כתובת שכבר רשומה – תמיד 409; חשבון קיים לעולם לא מוחלף.',
        requestBody: { required: true, content: jsonContent(ref('RegisterRequest')) },
        responses: {
          201: {
            description: 'Registered',
            content: jsonContent(
              {
                allOf: [
                  ref('AuthResult'),
                  {
                    type: 'object',
                    properties: { message: { type: 'string' } },
                  },
                ],
              },
              {
                message: 'Registration successful',
                token: exampleToken,
                user: { ...exampleUser, emailVerified: false },
              },
            ),
          },
          400: R.validation,
          409: errorResponse(
            'The email is already registered (any account)',
            'CONFLICT',
            'An account with this email already exists',
          ),
          429: R.tooMany,
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'התחברות (Guest)',
        requestBody: { required: true, content: jsonContent(ref('LoginRequest')) },
        responses: {
          200: { description: 'Logged in', content: jsonContent(ref('AuthResult'), authResult) },
          400: R.validation,
          401: errorResponse('Wrong email or password', 'INVALID_CREDENTIALS', 'Invalid email or password'),
          429: R.tooMany,
        },
      },
    },
    '/api/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'התחברות / הרשמה עם Google (Guest)',
        description:
          'שולחים את ה-ID Token שהתקבל מ-Google Identity Services. השרת מאמת חתימה, issuer, audience (GOOGLE_CLIENT_ID) ותוקף, ' +
          'ומזהה את החשבון לפי המזהה היציב של Google (sub).\n\n' +
          '- **משתמש קיים עם אותו חשבון Google** – התחברות.\n' +
          '- **משתמש קיים עם אותו אימייל** – רק אם Google היא ספקית האימייל (Gmail / Google Workspace), ' +
          'החשבון אינו Admin ואינו מקושר לחשבון Google אחר:\n' +
          '  - חשבון **מאומת** – מקושר ל-Google (אותו id, הסיסמה ממשיכה לעבוד).\n' +
          '  - חשבון **לא מאומת** בלי אירועים ובקשות – בעל הכתובת המוכח גובר: החשבון הישן נמחק ונוצר חשבון Google חדש ומאומת (id חדש, ' +
          'בלי הסיסמה והטלפון של הישן, isNewUser=true). כל token של החשבון הישן נדחה (401).\n' +
          '  - חשבון **לא מאומת** עם אירועים או בקשות – 409 (התחברות עם סיסמה). Google לא מקושר לחשבון שהסיסמה שלו אולי של מישהו אחר.\n' +
          '  אחרת 409 בלי שינוי בחשבון.\n' +
          '- **משתמש חדש** – נוצר בתפקיד **Client** בלבד, בלי סיסמה. אם Google היא ספקית האימייל הוא מאומת מיד ' +
          'ואירועים קיימים מקושרים אליו; אחרת emailVerified=false (עובד כרגיל, בלי קישור אוטומטי של אירועים).\n\n' +
          'מוחזר אותו JWT של המערכת כמו בהתחברות רגילה. ה-Token של Google לא נשמר.',
        requestBody: { required: true, content: jsonContent(ref('GoogleLoginRequest')) },
        responses: {
          200: {
            description: 'Signed in (isNewUser=true when the account was just created)',
            content: jsonContent(
              { allOf: [ref('AuthResult'), { type: 'object', properties: { isNewUser: { type: 'boolean' } } }] },
              { ...authResult, user: { ...exampleUser, phone: null, googleLinked: true }, isNewUser: true },
            ),
          },
          400: R.validation,
          401: errorResponse(
            'Invalid / expired Google token, or unverified Google email',
            'GOOGLE_AUTH_FAILED',
            'Invalid or expired Google token',
          ),
          409: errorResponse(
            'An existing account with this email cannot be linked automatically',
            'CONFLICT',
            'An account with this email already exists. Sign in with your email and password',
          ),
          429: R.tooMany,
          502: errorResponse(
            'Google could not be reached',
            'GOOGLE_UNAVAILABLE',
            'Could not reach Google to verify the sign-in. Please try again',
          ),
          503: errorResponse(
            'GOOGLE_CLIENT_ID is not set on the server',
            'GOOGLE_AUTH_NOT_CONFIGURED',
            'Google sign-in is not configured on the server',
          ),
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'פרטי המשתמש המחובר (Client / Admin)',
        security: bearer,
        responses: {
          200: {
            description: 'Current user',
            content: jsonContent({ type: 'object', properties: { user: ref('User') } }, { user: exampleUser }),
          },
          401: R.unauthorized,
        },
      },
      patch: {
        tags: ['Auth'],
        summary: 'עריכת הפרופיל של המשתמש המחובר (Client / Admin)',
        description:
          'אפשר לעדכן רק fullName, phone ו-address, ורק של המשתמש המחובר (לפי ה-Token). שדה שלא נשלח לא משתנה. ' +
          'address=null (או מחרוזת ריקה) מוחק את הכתובת. ' +
          'אימייל, תפקיד, חיבור Google ושדות אימות אינם ניתנים לשינוי – שליחתם מחזירה 400.',
        security: bearer,
        requestBody: { required: true, content: jsonContent(ref('UpdateProfileRequest')) },
        responses: {
          200: {
            description: 'Updated user',
            content: jsonContent(
              { type: 'object', properties: { user: ref('User') } },
              { user: { ...exampleUser, fullName: 'נועה לוי-כהן', phone: '052-7654321', address: 'רחוב הרצל 10, תל אביב' } },
            ),
          },
          400: R.validation,
          401: R.unauthorized,
        },
      },
    },
    '/api/packages': {
      get: {
        tags: ['Packages'],
        summary: 'המחירון הציבורי – חבילות פעילות בלבד (Guest)',
        description:
          'בלי פרמטרים: כל החבילות הפעילות. עם eventType: החבילות של הסוג, ואחריהן החבילות הכלליות (eventType=null). ' +
          'הסדר: סוג (כלליות בסוף), sortOrder, מחיר, id. חבילות בארכיון לא מוחזרות.',
        parameters: [{ name: 'eventType', in: 'query', required: false, schema: ref('EventType') }],
        responses: {
          200: {
            description: 'Active packages',
            content: jsonContent({ type: 'array', items: ref('Package') }, [exampleTypePackage, examplePackage]),
          },
          400: R.validation,
        },
      },
      post: {
        tags: ['Packages'],
        summary: 'יצירת חבילה (Admin)',
        security: bearer,
        requestBody: { required: true, content: jsonContent(ref('PackageInput')) },
        responses: {
          201: { description: 'Created', content: jsonContent(ref('AdminPackage'), { ...exampleAdminPackage, eventCount: 0 }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          409: errorResponse('Name already used in this event type', 'CONFLICT', 'A package with this name already exists for this event type'),
        },
      },
    },
    '/api/packages/{id}': {
      put: {
        tags: ['Packages'],
        summary: 'עריכת חבילה – פרטים, מחיר, סוג, סדר, ארכיון (Admin)',
        description:
          'החלפה מלאה (כל שדות החובה). שינוי מחיר לא משנה הזמנות קיימות. ' +
          'שינוי eventType מותר רק אם לא נוצר חוסר התאמה: מעבר לכללית (null) תמיד מותר, ' +
          'ומעבר לסוג מסוים רק אם כל ההזמנות של החבילה מאותו סוג – אחרת 409. isActive=true מחזיר מהארכיון.',
        security: bearer,
        parameters: [idParam('id', 'Package id')],
        requestBody: { required: true, content: jsonContent(ref('PackageInput')) },
        responses: {
          200: { description: 'Updated', content: jsonContent(ref('AdminPackage'), exampleAdminPackage) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: errorResponse('Package not found', 'NOT_FOUND', 'Package not found'),
          409: errorResponse(
            'Duplicate name, or the new event type does not match existing events',
            'CONFLICT',
            'Cannot change the event type: 1 existing event(s) of another type use this package',
            { conflictingEvents: 1 },
          ),
        },
      },
      delete: {
        tags: ['Packages'],
        summary: 'העברת חבילה לארכיון – ללא מחיקה פיזית (Admin)',
        description:
          'החבילה מוסתרת מהמחירון הציבורי ואי אפשר לבחור בה להזמנות חדשות. הזמנות קיימות ממשיכות להפנות אליה. ' +
          'החזרה מהארכיון: PUT עם isActive=true.',
        security: bearer,
        parameters: [idParam('id', 'Package id')],
        responses: {
          204: { description: 'Archived – הועברה לארכיון (ללא תוכן בתשובה)' },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: errorResponse('Package not found', 'NOT_FOUND', 'Package not found'),
        },
      },
    },
    '/api/admin/packages': {
      get: {
        tags: ['Admin'],
        summary: 'כל החבילות לניהול, כולל ארכיון ומספר הזמנות (Admin)',
        security: bearer,
        parameters: [
          {
            name: 'eventType',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: [...EVENT_TYPES, 'general'] },
            description: 'סוג אירוע, או general לחבילות הכלליות בלבד',
          },
          { name: 'isActive', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: {
          200: { description: 'All packages', content: jsonContent({ type: 'array', items: ref('AdminPackage') }, [exampleAdminPackage]) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
        },
      },
    },
    '/api/gallery': {
      get: {
        tags: ['Gallery'],
        summary: 'גלריית עיצובים, עם סינון לפי קטגוריה וחלוקה לעמודים (Guest)',
        description: 'רק פריטים מפורסמים. סדר: sortOrder, ואז החדשים קודם.',
        parameters: [
          { name: 'category', in: 'query', required: false, schema: ref('EventType'), description: 'Filter by event type' },
          { name: 'featured', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] }, description: 'true = featured items only' },
          ...pageParams,
        ],
        responses: {
          200: { description: 'Published items, paginated', content: jsonContent(pageOf('GalleryItem'), examplePage(exampleGallery)) },
          400: R.validation,
        },
      },
      post: {
        tags: ['Gallery'],
        summary: 'הוספת תמונה לגלריה (Admin)',
        description:
          `multipart/form-data. קובץ אחד בשדה image. סוגים: ${ALLOWED_MIME_TYPES.join(', ')}. עד ${MAX_FILE_SIZE_MB}MB.\n\n` +
          `התמונה מעובדת מחדש לפני השמירה: סיבוב לפי EXIF, הקטנה עד ${MAX_IMAGE_DIMENSION}px והסרת כל המטא-דאטה (כולל GPS).\n\n` +
          'שדות רשות (טקסט): isPublished ("true"/"false", ברירת מחדל true), isFeatured (ברירת מחדל false), sortOrder (ברירת מחדל 0).',
        security: bearer,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['image', 'title', 'category'],
                properties: {
                  image: { type: 'string', format: 'binary' },
                  title: { type: 'string', minLength: 2, maxLength: 120 },
                  category: ref('EventType'),
                  isPublished: { type: 'string', enum: ['true', 'false'] },
                  isFeatured: { type: 'string', enum: ['true', 'false'] },
                  sortOrder: { type: 'string', pattern: '^\\d+$', description: `0–${MAX_GALLERY_SORT_ORDER}` },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: jsonContent(ref('AdminGalleryItem'), exampleAdminGallery) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          413: R.fileTooLarge,
          415: R.unsupportedFile,
          502: R.uploadFailed,
          503: R.storageMissing,
        },
      },
    },
    '/api/gallery/summary': {
      get: {
        tags: ['Gallery'],
        summary: 'סיכום הגלריות: לכל סוג אירוע – מספר תמונות מפורסמות ותמונת שער (Guest)',
        description: 'תמיד 5 שורות, אחת לכל סוג אירוע. פריטים מוסתרים לא נספרים ולא נבחרים כשער. סוג ריק: count=0, cover=null.',
        responses: {
          200: {
            description: 'One row per event type',
            content: jsonContent({ type: 'array', items: ref('GallerySummaryItem') }, [
              { category: 'Birthday', count: 0, cover: null },
              { category: 'BatMitzvah', count: 2, cover: exampleGallery },
            ]),
          },
        },
      },
    },
    '/api/gallery/{id}': {
      patch: {
        tags: ['Gallery'],
        summary: 'עריכת פריט גלריה: כותרת, סוג, פרסום / הסתרה, מובילה, סדר (Admin)',
        description:
          'שדה שלא נשלח לא משתנה. הסתרה (isPublished=false) לא מוחקת את הקובץ. ' +
          'עותק של תמונת אירוע (sourceEventPhotoId) יכול לחזור לפרסום רק אם ההסכמה בתוקף – אחרת 409 PUBLISH_CONSENT_REQUIRED.',
        security: bearer,
        parameters: [idParam('id', 'Gallery item id')],
        requestBody: { required: true, content: jsonContent(ref('GalleryUpdateInput')) },
        responses: {
          200: { description: 'Updated', content: jsonContent(ref('AdminGalleryItem'), exampleAdminGallery) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: errorResponse('Gallery item not found', 'NOT_FOUND', 'Gallery item not found'),
          409: R.consentRequired,
        },
      },
      delete: {
        tags: ['Gallery'],
        summary: 'מחיקת תמונה מהגלריה לצמיתות, כולל הקובץ באחסון (Admin)',
        description:
          'להסתרה בלי מחיקה: PATCH עם isPublished=false. ' +
          'בעותק של תמונת אירוע: נמחק רק העותק הציבורי; תמונת המקור וההסכמה לא משתנות (אפשר לפרסם שוב). ' +
          'העותק מוסתר קודם ונמחק מהאחסון לפני הרשומה; אם המחיקה באחסון נכשלת – 502 STORAGE_DELETE_FAILED והפריט נשאר מוסתר.',
        security: bearer,
        parameters: [idParam('id', 'Gallery item id')],
        responses: { 204: R.noContent, 400: R.validation, 401: R.unauthorized, 403: R.forbidden, 404: R.notFound, 502: R.storageDeleteFailed },
      },
    },
    '/api/admin/gallery': {
      get: {
        tags: ['Admin'],
        summary: 'כל פריטי הגלריה לניהול, כולל מוסתרים (Admin)',
        security: bearer,
        parameters: [
          { name: 'category', in: 'query', required: false, schema: ref('EventType') },
          { name: 'isPublished', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'isFeatured', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] } },
          ...pageParams,
        ],
        responses: {
          200: { description: 'All gallery items, paginated', content: jsonContent(pageOf('AdminGalleryItem'), examplePage(exampleAdminGallery)) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
        },
      },
    },
    '/api/events': {
      get: {
        tags: ['Events'],
        summary: 'כל האירועים, עם חיפוש, סינון, מיון וחלוקה לעמודים (Admin)',
        description:
          'החיפוש, הסינון, המיון והחלוקה לעמודים מתבצעים במסד הנתונים. ברירת מחדל: מיון לפי eventDate בסדר יורד, ' +
          `עמוד 1, ${DEFAULT_PAGE_SIZE} פריטים בעמוד. totalItems מתייחס לתוצאות אחרי הסינון.`,
        security: bearer,
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Search in eventName or clientName (case-insensitive)' },
          ...eventFilterParams,
          ...pageParams,
        ],
        responses: {
          200: { description: 'Events list, paginated', content: jsonContent(pageOf('Event'), examplePage(exampleListItem)) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
        },
      },
      post: {
        tags: ['Events'],
        summary: 'יצירת אירוע (Admin)',
        description:
          'אם קיים לקוח **מאומת** (התחבר עם Google מ-Gmail / Workspace, או אומת בעבר) עם clientEmail – האירוע מקושר אליו. ' +
          'אחרת userId=null עד שבעלת הכתובת תתחבר עם Google.\n\n' +
          '**חבילה:** חייבת להיות פעילה, ומסוג האירוע או כללית (eventType=null). אחרת 400 על השדה packageId.',
        security: bearer,
        requestBody: { required: true, content: jsonContent(ref('EventInput')) },
        responses: {
          201: { description: 'Created', content: jsonContent(ref('Event'), { ...exampleEventForAdmin, status: 'New', photos: [] }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
        },
      },
    },
    '/api/events/my': {
      get: {
        tags: ['Events'],
        summary: 'האירועים והבקשות של המשתמש המחובר, עם חיפוש, סינון ומיון (Client / Admin)',
        description:
          'לפי userId מתוך ה-Token בלבד – הסינון לא יכול להרחיב את הרשימה מעבר לאירועים של המשתמש. ' +
          'כולל בקשות בסטטוס Pending ו-Rejected. ללקוח לא מוחזר השדה notes. ברירת מחדל: eventDate בסדר יורד.',
        security: bearer,
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Search in eventName (case-insensitive)' },
          ...eventFilterParams,
          ...pageParams,
        ],
        responses: {
          200: {
            description: 'My events, paginated',
            content: jsonContent(pageOf('Event'), examplePage((({ notes: _n, ...rest }) => rest)(exampleListItem))),
          },
          400: R.validation,
          401: R.unauthorized,
        },
      },
    },
    '/api/events/{id}': {
      get: {
        tags: ['Events'],
        summary: 'אירוע אחד, כולל תמונות (Admin או בעל האירוע)',
        security: bearer,
        parameters: [idParam()],
        responses: {
          200: { description: 'Event (client view – without notes)', content: jsonContent(ref('Event'), exampleEventForClient) },
          400: R.validation,
          401: R.unauthorized,
          403: R.eventForbidden,
          404: R.notFound,
        },
      },
      put: {
        tags: ['Events'],
        summary: 'עריכת אירוע – החלפה מלאה (Admin)',
        description:
          'יש לשלוח את כל שדות החובה. status אופציונלי (אם לא נשלח – לא משתנה). הקישור ללקוח מחושב מחדש לפי clientEmail.\n\n' +
          '**חבילה:** מסוג האירוע או כללית – גם כשמשנים רק את eventType. חבילה בארכיון מותרת רק אם האירוע כבר משויך אליה.',
        security: bearer,
        parameters: [idParam()],
        requestBody: { required: true, content: jsonContent(ref('EventInput')) },
        responses: {
          200: { description: 'Updated', content: jsonContent(ref('Event'), exampleEventForAdmin) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          409: conflict('The event is a Pending / Rejected request – approve or reject it first', 'A request must be approved or rejected before it can be edited'),
        },
      },
      delete: {
        tags: ['Events'],
        summary: 'מחיקת אירוע וכל התמונות שלו (Admin)',
        description:
          'כל התמונות של האירוע נמחקות, וגם **כל העותקים הציבוריים שנוצרו מהן בגלריה**:\n\n' +
          '1. ההסכמות מבוטלות והעותקים מוסתרים מיד.\n' +
          '2. העותקים נמחקים מהאחסון (invalidate: true) ומהגלריה.\n' +
          '3. רק אז האירוע נמחק, והקבצים הפרטיים נמחקים מהאחסון.\n\n' +
          'אם מחיקת עותק באחסון נכשלת – 502 STORAGE_DELETE_FAILED והאירוע **לא** נמחק; העותקים שנכשלו נשארים מוסתרים ' +
          'ולא ניתנים לפרסום מחדש. שליחה חוזרת של הבקשה ממשיכה. פריטי גלריה שאינם מקושרים לאירוע לא משתנים.',
        security: bearer,
        parameters: [idParam()],
        responses: {
          204: R.noContent,
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          409: R.copyCreatedMeanwhile,
          502: R.storageDeleteFailed,
        },
      },
    },
    '/api/events/{id}/status': {
      patch: {
        tags: ['Events'],
        summary: 'עדכון סטטוס ההכנות (Admin)',
        description:
          'מעבר חופשי בין הסטטוסים התפעוליים (New, Planning, Preparing, Ready, Completed) – לתיקון טעויות. ' +
          'בקשה (Pending / Rejected) לא משתנה כאן: משתמשים ב-/approve או ב-/reject.',
        security: bearer,
        parameters: [idParam()],
        requestBody: { required: true, content: jsonContent(ref('StatusInput')) },
        responses: {
          200: { description: 'Updated event', content: jsonContent(ref('Event'), { ...exampleEventForAdmin, status: 'Preparing' }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          409: conflict('The event is a Pending / Rejected request', 'A request must be approved or rejected before its status can be managed'),
        },
      },
    },
    '/api/events/requests': {
      post: {
        tags: ['Event Requests'],
        summary: 'שליחת בקשה לעיצוב אירוע (Client)',
        description:
          'הבקשה נוצרת בסטטוס **Pending** ומשויכת למשתמשת מה-Token. clientName ו-clientEmail נלקחים מהחשבון.\n\n' +
          `**מגבלות:** עד ${MAX_PENDING_REQUESTS} בקשות ממתינות ללקוחה. בקשה כפולה – אותו שם אירוע (בלי הבדל אותיות) ` +
          'ואותו תאריך, בבקשה ממתינה או באירוע שכבר אושר – נדחית ב-409. בקשה שנדחתה לא חוסמת שליחה מחדש. ' +
          'הבדיקות מתבצעות בנעילה, כך שהן נכונות גם בבקשות מקבילות.\n\n' +
          '**חבילה:** פעילה, ומסוג האירוע או כללית – אחרת 400 על packageId.',
        security: bearer,
        requestBody: { required: true, content: jsonContent(ref('EventRequestInput')) },
        responses: {
          201: { description: 'Request created (Pending)', content: jsonContent(ref('Event'), examplePendingRequest) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          409: conflict(
            `Duplicate request, or ${MAX_PENDING_REQUESTS} pending requests already (details: { limit, current })`,
            'You already have a request or an event with this name on this date',
          ),
        },
      },
    },
    '/api/events/{id}/request': {
      patch: {
        tags: ['Event Requests'],
        summary: 'עריכת בקשה ממתינה (בעלת הבקשה בלבד)',
        description:
          'רק שדות ה-Allowlist (EventRequestUpdate). רק בסטטוס **Pending**: השורה ננעלת לפני הבדיקה, ולכן עריכה במקביל לאישור ' +
          'או לדחייה לא יכולה לעקוף אותם – היא מסתיימת לפני ההחלטה, או נדחית ב-409.',
        security: bearer,
        parameters: [idParam('id', 'Request (event) id')],
        requestBody: { required: true, content: jsonContent(ref('EventRequestUpdate')) },
        responses: {
          200: { description: 'Updated request', content: jsonContent(ref('Event'), { ...examplePendingRequest, guestCount: 140 }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.eventForbidden,
          404: R.notFound,
          409: conflict('The request is no longer Pending (approved / rejected), or the change makes it a duplicate', 'Only a pending request can be edited'),
        },
      },
    },
    '/api/events/{id}/approve': {
      post: {
        tags: ['Event Requests'],
        summary: 'אישור בקשה (Admin): Pending → New',
        description:
          'עדכון אטומי בתנאי status = Pending. אותה רשומה הופכת לאירוע – לא נוצרת רשומה חדשה. ' +
          'אישור כפול, או אישור ודחייה במקביל: הראשון מצליח, השני מקבל 409.',
        security: bearer,
        parameters: [idParam('id', 'Request (event) id')],
        responses: {
          200: { description: 'Approved – now an event in status New', content: jsonContent(ref('Event'), { ...examplePendingRequest, status: 'New', reviewedAt: '2026-10-28T10:00:00.000Z', reviewedById: 1 }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          409: conflict('The request was already approved or rejected', 'This request was already reviewed'),
        },
      },
    },
    '/api/events/{id}/reject': {
      post: {
        tags: ['Event Requests'],
        summary: 'דחיית בקשה (Admin): Pending → Rejected',
        description: 'הבקשה נשמרת במסד (לא נמחקת) ונעולה לעריכה. reason – רשות, גלוי ללקוחה. אותה הגנה מפני החלטה כפולה כמו באישור.',
        security: bearer,
        parameters: [idParam('id', 'Request (event) id')],
        requestBody: { required: false, content: jsonContent(ref('RejectInput')) },
        responses: {
          200: {
            description: 'Rejected',
            content: jsonContent(ref('Event'), { ...examplePendingRequest, status: 'Rejected', rejectionReason: 'התאריך כבר תפוס', reviewedAt: '2026-10-28T10:00:00.000Z', reviewedById: 1 }),
          },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          409: conflict('The request was already approved or rejected', 'This request was already reviewed'),
        },
      },
    },
    '/api/events/{id}/photos': {
      get: {
        tags: ['Event Photos'],
        summary: 'כל התמונות של אירוע, עם קישורי צפייה זמניים (Admin או בעלת האירוע)',
        description:
          `ממוינות מהישנה לחדשה. לכל תמונה פרטית נוצר קישור חתום חדש, תקף ${TTL_MINUTES} דקות (urlExpiresAt). ` +
          'אירוע בלי בעלים – למנהלת בלבד. אם אי אפשר ליצור קישור כרגע, התמונה מוחזרת עם url=null.',
        security: bearer,
        parameters: [idParam()],
        responses: {
          200: { description: 'Photos (admin: AdminEventPhoto)', content: jsonContent({ type: 'array', items: ref('EventPhoto') }, [examplePhoto]) },
          400: R.validation,
          401: R.unauthorized,
          403: R.eventForbidden,
          404: R.notFound,
        },
      },
      post: {
        tags: ['Event Photos'],
        summary: 'העלאת תמונות פרטיות לאירוע (Admin או בעלת האירוע)',
        description:
          `multipart/form-data. 1–${MAX_FILES_PER_REQUEST} קבצים בשדה photos. סוגים: ${ALLOWED_MIME_TYPES.join(', ')}. עד ${MAX_FILE_SIZE_MB}MB לקובץ. ` +
          `עד ${MAX_PHOTOS_PER_EVENT} תמונות לאירוע.\n\n` +
          'ההרשאה והמגבלה נבדקות **לפני** קבלת הקבצים. סוג הקובץ נבדק לפי התוכן האמיתי (חתימת הקובץ ופענוח התמונה). ' +
          `כל תמונה מעובדת מחדש לפני השמירה: סיבוב לפי EXIF, הקטנה עד ${MAX_IMAGE_DIMENSION}px והסרת כל המטא-דאטה (כולל GPS).\n\n` +
          '**כל התמונות החדשות נשמרות כקבצים פרטיים** (Cloudinary authenticated). התשובה כוללת קישור צפייה זמני בלבד.\n\n' +
          '**כפילויות:** SHA-256 של הקובץ המעובד. אותה תמונה פעמיים באותה בקשה, או תמונה שכבר קיימת באירוע → 409 DUPLICATE_PHOTO ' +
          '(גם בבקשות מקבילות). הבקשה כולה נדחית – אף קובץ לא נשמר.',
        security: bearer,
        parameters: [idParam()],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['photos'],
                properties: { photos: { type: 'array', minItems: 1, maxItems: MAX_FILES_PER_REQUEST, items: { type: 'string', format: 'binary' } } },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created photos (only the new ones)', content: jsonContent({ type: 'array', items: ref('EventPhoto') }, [examplePhoto]) },
          400: R.validation,
          401: R.unauthorized,
          403: R.eventForbidden,
          404: R.notFound,
          409: {
            description: 'Duplicate photo (DUPLICATE_PHOTO) or the event would exceed the photo limit (PHOTO_LIMIT_REACHED)',
            content: jsonContent(ref('ErrorResponse'), {
              error: {
                code: 'PHOTO_LIMIT_REACHED',
                message: `An event can have at most ${MAX_PHOTOS_PER_EVENT} photos (currently 49)`,
                details: { limit: MAX_PHOTOS_PER_EVENT, current: 49, requested: 2 },
              },
            }),
          },
          413: R.fileTooLarge,
          415: R.unsupportedFile,
          502: R.uploadFailed,
          503: R.storageMissing,
        },
      },
    },
    '/api/events/{id}/photos/{photoId}': {
      get: {
        tags: ['Event Photos'],
        summary: 'תמונה אחת עם קישור צפייה זמני חדש – לרענון קישור שפג (Admin או בעלת האירוע)',
        description: `הקישור תקף ${TTL_MINUTES} דקות. אחרי שפג – מבקשים שוב את התמונה. כאן כשל ביצירת הקישור מוחזר כשגיאה (503).`,
        security: bearer,
        parameters: [idParam(), idParam('photoId', 'Photo id')],
        responses: {
          200: { description: 'Photo (admin: AdminEventPhoto)', content: jsonContent(ref('EventPhoto'), examplePhoto) },
          400: R.validation,
          401: R.unauthorized,
          403: R.eventForbidden,
          404: R.photoNotFound,
          503: R.storageMissing,
        },
      },
      delete: {
        tags: ['Event Photos'],
        summary: 'מחיקת תמונת אירוע (Admin – כל תמונה; בעלת האירוע – רק תמונות שהעלתה)',
        description:
          'הקובץ נמחק גם מהאחסון (כולל ביטול העותקים ב-CDN).\n\n' +
          '**תמונה שפורסמה בגלריה:** העותק הציבורי מוסר **לפני** תמונת המקור – ההסכמה מבוטלת והעותק מוסתר מיד, ' +
          'נמחק מהאחסון (invalidate: true) ומהגלריה, ורק אז התמונה נמחקת. ' +
          'אם מחיקת העותק באחסון נכשלת – 502 STORAGE_DELETE_FAILED, והתמונה לא נמחקת; העותק נשאר מוסתר ולא ניתן לפרסום מחדש, ' +
          'ושליחה חוזרת של הבקשה ממשיכה.',
        security: bearer,
        parameters: [idParam(), idParam('photoId', 'Photo id')],
        responses: {
          204: R.noContent,
          400: R.validation,
          401: R.unauthorized,
          403: errorResponse('Another client event, or a photo the client did not upload', 'FORBIDDEN', 'You can delete only photos you uploaded'),
          404: R.photoNotFound,
          409: R.copyCreatedMeanwhile,
          502: R.storageDeleteFailed,
        },
      },
    },
    '/api/events/{id}/photos/{photoId}/consent': {
      put: {
        tags: ['Event Photos'],
        summary: 'הסכמה / ביטול הסכמה לפרסום תמונה בגלריה (בעלת האירוע בלבד)',
        description:
          'ברירת המחדל: אין הסכמה, ותמונות לעולם לא מתפרסמות אוטומטית. הסכמה רק **מאפשרת** למנהלת לפרסם.\n\n' +
          '**ביטול הסכמה** (publishConsent=false): אם יש עותק בגלריה – הוא מוסתר מיד, ואז נמחק מהאחסון (כולל CDN invalidation) ומהגלריה. ' +
          'אם המחיקה באחסון נכשלת, העותק נשאר מוסתר ולא יכול לחזור לפרסום; שליחה חוזרת של הביטול מנסה שוב. ' +
          'גם המנהלת לא יכולה לשנות הסכמה (403).',
        security: bearer,
        parameters: [idParam(), idParam('photoId', 'Photo id')],
        requestBody: { required: true, content: jsonContent(ref('ConsentInput')) },
        responses: {
          200: { description: 'Updated photo', content: jsonContent(ref('EventPhoto'), { ...examplePhoto, publishConsent: true }) },
          400: R.validation,
          401: R.unauthorized,
          403: errorResponse('Not the event owner (including the admin)', 'FORBIDDEN', 'Only the event owner can change the publish consent'),
          404: R.photoNotFound,
        },
      },
    },
    '/api/events/{id}/photos/{photoId}/publish': {
      post: {
        tags: ['Event Photos'],
        summary: 'פרסום תמונת אירוע בגלריה הציבורית כעותק נפרד (Admin)',
        description:
          'מחייב הסכמה בתוקף של בעלת האירוע. נוצר **עותק ציבורי חדש ונפרד** באחסון – קובץ המקור נשאר פרטי ולא נחשף – ' +
          'ופריט גלריה שמקושר לתמונה (sourceEventPhotoId). פרסום כפול נחסם גם בבקשות מקבילות. ' +
          'אם השמירה נכשלת אחרי ההעתקה – העותק נמחק.\n\n' +
          'הסתרה / עריכה: PATCH /api/gallery/{id}. הסרה: DELETE /api/gallery/{id}.',
        security: bearer,
        parameters: [idParam(), idParam('photoId', 'Photo id')],
        requestBody: { required: true, content: jsonContent(ref('PublishInput')) },
        responses: {
          201: { description: 'Gallery item (the public copy)', content: jsonContent(ref('AdminGalleryItem'), examplePublishedCopy) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.photoNotFound,
          409: {
            description: 'No consent (PUBLISH_CONSENT_REQUIRED) or already in the gallery (ALREADY_PUBLISHED)',
            content: jsonContent(ref('ErrorResponse'), {
              error: { code: 'ALREADY_PUBLISHED', message: 'This photo already has a copy in the gallery', details: { galleryItemId: 12 } },
            }),
          },
          502: R.uploadFailed,
          503: R.storageMissing,
        },
      },
    },
    '/api/admin/event-photos': {
      get: {
        tags: ['Admin'],
        summary: 'תמונות אירוע לניהול – למשל תמונות שקיבלו הסכמה וממתינות לפרסום (Admin)',
        description: 'לדוגמה: publishConsent=true&inGallery=false. ממוין מהחדשה לישנה, עם קישורי צפייה זמניים.',
        security: bearer,
        parameters: [
          { name: 'eventId', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
          { name: 'publishConsent', in: 'query', required: false, schema: { type: 'string', enum: ['true', 'false'] } },
          {
            name: 'inGallery',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['true', 'false'] },
            description: 'true = has a gallery copy (published or hidden)',
          },
          ...pageParams,
        ],
        responses: {
          200: {
            description: 'Event photos, paginated',
            content: jsonContent(pageOf('AdminEventPhotoListItem'), examplePage(exampleAdminPhotoListItem)),
          },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'בדיקת פעילות השרת ומסד הנתונים (Guest)',
        responses: {
          200: { description: 'Healthy', content: jsonContent(ref('Health')) },
          503: {
            description: 'Database unreachable',
            content: jsonContent(ref('Health'), { status: 'error', database: 'unreachable', uptimeSeconds: 5, timestamp: '2026-10-24T10:00:00.000Z' }),
          },
        },
      },
    },
  },
};

import { DEFAULT_PAGE_SIZE, EVENT_STATUSES, EVENT_TYPES, MAX_PAGE_SIZE } from '../schemas/common.schema';
import { SORT_FIELDS } from '../schemas/event.schema';
import { ALLOWED_MIME_TYPES, MAX_FILES_PER_REQUEST, MAX_FILE_SIZE_MB } from '../middleware/upload';
import { VERIFICATION } from '../config/verification';
import { ADDRESS_MAX_LENGTH } from '../schemas/auth.schema';
import { MAX_FEATURES, MAX_SORT_ORDER } from '../schemas/package.schema';

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
  noContent: { description: 'Deleted successfully – נמחק (ללא תוכן בתשובה)' },
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
const examplePhoto = {
  id: 7,
  eventId: 1,
  url: 'https://res.cloudinary.com/demo/image/upload/v1/eventstyle/events/1/abc.jpg',
  publicId: 'eventstyle/events/1/abc',
  createdAt: '2026-10-20T12:00:00.000Z',
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
  userId: 2,
  photos: [examplePhoto],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
};
const { notes: _omit, ...exampleEventForClient } = exampleEventForAdmin;
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
  createdAt: '2026-10-05T10:00:00.000Z',
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
    { name: 'Event Photos', description: 'תמונות אירוע' },    { name: 'System', description: 'בדיקת פעילות' },
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
                  'INVALID_CODE',
                  'CODE_EXPIRED',
                  'TOO_MANY_REQUESTS',
                  'FILE_TOO_LARGE',
                  'UNSUPPORTED_FILE_TYPE',
                  'STORAGE_NOT_CONFIGURED',
                  'UPLOAD_FAILED',
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
      EventStatus: { type: 'string', enum: [...EVENT_STATUSES], description: 'New=חדש, Planning=בתכנון, Preparing=בהכנות, Ready=מוכן, Completed=הושלם' },
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
      VerifyEmailRequest: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', pattern: '^\\d{6}$', description: '6-digit code from the email' },
        },
        example: { email: 'noa.levi@example.com', code: '482913' },
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
      ResendCodeRequest: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
        example: { email: 'noa.levi@example.com' },
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
        required: ['id', 'title', 'category', 'url', 'publicId', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          category: ref('EventType'),
          url: { type: 'string' },
          publicId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: exampleGallery,
      },
      EventPhoto: {
        type: 'object',
        required: ['id', 'eventId', 'url', 'publicId', 'createdAt'],
        properties: {
          id: { type: 'integer' },
          eventId: { type: 'integer' },
          url: { type: 'string' },
          publicId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: examplePhoto,
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
          userId: { type: 'integer', nullable: true, description: 'Linked verified client (set by server only)' },
          photoCount: { type: 'integer', description: 'In list responses' },
          photos: { type: 'array', items: ref('EventPhoto'), description: 'In single event responses' },
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
          status: { allOf: [ref('EventStatus')], description: 'Optional. Create default: New. Update default: unchanged' },
          coverImageUrl: { type: 'string', nullable: true, description: 'http(s) URL, or null / empty' },
          notes: { type: 'string', nullable: true, maxLength: 2000 },
        },
        example: exampleEventBody,
      },
      StatusInput: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: { status: ref('EventStatus') },
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
          `יוצר משתמש בתפקיד **Client** בלבד ויוצר קוד אימות בן 6 ספרות (תקף ${VERIFICATION.CODE_TTL_MINUTES} דקות). ` +
          'אין שירות מיילים חיצוני: הקוד מודפס ביומן השרת (EMAIL_PROVIDER=console), ולכן verificationEmailSent תמיד true. ' +
          'מחזיר token, כך שאפשר להיכנס מיד, אבל אירועים קיימים מקושרים רק לאחר אימות האימייל. ' +
          'אם קיים חשבון **לא מאומת** עם אותו אימייל (Client, בלי Google) – הוא מוחלף בחשבון חדש עם id חדש ונשלח קוד חדש; ' +
          'כל token שהונפק לחשבון הישן נדחה (401). מגבלות שליחת הקודים נשמרות. חשבון מאומת או חשבון Admin לא מוחלפים (409).',
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
                    properties: { message: { type: 'string' }, verificationEmailSent: { type: 'boolean' } },
                  },
                ],
              },
              {
                message: 'Registration successful. A 6-digit verification code was sent to noa.levi@example.com',
                verificationEmailSent: true,
                token: exampleToken,
                user: { ...exampleUser, emailVerified: false },
              },
            ),
          },
          400: R.validation,
          409: errorResponse(
            'Email already registered and verified, belongs to an Admin or Google account, or the account changed during the request',
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
          '  - חשבון **לא מאומת** – בעל הכתובת המוכח גובר: החשבון הישן נמחק ונוצר חשבון Google חדש ומאומת (id חדש, ' +
          'בלי הסיסמה והטלפון של הישן, isNewUser=true). כל token של החשבון הישן נדחה (401).\n' +
          '  אחרת 409 בלי שינוי בחשבון.\n' +
          '- **משתמש חדש** – נוצר בתפקיד **Client** בלבד, בלי סיסמה. אם Google היא ספקית האימייל הוא מאומת מיד ' +
          'ואירועים קיימים מקושרים אליו; אחרת emailVerified=false ויש לאמת בקוד (resend-code + verify-email).\n\n' +
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
    '/api/auth/verify-email': {
      post: {
        tags: ['Auth'],
        summary: 'אימות כתובת האימייל בקוד (Guest / Client)',
        description:
          `קוד בן 6 ספרות, תקף ${VERIFICATION.CODE_TTL_MINUTES} דקות, לשימוש חד-פעמי. ` +
          `אחרי ${VERIFICATION.MAX_WRONG_ATTEMPTS} ניסיונות שגויים הקוד נפסל. ` +
          'בהצלחה: המשתמש מסומן כמאומת, אירועים קיימים עם אותו אימייל מקושרים אליו, ומוחזר token חדש.',
        requestBody: { required: true, content: jsonContent(ref('VerifyEmailRequest')) },
        responses: {
          200: {
            description: 'Verified',
            content: jsonContent(
              {
                allOf: [
                  ref('AuthResult'),
                  { type: 'object', properties: { message: { type: 'string' }, linkedEventsCount: { type: 'integer' } } },
                ],
              },
              { message: 'Email verified successfully', linkedEventsCount: 2, ...authResult },
            ),
          },
          400: {
            description: 'Validation error / wrong code (INVALID_CODE) / expired code (CODE_EXPIRED)',
            content: jsonContent(ref('ErrorResponse'), {
              error: { code: 'INVALID_CODE', message: 'Invalid verification code', details: { attemptsLeft: 3 } },
            }),
          },
          409: errorResponse('Already verified', 'CONFLICT', 'Email is already verified'),
          429: R.tooMany,
        },
      },
    },
    '/api/auth/resend-code': {
      post: {
        tags: ['Auth'],
        summary: 'שליחה חוזרת של קוד אימות (Guest / Client)',
        description:
          `מגבלות: פעם ב-${VERIFICATION.RESEND_COOLDOWN_SECONDS} שניות, ועד ${VERIFICATION.MAX_SENDS_PER_WINDOW} קודים ` +
          `ב-${VERIFICATION.SEND_WINDOW_MINUTES} דקות. קוד חדש מבטל את הקודם. ` +
          'התשובה זהה גם אם האימייל לא רשום או כבר מאומת (כדי לא לחשוף מידע). ' +
          'הקוד מודפס ביומן השרת (EMAIL_PROVIDER=console) – אין שליחת מייל חיצונית.',
        requestBody: { required: true, content: jsonContent(ref('ResendCodeRequest')) },
        responses: {
          200: {
            description: 'Generic success message',
            content: jsonContent(
              { type: 'object', properties: { message: { type: 'string' } } },
              { message: 'If an unverified account exists for this email, a new verification code has been sent' },
            ),
          },
          400: R.validation,
          429: errorResponse('Cooldown or hourly limit reached', 'TOO_MANY_REQUESTS', 'Please wait 42 seconds before requesting a new code', {
            retryAfterSeconds: 42,
          }),
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
        parameters: [
          { name: 'category', in: 'query', required: false, schema: ref('EventType'), description: 'Filter by event type' },
          ...pageParams,
        ],
        responses: {
          200: { description: 'Newest first, paginated', content: jsonContent(pageOf('GalleryItem'), examplePage(exampleGallery)) },
          400: R.validation,
        },
      },
      post: {
        tags: ['Gallery'],
        summary: 'הוספת תמונה לגלריה (Admin)',
        description: `multipart/form-data. קובץ אחד בשדה image. סוגים: ${ALLOWED_MIME_TYPES.join(', ')}. עד ${MAX_FILE_SIZE_MB}MB.`,
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
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: jsonContent(ref('GalleryItem'), exampleGallery) },
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
    '/api/gallery/{id}': {
      delete: {
        tags: ['Gallery'],
        summary: 'מחיקת תמונה מהגלריה (Admin)',
        security: bearer,
        parameters: [idParam('id', 'Gallery item id')],
        responses: { 204: R.noContent, 400: R.validation, 401: R.unauthorized, 403: R.forbidden, 404: R.notFound },
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
          { name: 'eventType', in: 'query', schema: ref('EventType') },
          { name: 'status', in: 'query', schema: ref('EventStatus') },
          { name: 'packageId', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: [...SORT_FIELDS], default: 'eventDate' } },
          { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
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
          'אם קיים לקוח **מאומת** עם clientEmail – האירוע מקושר אליו. אחרת userId=null עד שהלקוח יירשם ויאמת.\n\n' +
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
        summary: 'האירועים של המשתמש המחובר (Client / Admin)',
        description: 'לפי userId מתוך ה-Token בלבד. ללקוח לא מוחזר השדה notes. ממוין מהתאריך המאוחר למוקדם.',
        security: bearer,
        parameters: [...pageParams],
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
          403: errorResponse('Event belongs to another client', 'FORBIDDEN', 'You do not have access to this event'),
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
        },
      },
      delete: {
        tags: ['Events'],
        summary: 'מחיקת אירוע וכל התמונות שלו (Admin)',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: R.noContent, 400: R.validation, 401: R.unauthorized, 403: R.forbidden, 404: R.notFound },
      },
    },
    '/api/events/{id}/status': {
      patch: {
        tags: ['Events'],
        summary: 'עדכון סטטוס ההכנות (Admin)',
        security: bearer,
        parameters: [idParam()],
        requestBody: { required: true, content: jsonContent(ref('StatusInput')) },
        responses: {
          200: { description: 'Updated event', content: jsonContent(ref('Event'), { ...exampleEventForAdmin, status: 'Preparing' }) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
        },
      },
    },
    '/api/events/{id}/photos': {
      post: {
        tags: ['Event Photos'],
        summary: 'העלאת תמונות לאירוע (Admin)',
        description: `multipart/form-data. 1–${MAX_FILES_PER_REQUEST} קבצים בשדה photos. סוגים: ${ALLOWED_MIME_TYPES.join(', ')}. עד ${MAX_FILE_SIZE_MB}MB לקובץ.`,
        security: bearer,
        parameters: [idParam()],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['photos'],
                properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created photos', content: jsonContent({ type: 'array', items: ref('EventPhoto') }, [examplePhoto]) },
          400: R.validation,
          401: R.unauthorized,
          403: R.forbidden,
          404: R.notFound,
          413: R.fileTooLarge,
          415: R.unsupportedFile,
          502: R.uploadFailed,
          503: R.storageMissing,
        },
      },
    },
    '/api/events/{id}/photos/{photoId}': {
      delete: {
        tags: ['Event Photos'],
        summary: 'מחיקת תמונת אירוע (Admin)',
        security: bearer,
        parameters: [idParam(), idParam('photoId', 'Photo id')],
        responses: { 204: R.noContent, 400: R.validation, 401: R.unauthorized, 403: R.forbidden, 404: R.notFound },
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

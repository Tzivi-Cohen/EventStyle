-- CreateEnum
CREATE TYPE "Role" AS ENUM ('Admin', 'Client');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('Birthday', 'BatMitzvah', 'Brit', 'Corporate', 'Private');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('New', 'Planning', 'Preparing', 'Ready', 'Completed');

-- CreateTable
CREATE TABLE "Users" (
    "id" SERIAL NOT NULL,
    "fullName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "passwordHash" VARCHAR(100) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'Client',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationCodeHash" VARCHAR(64),
    "verificationCodeExpiresAt" TIMESTAMP(3),
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationLastSentAt" TIMESTAMP(3),
    "verificationSendCount" INTEGER NOT NULL DEFAULT 0,
    "verificationWindowStart" TIMESTAMP(3),

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Packages" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "features" TEXT[],
    "imageUrl" VARCHAR(500) NOT NULL,

    CONSTRAINT "Packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Events" (
    "id" SERIAL NOT NULL,
    "eventName" VARCHAR(120) NOT NULL,
    "clientName" VARCHAR(100) NOT NULL,
    "clientEmail" VARCHAR(254) NOT NULL,
    "eventType" "EventType" NOT NULL,
    "eventDate" DATE NOT NULL,
    "location" VARCHAR(200) NOT NULL,
    "packageId" INTEGER NOT NULL,
    "themeColor" VARCHAR(30) NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "budget" DECIMAL(12,2) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'New',
    "coverImageUrl" VARCHAR(500),
    "notes" VARCHAR(2000),
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPhotos" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "publicId" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPhotos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryItems" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "category" "EventType" NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "publicId" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryItems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Packages_name_key" ON "Packages"("name");

-- CreateIndex
CREATE INDEX "Events_eventDate_idx" ON "Events"("eventDate");

-- CreateIndex
CREATE INDEX "Events_status_idx" ON "Events"("status");

-- CreateIndex
CREATE INDEX "Events_eventType_idx" ON "Events"("eventType");

-- CreateIndex
CREATE INDEX "Events_packageId_idx" ON "Events"("packageId");

-- CreateIndex
CREATE INDEX "Events_userId_idx" ON "Events"("userId");

-- CreateIndex
CREATE INDEX "Events_clientEmail_idx" ON "Events"("clientEmail");

-- CreateIndex
CREATE INDEX "Events_clientName_idx" ON "Events"("clientName");

-- CreateIndex
CREATE INDEX "Events_eventName_idx" ON "Events"("eventName");

-- CreateIndex
CREATE INDEX "EventPhotos_eventId_idx" ON "EventPhotos"("eventId");

-- CreateIndex
CREATE INDEX "GalleryItems_category_idx" ON "GalleryItems"("category");

-- CreateIndex
CREATE INDEX "GalleryItems_createdAt_idx" ON "GalleryItems"("createdAt");

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotos" ADD CONSTRAINT "EventPhotos_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- אילוצי תקינות (CHECK) – הגנה על שלמות הנתונים גם מחוץ ל-API
-- ============================================================
ALTER TABLE "Users" ADD CONSTRAINT "Users_email_lowercase_chk" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "Users" ADD CONSTRAINT "Users_verificationAttempts_chk" CHECK ("verificationAttempts" >= 0);
ALTER TABLE "Users" ADD CONSTRAINT "Users_verificationSendCount_chk" CHECK ("verificationSendCount" >= 0);
ALTER TABLE "Packages" ADD CONSTRAINT "Packages_price_chk" CHECK ("price" >= 0);
ALTER TABLE "Events" ADD CONSTRAINT "Events_guestCount_chk" CHECK ("guestCount" > 0);
ALTER TABLE "Events" ADD CONSTRAINT "Events_budget_chk" CHECK ("budget" >= 0);
ALTER TABLE "Events" ADD CONSTRAINT "Events_clientEmail_lowercase_chk" CHECK ("clientEmail" = lower(btrim("clientEmail")));
ALTER TABLE "Events" ADD CONSTRAINT "Events_eventName_not_blank_chk" CHECK (length(btrim("eventName")) > 0);
ALTER TABLE "Events" ADD CONSTRAINT "Events_clientName_not_blank_chk" CHECK (length(btrim("clientName")) > 0);

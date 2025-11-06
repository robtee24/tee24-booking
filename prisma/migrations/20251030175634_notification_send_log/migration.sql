-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "NotificationLog_bookingId_idx" ON "NotificationLog"("bookingId");
CREATE INDEX "NotificationLog_notificationId_idx" ON "NotificationLog"("notificationId");
CREATE UNIQUE INDEX "NotificationLog_bookingId_notificationId_channel_key" ON "NotificationLog"("bookingId", "notificationId", "channel");
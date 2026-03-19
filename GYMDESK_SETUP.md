# Gymdesk Member Integration Setup Guide

This guide walks through connecting Gymdesk to Tee24 for automatic member syncing.

## Overview

Tee24 integrates with Gymdesk through three channels:

1. **CSV Import** — One-time bulk import of existing members
2. **Zapier** — Real-time sync of new members and visitors
3. **Gymdesk Marketing Automations** — Webhooks for cancellations and frozen statuses

---

## Prerequisites

- A `GYMDESK_WEBHOOK_SECRET` environment variable must be set on your Tee24 deployment (Vercel). This shared secret authenticates incoming webhooks. Use any strong random string (e.g., generate one with `openssl rand -hex 32`).

---

## 1. Initial CSV Import

Import your existing Gymdesk members into Tee24:

1. In **Gymdesk**, go to **Settings > Members > Import/Export > Export member data**
2. Download the CSV file
3. In **Tee24 Admin**, navigate to the location's **Members** page
4. Click **Import CSV** and select the downloaded file
5. The system will match columns automatically (firstName, lastName, email, phone, status, membershipType, joinDate)
6. Re-importing is safe — existing members are updated, not duplicated

### Status Mapping

The CSV importer maps Gymdesk statuses:
| Gymdesk Status | Tee24 Status |
|---|---|
| Active | ACTIVE |
| Cancelled / Canceled | CANCELLED |
| Frozen | FROZEN |
| Visitor / Website Signup | VISITOR |

---

## 2. Zapier Setup (New Members & Visitors)

Create a Zap to automatically sync new members as they're added in Gymdesk.

### Step-by-step:

1. Log into [Zapier](https://zapier.com) and click **Create Zap**

2. **Trigger**: Choose **Gymdesk** as the app, select trigger **Add Member**
   - Connect your Gymdesk account if not already connected
   - Test the trigger to confirm it pulls sample data

3. **Action**: Choose **Webhooks by Zapier**, select **POST**

4. **Configure the webhook**:
   - **URL**: `https://YOUR-DOMAIN.com/api/webhooks/gymdesk?secret=YOUR_GYMDESK_WEBHOOK_SECRET`
   - **Payload Type**: JSON
   - **Data fields** (map from Gymdesk fields):

   | Key | Value |
   |---|---|
   | `action` | `new_member` (hardcode this text) |
   | `locationSlug` | Your location slug (e.g., `main-gym`) |
   | `firstName` | Map to Gymdesk First Name |
   | `lastName` | Map to Gymdesk Last Name |
   | `email` | Map to Gymdesk Email |
   | `phone` | Map to Gymdesk Phone |
   | `status` | Map to Gymdesk Member Type (ACTIVE or VISITOR) |
   | `membershipType` | Map to Gymdesk Membership Plan Name |

5. **Test** the action to verify it creates a member in Tee24

6. **Turn on** the Zap

### Multiple Locations

If you have multiple Gymdesk locations:
- **Option A**: Create one Zap per location, each with the correct `locationSlug`
- **Option B**: Use Zapier Paths to route based on a Gymdesk field (e.g., location name)

---

## 3. Gymdesk Marketing Automations (Cancellations & Frozen)

Gymdesk Marketing Automations can send webhooks when member statuses change.

### For Cancelled Members:

1. In **Gymdesk**, go to **Marketing > Automations**
2. Click **Create Automation**
3. Set trigger: **Member canceled**
4. Add action: **Send Webhook**
5. Configure:
   - **URL**: `https://YOUR-DOMAIN.com/api/webhooks/gymdesk?secret=YOUR_GYMDESK_WEBHOOK_SECRET`
   - **Method**: POST
   - **Body** (JSON):
   ```json
   {
     "action": "status_change",
     "email": "{{member_email}}",
     "status": "CANCELLED",
     "locationSlug": "your-location-slug"
   }
   ```
6. Save and activate the automation

### For Frozen Members:

1. Create another automation in **Marketing > Automations**
2. Set trigger: **Member frozen**
3. Add action: **Send Webhook**
4. Configure the same URL and body format, but with `"status": "FROZEN"`:
   ```json
   {
     "action": "status_change",
     "email": "{{member_email}}",
     "status": "FROZEN",
     "locationSlug": "your-location-slug"
   }
   ```
5. Save and activate

---

## 4. Verification

After setup, verify everything works:

1. **CSV Import**: Check the Members page shows imported members with correct statuses
2. **Zapier**: Add a test member in Gymdesk and verify it appears in Tee24 within a few minutes
3. **Cancellation Webhook**: Cancel a test member in Gymdesk and verify their status updates to CANCELLED in Tee24
4. **Booking Badges**: Make a booking with a member's email and confirm the membership badge appears on the booking block

---

## API Reference

### Webhook Endpoint

`POST /api/webhooks/gymdesk?secret=YOUR_SECRET`

**New Member:**
```json
{
  "action": "new_member",
  "locationSlug": "main-gym",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+15551234567",
  "status": "ACTIVE",
  "membershipType": "Premium",
  "gymDeskId": "12345"
}
```

**Status Change:**
```json
{
  "action": "status_change",
  "locationSlug": "main-gym",
  "email": "john@example.com",
  "status": "CANCELLED"
}
```

### CSV Import Endpoint

`POST /api/admin/members/import`

Multipart form data with:
- `file`: CSV file
- `locationSlug`: Location slug string

### Member List Endpoint

`GET /api/admin/members?locationSlug=main-gym&status=ACTIVE&q=john&page=1&limit=50`

### Member Lookup Endpoint

`GET /api/admin/members/lookup?locationSlug=main-gym`

Returns email and phone lookup maps for matching members to bookings.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GYMDESK_WEBHOOK_SECRET` | Shared secret for authenticating incoming Gymdesk/Zapier webhooks |

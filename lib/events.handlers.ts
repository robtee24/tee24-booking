// lib/events.handlers.ts
//
// Consumers of member events. Loaded lazily by lib/events.ts on first emit.
// Owned by the comms/marketing module: system templates + automation enrollment.
import { onMemberEvent } from "./events";

onMemberEvent(async (event) => {
  // Placeholder until the comms module registers real handlers:
  // 1. send the enabled system email/SMS template for event.kind
  // 2. enroll the member in automations triggered by event.kind
  if (process.env.NODE_ENV !== "production") {
    console.log(`[events] ${event.kind}`, { memberId: event.memberId, locationId: event.locationId });
  }
});

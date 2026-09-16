import { runBookingNotificationScheduler } from "../packages/infrastructure/src/booking-notification-cli.js";

try {
  await runBookingNotificationScheduler(process.argv.slice(2), process.env, (message) => process.stdout.write(`${message}\n`));
} catch (error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "BOOKING_NOTIFICATION_SCHEDULER_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "failed", code })}\n`);
  process.exitCode = 1;
}

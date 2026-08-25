import { fail, ok } from "@/lib/api";
import { buildSettingsTransfer } from "@/lib/settings-transfer";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await buildSettingsTransfer());
  } catch (error) {
    return fail(error);
  }
}

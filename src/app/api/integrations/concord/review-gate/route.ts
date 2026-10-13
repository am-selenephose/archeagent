import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assessConcordReview } from "../../../../../core/integrations/concord-review";
import { BodyInputError, readBoundedJson } from "../../../../../server/http/bounded-json";

const maxBodyBytes = 262144;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > maxBodyBytes) {
    void request.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    return NextResponse.json(assessConcordReview(await readBoundedJson(request, maxBodyBytes, 10000)));
  } catch (error) {
    if (error instanceof BodyInputError) {
      const status = error.code === "too_large" ? 413 : error.code === "malformed" ? 400 : 408;
      const message = status === 413 ? "Payload too large" : status === 400 ? "Malformed JSON" : "Request body unavailable";
      return NextResponse.json({ error: message }, { status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid Concord evidence" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to evaluate Concord evidence" }, { status: 500 });
  }
}

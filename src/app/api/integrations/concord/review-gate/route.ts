import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assessConcordReview, concordReviewInputSchema } from "@/core/integrations/concord-review";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > 262144) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    const input = concordReviewInputSchema.parse(await request.json());
    return NextResponse.json(assessConcordReview(input));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid Concord evidence", details: error.issues }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to evaluate Concord evidence" }, { status: 500 });
  }
}

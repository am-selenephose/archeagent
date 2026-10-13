import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { evaluateRun, evaluationRequestSchema } from "../../../lib/evaluator";
import { BodyInputError, readBoundedJson } from "../../../server/http/bounded-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJson(request, 262144, 10000);
    const parsed = evaluationRequestSchema.parse(body);
    return NextResponse.json(evaluateRun(parsed));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid evaluation request" },
        { status: 400 },
      );
    }
    if (error instanceof BodyInputError) {
      const status = error.code === "too_large" ? 413 : error.code === "malformed" ? 400 : 408;
      const message = status === 413 ? "Payload too large" : status === 400 ? "Malformed JSON" : "Request body unavailable";
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

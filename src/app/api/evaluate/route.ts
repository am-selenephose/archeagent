import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { evaluateRun, evaluationRequestSchema } from "@/lib/evaluator";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = evaluationRequestSchema.parse(body);
    return NextResponse.json(evaluateRun(parsed));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid evaluation request", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { demoRequest } from "@/lib/demo";
import { evaluateRun } from "@/lib/evaluator";

export async function GET() {
  return NextResponse.json(evaluateRun(demoRequest));
}

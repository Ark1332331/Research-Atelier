import { handleSessionGet } from "@/lib/search/literature-api";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  return handleSessionGet(id ?? "");
}


import {readStudyDocument, studyErrorResponse} from '@/lib/study-library';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { return Response.json(await readStudyDocument(new URL(request.url).searchParams.get('id') ?? ''), {headers: {'Cache-Control': 'no-store'}}); }
  catch (error) { return studyErrorResponse(error); }
}

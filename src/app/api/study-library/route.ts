import {listStudyNodes, mutateStudyTree, studyErrorResponse} from '@/lib/study-library';

export const runtime = 'nodejs';

export async function GET() {
  try { return Response.json({nodes: await listStudyNodes()}, {headers: {'Cache-Control': 'no-store'}}); }
  catch (error) { return studyErrorResponse(error); }
}
export async function POST(request: Request) {
  try { return Response.json(await mutateStudyTree(await request.json())); }
  catch (error) { return studyErrorResponse(error); }
}

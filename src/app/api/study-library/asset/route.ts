import {readStudyAsset, studyErrorResponse} from '@/lib/study-library';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const {bytes, mime} = await readStudyAsset(new URL(request.url).searchParams.get('id') ?? '');
    return new Response(bytes as BodyInit, {headers: {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-store',
    }});
  } catch (error) { return studyErrorResponse(error); }
}

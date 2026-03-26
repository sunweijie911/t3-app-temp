import { openapiSpec } from '../openapi';

export async function GET() {
  return Response.json(openapiSpec);
}

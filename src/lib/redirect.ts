import { NextResponse } from "next/server";

/**
 * Cria um redirect com Location relativa (ex: "/", "/login?error=x").
 * Browsers resolvem relativa contra o host que ELES requisitaram (a alias),
 * evitando o problema de Vercel routing onde new URL("/", req.url) acaba
 * apontando pro deployment URL hash em vez da alias estável.
 */
export function relativeRedirect(
  path: string,
  status: 303 | 307 | 302 = 303,
): NextResponse {
  const response = new NextResponse(null, { status });
  response.headers.set("Location", path);
  return response;
}

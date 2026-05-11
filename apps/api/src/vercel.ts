import { UpstreamError } from "./http.js";

export function toErrorResponse(error: unknown): Response {
  if (error instanceof UpstreamError) {
    return Response.json(
      {
        error: "upstream_error",
        message: error.message
      },
      { status: error.status >= 500 ? 502 : error.status }
    );
  }

  return Response.json(
    {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    },
    { status: 500 }
  );
}
